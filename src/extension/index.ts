import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { startWebUiServer, type WebUiServer } from "../host/server";

let server: WebUiServer | undefined;
let cachedApi: ExtensionAPI | null = null;
let cachedCtx: ExtensionContext | null = null;

export function getWebUiRuntime(): { api: ExtensionAPI; ctx: ExtensionContext | null } | null {
  if (!cachedApi) return null;
  return { api: cachedApi, ctx: cachedCtx };
}

export type LocalFrameBase =
  | { kind: "snapshot"; entries: unknown[]; header?: unknown }
  | { kind: "message"; type: string; message: unknown }
  | { kind: "tool"; type: string; toolCallId: string; toolName: string; args?: unknown; partialResult?: unknown; result?: unknown; isError?: boolean; intent?: string }
  | { kind: "state"; state: unknown };

export type LocalFrame = { seq: number } & LocalFrameBase;

const EVENT_LIMIT = 500;
let globalSeq = 0;
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

function broadcast(frame: LocalFrameBase) {
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
}

export default function webUiExtension(pi: ExtensionAPI) {
  pi.setLabel("omp-webUI");
  cachedApi = pi;

  // Subscribe to all streaming/message events once at extension scope
  pi.on("session_start", () => {
    broadcast({ kind: "state", state: { sessionStarted: true } });
  });

  pi.on("turn_start", () => {
    broadcast({ kind: "state", state: { isStreaming: true } });
  });

  pi.on("turn_end", () => {
    broadcast({ kind: "state", state: { isStreaming: false } });
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

      ctx.ui.notify(`omp-webUI: ${server.url}`, "info");
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
