import { existsSync } from "node:fs";
import { basename, extname, join, normalize, relative, resolve } from "node:path";
import {
  buildSkillPromptMessage,
  discoverSlashCommands,
  FileSessionStorage,
  getActiveSkills,
  listSessions,
  loadSessionFile,
  SKILL_PROMPT_MESSAGE_TYPE,
} from "@oh-my-pi/pi-coding-agent";
import { expandSlashCommand } from "@oh-my-pi/pi-coding-agent/extensibility/slash-commands";
import { computeDefaultSessionDir } from "@oh-my-pi/pi-coding-agent/session/session-paths";
import { broadcastSnapshot, getEventRing, getWebUiRuntime, subscribeStream } from "../extension/index";

const HOST = "127.0.0.1";
const FIRST_PORT = 4380;
const LAST_PORT = 4390;
const ROOT = join(import.meta.dir, "../..");
const DIST = join(ROOT, "dist");
const MAX_COMMAND_LENGTH = 20_000;
const FILE_SEARCH_LIMIT = 60;
const MAX_PASTED_IMAGES = 4;
const MAX_PASTED_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PROMPT_BODY_BYTES = 60 * 1024 * 1024;
const MAX_PROMPT_TEXT_CHARACTERS = 500_000;
const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const PASTED_IMAGE_MIME_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const FILE_SEARCH_EXCLUDES = new Set([".git", "node_modules", "dist"]);

const CORE_COMMANDS = [
  { name: "model", description: "Switch the active model", source: "core", argumentHint: "provider/model" },
  { name: "thinking", description: "Change the reasoning effort", source: "core", argumentHint: "off | low | medium | high…" },
  { name: "compact", description: "Compact the current context", source: "core", argumentHint: "optional instructions" },
  { name: "new", description: "Start a fresh OMP session", source: "core" },
  { name: "name", description: "Rename the current session", source: "core", argumentHint: "session name" },
  { name: "reload", description: "Reload extensions, skills, and settings", source: "core" },
  { name: "abort", description: "Stop the current response", source: "core" },
] as const;

const THINKING_LEVELS = ["inherit", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

class UserCommandError extends Error {}

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface WebUiServer {
  url: string;
  stop(): void;
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isAuthorized(requestUrl: URL, token: string) {
  return requestUrl.searchParams.get("token") === token;
}

function assetPath(pathname: string) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = normalize(join(DIST, requested));
  const rel = relative(DIST, candidate);
  if (rel.startsWith("..") || rel.includes("..")) return null;
  return candidate;
}

function commandParts(text: string): { name: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/") || trimmed.length < 2) return null;
  const firstSpace = trimmed.search(/\s/);
  return firstSpace === -1
    ? { name: trimmed.slice(1), args: "" }
    : { name: trimmed.slice(1, firstSpace), args: trimmed.slice(firstSpace).trim() };
}

function commandError(error: unknown): string {
  return error instanceof UserCommandError
    ? error.message
    : "OMP could not complete that command. Check the terminal for details.";
}

function isSafeFileSearchPath(filePath: string): boolean {
  const parts = filePath.split(/[\\/]/);
  if (parts.some((part) => FILE_SEARCH_EXCLUDES.has(part))) return false;
  const name = parts.at(-1)?.toLowerCase() ?? "";
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return false;
  return !name.endsWith(".pem") && !name.endsWith(".key");
}

async function searchWorkspaceFiles(query: string) {
  const runtime = getWebUiRuntime();
  if (!runtime?.ctx) throw new UserCommandError("No active OMP session runtime");
  const normalizedQuery = query.trim().toLowerCase();
  const glob = new Bun.Glob("**/*");
  const matches: Array<{ path: string; name: string; kind: "image" | "file" }> = [];
  for await (const filePath of glob.scan({ cwd: runtime.ctx.cwd, dot: true, onlyFiles: true })) {
    if (!isSafeFileSearchPath(filePath)) continue;
    const lowered = filePath.toLowerCase();
    if (normalizedQuery && !lowered.includes(normalizedQuery)) continue;
    matches.push({
      path: filePath,
      name: basename(filePath),
      kind: IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase()) ? "image" : "file",
    });
    if (matches.length >= FILE_SEARCH_LIMIT) break;
  }
  return matches;
}

