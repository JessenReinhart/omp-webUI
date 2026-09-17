import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { openBrowser } from "../host/open-browser";
import { startWebUiServer, type WebUiServer } from "../host/server";

let server: WebUiServer | undefined;
let cachedApi: ExtensionAPI | null = null;
let cachedCtx: ExtensionCommandContext | null = null;

export function getWebUiRuntime(): { api: ExtensionAPI; ctx: ExtensionCommandContext | null } | null {
  if (!cachedApi) return null;
  return { api: cachedApi, ctx: cachedCtx };
}

export type LocalFrameBase =
  | { kind: "snapshot"; entries: unknown[]; header?: unknown; state?: unknown; agents?: unknown }
  | { kind: "message"; type: string; message: unknown }
  | { kind: "tool"; type: string; toolCallId: string; toolName: string; args?: unknown; partialResult?: unknown; result?: unknown; isError?: boolean; intent?: string }
  | { kind: "state"; state: unknown };

export type LocalFrame = { seq: number } & LocalFrameBase;

export interface SnapshotFrameBase {
  kind: "snapshot";
  header: unknown;
  entries: unknown[];
  state: { isStreaming: boolean };
  agents: unknown[];
}

// One shared snapshot builder for every snapshot path (turn_end, session_start,
// switchSession/resume, and the fresh SSE connect in server.ts) so the frame
// shape stays identical and clients always commit from the same source.
export function buildSnapshotFrameBase(): SnapshotFrameBase {
  const ctx = getWebUiRuntime()?.ctx ?? null;
  const header = ctx?.sessionManager?.getHeader() ?? null;
  const entries = ctx?.sessionManager?.getBranch() ?? [];
  const isStreaming = ctx ? !ctx.isIdle() : false;
  return {
    kind: "snapshot",
    header,
    entries,
    state: { isStreaming },
    agents: [],
  };
}

