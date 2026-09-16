import { existsSync } from "node:fs";
import { extname, join, normalize, relative } from "node:path";
import { getEventRing, getWebUiRuntime, subscribeStream } from "../extension/index";

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

  if (url.pathname === "/api/events") {
    if (!isAuthorized(url, token)) return json({ error: "unauthorized" }, 401);

    const cursorParam = url.searchParams.get("cursor");
    const cursor = cursorParam ? Number.parseInt(cursorParam, 10) : undefined;
    const missed = getEventRing(cursor);

    const runtime = getWebUiRuntime();
    const header = runtime?.ctx?.sessionManager?.getHeader() ?? null;
    const branchEntries = runtime?.ctx?.sessionManager?.getBranch() ?? [];

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

        // If client reconnected without a cursor, send snapshot first
        if (cursor === undefined || Number.isNaN(cursor)) {
          send({
            seq: 0,
            kind: "snapshot",
            header,
            entries: branchEntries,
            state: { isStreaming: runtime?.ctx ? !runtime.ctx.isIdle() : false },
            agents: [],
          });
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
            clearInterval(pingTimer);
            unsubscribe();
          }
        }, 15000);
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
