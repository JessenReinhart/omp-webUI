import { existsSync } from "node:fs";
import { extname, join, normalize, relative } from "node:path";
import { getCurrentCollabConnection } from "./collab-registry";

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

    try {
      const connection = await getCurrentCollabConnection();
      if (!connection) {
        return json({
          connected: false,
          reason:
            "No collab host is published for this OMP process. Run /collab or enable collab.autoStart=control.",
        });
      }

      return json({
        connected: true,
        host: connection.host,
        access: connection.access,
        collabUrl: connection.url,
      });
    } catch (error) {
      return json({
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      });
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