function snapshotHeaderId(header: unknown): string | null {
  if (typeof header !== "object" || header === null) return null;
  const id = (header as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

const EVENT_LIMIT = 500;
const TURN_END_SNAPSHOT_DEFER_MS = 50;
let globalSeq = 0;
let latestSnapshotSeq = 0;
let latestSnapshotHeaderId: string | null = null;
const eventRing: LocalFrame[] = [];
type StreamListener = (frame: LocalFrame) => void;
const streamListeners = new Set<StreamListener>();

export function subscribeStream(listener: StreamListener): () => void {
  streamListeners.add(listener);
  return () => {
    streamListeners.delete(listener);
  };
}

export function getEventRing(cursor?: number): LocalFrame[] {
  if (cursor === undefined || cursor <= 0) {
    return [...eventRing];
  }
  return eventRing.filter((frame) => frame.seq > cursor);
}

export function broadcast(frame: LocalFrameBase): LocalFrame {
  globalSeq += 1;
  const fullFrame: LocalFrame = { seq: globalSeq, ...frame };
  eventRing.push(fullFrame);
  if (eventRing.length > EVENT_LIMIT) {
    eventRing.shift();
  }
  for (const listener of streamListeners) {
    try {
      listener(fullFrame);
    } catch {
      // ignore broken listeners
    }
  }
  return fullFrame;
}

// Shared emitter for the resume/switchSession path (server.ts) and the
// event-driven paths below. It broadcasts the shared snapshot frame and
// records its (seq, headerId) so a deferred turn_end snapshot can detect that
// a newer snapshot for a different session has already committed the transcript.
export function broadcastSnapshot(): LocalFrame {
  const base = buildSnapshotFrameBase();
  const frame = broadcast(base);
  latestSnapshotSeq = frame.seq;
  latestSnapshotHeaderId = snapshotHeaderId(base.header);
  return frame;
}

export default function webUiExtension(pi: ExtensionAPI) {
  pi.setLabel("omp-webUI");
  cachedApi = pi;

  // Subscribe to all streaming/message events once at extension scope
  pi.on("session_start", () => {
    broadcast({ kind: "state", state: { sessionStarted: true } });
    broadcastSnapshot();
  });

  pi.on("turn_start", () => {
    broadcast({ kind: "state", state: { isStreaming: true } });
  });

  pi.on("turn_end", (_event, eventCtx) => {
    // Emit streaming state, then a fresh snapshot so the client commits the
    // finished turn. turn_end fires after the in-memory branch is appended, but
    // the partial-stream error path can append the final assistant message just
    // after it, so defer the snapshot via the OMP-managed runtime timer and
    // guard against clobbering a newer session's snapshot.
    const stateFrame = broadcast({ kind: "state", state: { isStreaming: false } });
    const scheduledHeaderId = snapshotHeaderId(eventCtx?.sessionManager?.getHeader() ?? null);

    const emitTurnSnapshot = () => {
      // Stale guard: a snapshot emitted after this turn ended for a different
      // session (e.g. switchSession/resume) wins; never overwrite it.
      if (latestSnapshotSeq > stateFrame.seq && latestSnapshotHeaderId !== scheduledHeaderId) {
        return;
      }
      broadcastSnapshot();
    };

    if (typeof eventCtx?.setTimeout === "function") {
      eventCtx.setTimeout(emitTurnSnapshot, TURN_END_SNAPSHOT_DEFER_MS);
    } else {
      emitTurnSnapshot();
    }
  });

  pi.on("message_start", (e) => {
    broadcast({ kind: "message", type: "message_start", message: e.message });
  });

  pi.on("message_update", (e) => {
    broadcast({ kind: "message", type: "message_update", message: e.message });
  });

  pi.on("message_end", (e) => {
    broadcast({ kind: "message", type: "message_end", message: e.message });
  });

  pi.on("tool_execution_start", (e) => {
    broadcast({
      kind: "tool",
      type: "tool_execution_start",
      toolCallId: e.toolCallId,
      toolName: e.toolName,
      args: e.args,
      intent: e.intent,
    });
  });

  pi.on("tool_execution_update", (e) => {
    broadcast({
      kind: "tool",
      type: "tool_execution_update",
      toolCallId: e.toolCallId,
      toolName: e.toolName,
      args: e.args,
      partialResult: e.partialResult,
    });
  });

  pi.on("tool_execution_end", (e) => {
    broadcast({
      kind: "tool",
      type: "tool_execution_end",
      toolCallId: e.toolCallId,
      toolName: e.toolName,
      result: e.result,
      isError: e.isError,
    });
  });

  pi.on("agent_start", () => {
    broadcast({ kind: "state", state: { agentRunning: true } });
  });

  pi.on("agent_end", () => {
    broadcast({ kind: "state", state: { agentRunning: false } });
  });

  pi.registerCommand("webui", {
    description: "Open the local omp-webUI for this OMP process",
    handler: async (args, ctx) => {
      cachedCtx = ctx;
      const command = args.trim().toLowerCase();

      if (command === "stop") {
        server?.stop();
        server = undefined;
        ctx.ui.notify("omp-webUI stopped", "info");
        return;
      }

      if (!server) {
        try {
          server = await startWebUiServer();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`omp-webUI failed to start: ${message}`, "error");
          return;
        }
      }

      if (command === "url") {
        // Explicit escape hatch for headless/minimal environments. This is the
        // only path that intentionally renders the token-bearing URL.
        ctx.ui.notify(`omp-webUI: ${server.url}`, "info");
        return;
      }

      const opened = await openBrowser(server.url);
      if (opened) {
        ctx.ui.notify("omp-webUI opened in your browser", "info");
      } else {
        ctx.ui.notify("Couldn't launch the default browser. Run /webui url to print the local URL.", "warning");
      }
    },
  });

  pi.on("session_shutdown", async () => {
    server?.stop();
    server = undefined;
    cachedApi = null;
    cachedCtx = null;
    streamListeners.clear();
  });
}