async function getCommandCatalog() {
  const runtime = getWebUiRuntime();
  if (!runtime?.ctx) throw new UserCommandError("No active OMP session runtime");

  const registered = runtime.api.getCommands();
  const registeredSkillNames = new Set(
    registered.filter((command) => command.source === "skill").map((command) => command.name),
  );
  const skills = getActiveSkills()
    .map((skill) => ({
      name: `skill:${skill.name}`,
      description: skill.description || `Run the ${skill.name} skill`,
      source: "skill" as const,
      argumentHint: "optional instructions",
    }))
    .filter((command) => registeredSkillNames.has(command.name));

  const promptCommands = await discoverSlashCommands({ cwd: runtime.ctx.cwd });
  const prompts = promptCommands.map((command) => ({
    name: command.name,
    description: command.description || "Run a saved prompt",
    source: "prompt" as const,
    argumentHint: "optional arguments",
  }));

  const seen = new Set<string>();
  const commands = [...CORE_COMMANDS, ...skills, ...prompts].filter((command) => {
    if (seen.has(command.name)) return false;
    seen.add(command.name);
    return true;
  });
  const current = runtime.ctx.models.current();
  const models = runtime.ctx.models.list().map((model) => ({
    id: `${model.provider}/${model.id}`,
    name: model.name || model.id,
    provider: model.provider,
    active: current?.provider === model.provider && current.id === model.id,
  }));

  return {
    ok: true,
    commands,
    models,
    thinkingLevels: THINKING_LEVELS,
    currentModel: current ? `${current.provider}/${current.id}` : undefined,
    currentThinking: runtime.api.getThinkingLevel(),
  };
}

