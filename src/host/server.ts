import { existsSync } from "node:fs";
import { basename, extname, join, normalize, relative, resolve } from "node:path";
import { FileSessionStorage, listSessions, loadSessionFile } from "@oh-my-pi/pi-coding-agent";
import { computeDefaultSessionDir } from "@oh-my-pi/pi-coding-agent/session/session-paths";
import { broadcastSnapshot, getEventRing, getWebUiRuntime, subscribeStream } from "../extension/index";

const HOST = "127.0.0.1";
const FIRST_PORT = 4380;
const LAST_PORT = 4390;
const ROOT = join(import.meta.dir, "../..");
const DIST = join(ROOT, "dist");

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

  if (url.pathname === "/api/prompt" && request.method === "POST") {
    if (!isAuthorized(url, token)) return json({ error: "unauthorized" }, 401);

    try {
      const body = (await request.json()) as { text?: string };
      const text = body.text?.trim();
      if (!text) {
        return json({ error: "Prompt text cannot be empty" }, 400);
      }

      const runtime = getWebUiRuntime();
      if (!runtime?.api) {
        return json({ error: "No active OMP session runtime" }, 503);
      }

      runtime.api.sendUserMessage(text);
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