async function executeCommand(text: string): Promise<{ message: string; refresh?: boolean }> {
  const runtime = getWebUiRuntime();
  if (!runtime?.ctx) throw new UserCommandError("No active OMP session runtime");
  const parsed = commandParts(text);
  if (!parsed) throw new UserCommandError("Commands must start with /");
  const { name, args } = parsed;

  if (name === "abort") {
    runtime.ctx.abort();
    return { message: "Abort requested." };
  }

  if (!runtime.ctx.isIdle()) {
    throw new UserCommandError("Wait for the current response to finish, or use /abort first.");
  }

  if (name === "model") {
    if (!args) throw new UserCommandError("Choose a model from the command menu.");
    const model = runtime.ctx.models.resolve(args);
    if (!model) throw new UserCommandError(`Model not found: ${args}`);
    const changed = await runtime.api.setModel(model);
    if (!changed) throw new UserCommandError(`No available credentials for ${model.provider}/${model.id}.`);
    broadcastSnapshot();
    return { message: `Model changed to ${model.name || model.id}.`, refresh: true };
  }

  if (name === "thinking") {
    if (!THINKING_LEVELS.includes(args as (typeof THINKING_LEVELS)[number])) {
      throw new UserCommandError(`Choose one of: ${THINKING_LEVELS.join(", ")}.`);
    }
    runtime.api.setThinkingLevel(args as Parameters<typeof runtime.api.setThinkingLevel>[0]);
    broadcastSnapshot();
    return { message: `Reasoning effort set to ${args}.`, refresh: true };
  }

  if (name === "compact") {
    await runtime.ctx.compact(args || undefined);
    broadcastSnapshot();
    return { message: "Context compacted.", refresh: true };
  }

  if (name === "new") {
    const result = await runtime.ctx.newSession();
    if (result.cancelled) throw new UserCommandError("New session was cancelled.");
    broadcastSnapshot();
    return { message: "Started a new session.", refresh: true };
  }

  if (name === "name") {
    if (!args) throw new UserCommandError("Add a session name after /name.");
    await runtime.api.setSessionName(args);
    broadcastSnapshot();
    return { message: `Session renamed to ${args}.`, refresh: true };
  }

  if (name === "reload") {
    await runtime.ctx.reload();
    broadcastSnapshot();
    return { message: "OMP runtime reloaded.", refresh: true };
  }

  if (name.startsWith("skill:")) {
    const skillName = name.slice("skill:".length);
    const commandName = `skill:${skillName}`;
    const available = runtime.api.getCommands().some((command) => command.source === "skill" && command.name === commandName);
    const skill = getActiveSkills().find((candidate) => candidate.name === skillName);
    if (!available || !skill) throw new UserCommandError(`Skill not found or slash invocation is disabled: ${skillName}`);
    const built = await buildSkillPromptMessage(skill, args, "user");
    runtime.api.sendMessage(
      {
        customType: SKILL_PROMPT_MESSAGE_TYPE,
        content: built.message,
        display: true,
        details: built.details,
        attribution: "user",
      },
      { triggerTurn: true, deliverAs: "steer" },
    );
    return { message: `Running ${skillName}…` };
  }

  const promptCommands = await discoverSlashCommands({ cwd: runtime.ctx.cwd });
  if (promptCommands.some((command) => command.name === name)) {
    runtime.api.sendUserMessage(expandSlashCommand(text, promptCommands));
    return { message: `Running /${name}…` };
  }

  throw new UserCommandError(`/${name} is not available in the web UI yet.`);
}
export function resolveSessionFile(fileId: string | null): string | null {
  if (!fileId || !fileId.endsWith(".jsonl") || fileId.includes("/") || fileId.includes("\\") || fileId.includes("..")) {
    return null;
  }
  const cwd = getWebUiRuntime()?.ctx?.cwd ?? process.cwd();
  const storage = new FileSessionStorage();
  const sessionDir = computeDefaultSessionDir(cwd, storage);
  const filePath = resolve(sessionDir, fileId);
  return filePath.startsWith(sessionDir) ? filePath : null;
}

async function handler(request: Request, token: string): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/session") {
    if (!isAuthorized(url, token)) return json({ error: "unauthorized" }, 401);

    const runtime = getWebUiRuntime();
    if (!runtime?.ctx) {
      return json({
        connected: false,
        reason: "No active OMP session runtime. Reload the extension.",
      });
    }

    try {
      const sessionName = runtime.api.getSessionName() || runtime.ctx.sessionManager?.getHeader()?.title;
      return json({
        connected: true,
        host: {
          sessionName,
          cwd: runtime.ctx.cwd,
          model: runtime.ctx.model,
        },
        transport: "local",
      });
    } catch (error) {
      return json({
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (url.pathname === "/api/sessions") {
    if (!isAuthorized(url, token)) return json({ error: "unauthorized" }, 401);

    try {
      const cwd = getWebUiRuntime()?.ctx?.cwd ?? process.cwd();
      const storage = new FileSessionStorage();
      const sessionDir = computeDefaultSessionDir(cwd, storage);
      const sessions = await listSessions(sessionDir, storage);
      const mapped = sessions.map((s) => ({
        id: s.id,
        title: s.title || s.firstMessage || s.id,
        cwd: s.cwd,
        created: s.created,
        modified: s.modified,
        messageCount: s.messageCount,
        fileId: basename(s.path),
        path: s.path,
      }));
      return json({ ok: true, sessions: mapped });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  if (url.pathname === "/api/commands" && request.method === "GET") {
    if (!isAuthorized(url, token)) return json({ error: "unauthorized" }, 401);
    try {
      return json(await getCommandCatalog());
    } catch (error) {
      return json({ error: commandError(error) }, 503);
    }
  }

  if (url.pathname === "/api/commands" && request.method === "POST") {
    if (!isAuthorized(url, token)) return json({ error: "unauthorized" }, 401);
    try {
      const body = (await request.json()) as { text?: unknown };
      if (typeof body.text !== "string" || !body.text.trim()) {
        return json({ error: "Command cannot be empty" }, 400);
      }
      if (body.text.length > MAX_COMMAND_LENGTH) {
        return json({ error: "Command is too long" }, 413);
      }
      const result = await executeCommand(body.text);
      return json({ ok: true, ...result });
    } catch (error) {
      return json({ error: commandError(error) }, 400);
    }
  }

  if (url.pathname === "/api/files" && request.method === "GET") {
    if (!isAuthorized(url, token)) return json({ error: "unauthorized" }, 401);
    try {
      const query = (url.searchParams.get("query") ?? "").slice(0, 200);
      return json({ ok: true, files: await searchWorkspaceFiles(query) });
    } catch (error) {
      return json({ error: commandError(error) }, 503);
    }
  }

  // POST /api/sessions/:fileId.jsonl/resume — make a past session the live one.
  if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/resume")) {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!isAuthorized(url, token)) return json({ error: "unauthorized" }, 401);

    try {
      const fileId = decodeURIComponent(url.pathname.slice("/api/sessions/".length, -"/resume".length));
      const filePath = resolveSessionFile(fileId);
      if (!filePath) return json({ error: "Invalid fileId parameter" }, 400);

      const runtime = getWebUiRuntime();
      if (!runtime?.ctx) return json({ error: "No active OMP session runtime" }, 503);

      const result = await runtime.ctx.switchSession(filePath);
      if (result.cancelled) return json({ error: "Session switch was cancelled" }, 409);

      // The browser still holds the previous session's transcript; push a fresh
      // snapshot so it renders the resumed session without a reconnect.
      broadcastSnapshot();
      return json({ ok: true });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  // GET /api/sessions/:fileId.jsonl — read-only transcript.
  if (url.pathname.startsWith("/api/sessions/")) {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    if (!isAuthorized(url, token)) return json({ error: "unauthorized" }, 401);

    try {
      const fileId =
        url.searchParams.get("fileId") ?? decodeURIComponent(url.pathname.slice("/api/sessions/".length));
      const filePath = resolveSessionFile(fileId);
      if (!filePath) return json({ error: "Invalid fileId parameter" }, 400);

      const result = await loadSessionFile(filePath, new FileSessionStorage());
      return json({ ok: true, entries: result.entries });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  if (url.pathname === "/api/events") {
    if (!isAuthorized(url, token)) return json({ error: "unauthorized" }, 401);

    const cursorParam = url.searchParams.get("cursor");
    const cursor = cursorParam ? Number.parseInt(cursorParam, 10) : undefined;
    const missed = getEventRing(cursor);

    let cleanupStream: (() => void) | null = null;
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // stream closed
          }
        };

        // Clients without a live cursor get a full snapshot. cursor=0 counts as
        // fresh: lastSeqRef starts at 0 on first connect. Broadcasting gets a real
        // seq and inserts it into the ring (with event-ring buffering).
        if (!cursor || Number.isNaN(cursor)) {
          const snapshot = broadcastSnapshot();
          send(snapshot);
        }

        // Send missed buffered frames
        for (const frame of missed) {
          send(frame);
        }

        // Subscribe to future frames
        const unsubscribe = subscribeStream((frame) => {
          send(frame);
        });

        // Keepalive ping
        const pingTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            cleanupStream?.();
          }
        }, 15000);

        cleanupStream = () => {
          clearInterval(pingTimer);
          unsubscribe();
          cleanupStream = null;
        };
      },
      cancel() {
        cleanupStream?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      },
    });
  }

  if ((url.pathname === "/api/prompt" || url.pathname === "/api/prompt-with-images") && request.method === "POST") {
    if (!isAuthorized(url, token)) return json({ error: "unauthorized" }, 401);

    try {
      const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
      if (Number.isFinite(contentLength) && contentLength > MAX_PROMPT_BODY_BYTES) {
        return json({ error: "Prompt payload is too large" }, 413);
      }
      const body = (await request.json()) as { text?: unknown; images?: unknown };
      const text = typeof body.text === "string" ? body.text.trim() : "";
      const rawImages = Array.isArray(body.images) ? body.images : [];
      if (url.pathname === "/api/prompt-with-images" && rawImages.length === 0) {
        return json({ error: "Image prompt requires at least one image" }, 400);
      }
      if (!text && rawImages.length === 0) {
        return json({ error: "Prompt text cannot be empty" }, 400);
      }
      if (text.length > MAX_PROMPT_TEXT_CHARACTERS) {
        return json({ error: "Prompt text is too large" }, 413);
      }
      if (rawImages.length > MAX_PASTED_IMAGES) {
        return json({ error: `A maximum of ${MAX_PASTED_IMAGES} pasted images is supported` }, 400);
      }
      const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
      for (const image of rawImages) {
        if (typeof image !== "object" || image === null) return json({ error: "Invalid pasted image" }, 400);
        const { data, mimeType } = image as { data?: unknown; mimeType?: unknown };
        if (typeof data !== "string" || typeof mimeType !== "string" || !PASTED_IMAGE_MIME_TYPES.has(mimeType)) {
          return json({ error: "Unsupported pasted image" }, 400);
        }
        if (data.length > Math.ceil(MAX_PASTED_IMAGE_BYTES * 4 / 3) + 4
          || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
          || Buffer.byteLength(data, "base64") > MAX_PASTED_IMAGE_BYTES) {
          return json({ error: "Pasted image is invalid or too large" }, 413);
        }
        images.push({ type: "image", data, mimeType });
      }

      const runtime = getWebUiRuntime();
      if (!runtime?.api) {
        return json({ error: "No active OMP session runtime" }, 503);
      }

      runtime.api.sendUserMessage(images.length > 0 ? [{ type: "text", text }, ...images] : text);
      return json({ ok: true });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  if (url.pathname === "/api/abort" && request.method === "POST") {
    if (!isAuthorized(url, token)) return json({ error: "unauthorized" }, 401);

    try {
      const runtime = getWebUiRuntime();
      if (!runtime?.ctx) {
        return json({ error: "No active OMP session runtime" }, 503);
      }

      runtime.ctx.abort();
      return json({ ok: true });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  if (!existsSync(DIST)) {
    return new Response(
      "omp-webUI has not been built yet. Run \"bun install && bun run build\" in the plugin directory.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const path = assetPath(url.pathname);
  const file = path && existsSync(path) ? Bun.file(path) : Bun.file(join(DIST, "index.html"));

  return new Response(file, {
    headers: {
      "Content-Type": MIME_TYPES[extname(file.name ?? "")] ?? file.type ?? "application/octet-stream",
      "Cache-Control": url.pathname === "/" ? "no-store" : "public, max-age=31536000, immutable",
    },
  });
}

export async function startWebUiServer(): Promise<WebUiServer> {
  const token = crypto.randomUUID();

  for (let port = FIRST_PORT; port <= LAST_PORT; port += 1) {
    try {
      const server = Bun.serve({
        hostname: HOST,
        port,
        fetch: (request) => handler(request, token),
        idleTimeout: 0,
      });

      return {
        url: `http://${HOST}:${server.port}/?token=${encodeURIComponent(token)}`,
        stop: () => server.stop(true),
      };
    } catch {
      // Try the next local port.
    }
  }

  throw new Error(`No free port found between ${FIRST_PORT} and ${LAST_PORT}`);
}
