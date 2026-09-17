import { useCallback, useEffect, useRef, useState } from "react";
import {
  committedMessageIdentities,
  committedToolCallIds,
  isMessageAgentEvent,
  isRecord,
  isToolAgentEvent,
  messageIdentity,
} from "./collabTypes";
import type {
  AgentEvent,
  AgentSnapshot,
  CollabStatus,
  SessionEntry,
  SessionHeader,
  SessionState,
  UseCollabSessionReturn,
  WireMessage,
} from "./collabTypes";

const EVENTS_LIMIT = 500;
const MAX_BACKOFF_MS = 30_000;

type LocalFrame =
  | { seq: number; kind: "snapshot"; header: SessionHeader | null; entries: SessionEntry[]; state: SessionState | null; agents: AgentSnapshot[] }
  | { seq: number; kind: "message"; type: "message_start" | "message_update" | "message_end"; message: WireMessage }
  | { seq: number; kind: "tool"; type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end"; toolCallId: string; toolName: string; args?: unknown; partialResult?: unknown; result?: unknown; isError?: boolean; intent?: string }
  | { seq: number; kind: "state"; state: SessionState };

function isWireMessage(value: unknown): value is WireMessage {
  if (!isRecord(value)) return false;
  return (value.role === "user" || value.role === "developer" || value.role === "assistant" || value.role === "toolResult")
    && typeof value.timestamp === "number"
    && (typeof value.content === "string" || Array.isArray(value.content));
}

function isSessionHeader(value: unknown): value is SessionHeader {
  return isRecord(value);
}

function isSessionState(value: unknown): value is SessionState {
  return isRecord(value);
}

function isAgentSnapshot(value: unknown): value is AgentSnapshot {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.displayName === "string"
    && (value.kind === "main" || value.kind === "sub")
    && typeof value.status === "string";
}

function isSessionEntry(value: unknown): value is SessionEntry {
  return isRecord(value)
    && typeof value.type === "string"
    && (value.id === undefined || typeof value.id === "string");
}

function parseFrame(value: unknown): LocalFrame | null {
  if (!isRecord(value) || typeof value.seq !== "number" || typeof value.kind !== "string") return null;

  if (value.kind === "snapshot") {
    if (!Array.isArray(value.entries) || !value.entries.every(isSessionEntry)) return null;
    if (value.header !== undefined && value.header !== null && !isSessionHeader(value.header)) return null;
    if (value.state !== undefined && value.state !== null && !isSessionState(value.state)) return null;
    if (value.agents !== undefined && (!Array.isArray(value.agents) || !value.agents.every(isAgentSnapshot))) return null;
    return {
      seq: value.seq,
      kind: "snapshot",
      header: value.header ?? null,
      entries: value.entries,
      state: value.state ?? null,
      agents: value.agents ?? [],
    };
  }

  if (value.kind === "state") {
    return isSessionState(value.state) ? { seq: value.seq, kind: "state", state: value.state } : null;
  }

  if (value.kind === "message") {
    if ((value.type !== "message_start" && value.type !== "message_update" && value.type !== "message_end") || !isWireMessage(value.message)) return null;
    return { seq: value.seq, kind: "message", type: value.type, message: value.message };
  }

  if (value.kind === "tool") {
    if ((value.type !== "tool_execution_start" && value.type !== "tool_execution_update" && value.type !== "tool_execution_end")
      || typeof value.toolCallId !== "string" || typeof value.toolName !== "string") return null;
    return {
      seq: value.seq,
      kind: "tool",
      type: value.type,
      toolCallId: value.toolCallId,
      toolName: value.toolName,
      args: value.args,
      partialResult: value.partialResult,
      result: value.result,
      isError: typeof value.isError === "boolean" ? value.isError : undefined,
      intent: typeof value.intent === "string" ? value.intent : undefined,
    };
  }

  return null;
}

function asAgentEvent(frame: LocalFrame): AgentEvent | null {
  if (frame.kind === "message") return { type: frame.type, message: frame.message };
  if (frame.kind === "tool") {
    return {
      type: frame.type,
      toolCallId: frame.toolCallId,
      toolName: frame.toolName,
      args: frame.args,
      partialResult: frame.partialResult,
      result: frame.result,
      isError: frame.isError,
      intent: frame.intent,
    };
  }
  return null;
}

export function useLocalSession(): UseCollabSessionReturn {
  const [status, setStatus] = useState<CollabStatus>("idle");
  const [ready, setReady] = useState(false);
  const [header, setHeader] = useState<SessionHeader | null>(null);
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [state, setState] = useState<SessionState | null>(null);
  const [agents, setAgents] = useState<AgentSnapshot[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceRef = useRef<EventSource | null>(null);
  const timerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const generationRef = useRef(0);
  const stoppedRef = useRef(false);
  const lastSeqRef = useRef(0);
  const headerIdRef = useRef<string | null>(null);
  const committedIdentitiesRef = useRef(new Set<string>());
  const committedToolCallIdsRef = useRef(new Set<string>());
  const connectRef = useRef<() => void>(() => {});

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const resetSession = useCallback(() => {
    lastSeqRef.current = 0;
    headerIdRef.current = null;
    committedIdentitiesRef.current = new Set();
    committedToolCallIdsRef.current = new Set();
    setHeader(null);
    setEntries([]);
    setEvents([]);
    setState(null);
    setAgents([]);
  }, []);

  const connect = useCallback(() => {
    if (stoppedRef.current) return;
    setStatus(attemptRef.current ? "reconnecting" : "connecting");
    const generation = generationRef.current;
    const authToken = new URLSearchParams(window.location.search).get("token") ?? "";
    const source = new EventSource(`/api/events?token=${encodeURIComponent(authToken)}&cursor=${lastSeqRef.current}`);
    sourceRef.current = source;

    source.onopen = () => {
      if (generation !== generationRef.current || stoppedRef.current) return;
      attemptRef.current = 0;
      setStatus("live");
      setReady(true);
      setReadOnly(false);
      setError(null);
    };

    source.onmessage = (event: MessageEvent<string>) => {
      if (generation !== generationRef.current || stoppedRef.current) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data) as unknown;
      } catch {
        return;
      }
      const frame = parseFrame(parsed);
      if (!frame) return;
      // Snapshots are authoritative full-state frames: always apply them, even
      // when seq is 0 (fresh SSE connect) or was reset by a session switch.
      if (frame.kind !== "snapshot" && frame.seq <= lastSeqRef.current) return;
      if (frame.seq > lastSeqRef.current) lastSeqRef.current = frame.seq;

      if (frame.kind === "snapshot") {
        const nextHeaderId = typeof frame.header?.id === "string" ? frame.header.id : null;
        if (headerIdRef.current !== null && nextHeaderId !== headerIdRef.current) resetSession();
        headerIdRef.current = nextHeaderId;
        const committed = committedMessageIdentities(frame.entries);
        const settledTools = committedToolCallIds(frame.entries);
        committedIdentitiesRef.current = committed;
        committedToolCallIdsRef.current = settledTools;
        setHeader(frame.header);
        setEntries(frame.entries);
        setEvents((previous) =>
          previous.filter((event) => {
            // A snapshot is the authoritative committed transcript boundary.
            // Drop every older message preview, including partial updates whose
            // content/timestamp cannot exactly match the committed final message.
            // Any genuinely newer stream frames arrive after this snapshot and
            // are appended again through the sequence-ordered SSE stream.
            if (isMessageAgentEvent(event)) return false;
            if (isToolAgentEvent(event)) return !settledTools.has(event.toolCallId);
            return true;
          }),
        );
        setState(frame.state);
        setAgents(frame.agents);
        return;
      }
      if (frame.kind === "state") {
        setState(frame.state);
        return;
      }

      const agentEvent = asAgentEvent(frame);
      if (!agentEvent) return;
      if (isMessageAgentEvent(agentEvent) && committedIdentitiesRef.current.has(messageIdentity(agentEvent.message))) return;
      if (isToolAgentEvent(agentEvent) && committedToolCallIdsRef.current.has(agentEvent.toolCallId)) return;
      setEvents((previous) => {
        const next = [...previous, agentEvent];
        return next.length > EVENTS_LIMIT ? next.slice(-EVENTS_LIMIT) : next;
      });
    };

    source.onerror = () => {
      if (generation !== generationRef.current || stoppedRef.current) return;
      source.close();
      sourceRef.current = null;
      resetSession();
      setReady(false);
      setStatus("reconnecting");
      setError("Connection to local session lost");
      const delay = Math.min(100 * 2 ** attemptRef.current++, MAX_BACKOFF_MS) * (0.9 + Math.random() * 0.2);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (generation !== generationRef.current || stoppedRef.current) return;
        connectRef.current();
      }, delay);
    };
  }, [resetSession]);
  connectRef.current = connect;

  const sendPrompt = useCallback(async (text: string): Promise<void> => {
    if (!text.trim()) throw new Error("Prompt is empty");
    const authToken = new URLSearchParams(window.location.search).get("token") ?? "";
    const response = await fetch(`/api/prompt?token=${encodeURIComponent(authToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `Prompt failed (${response.status})`);
    }
  }, []);

  const sendAbort = useCallback(async (): Promise<void> => {
    const authToken = new URLSearchParams(window.location.search).get("token") ?? "";
    const response = await fetch(`/api/abort?token=${encodeURIComponent(authToken)}`, { method: "POST" });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `Abort failed (${response.status})`);
    }
  }, []);

  const disconnect = useCallback(() => {
    stoppedRef.current = true;
    generationRef.current += 1;
    clearTimer();
    sourceRef.current?.close();
    sourceRef.current = null;
    setStatus("closed");
    setReady(false);
  }, []);

  const reconnect = useCallback(() => {
    stoppedRef.current = false;
    generationRef.current += 1;
    clearTimer();
    sourceRef.current?.close();
    sourceRef.current = null;
    attemptRef.current = 0;
    resetSession();
    setError(null);
    setReady(false);
    setStatus("connecting");
    connect();
  }, [connect, resetSession]);

  useEffect(() => {
    stoppedRef.current = false;
    generationRef.current += 1;
    const generation = generationRef.current;
    clearTimer();
    sourceRef.current?.close();
    sourceRef.current = null;
    attemptRef.current = 0;
    resetSession();
    setStatus("connecting");
    setReady(false);
    setError(null);
    connect();
    return () => {
      if (generation !== generationRef.current) return;
      stoppedRef.current = true;
      clearTimer();
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [connect, resetSession]);

  return { status, ready, header, entries, events, state, agents, readOnly, error, sendPrompt, sendAbort, reconnect, disconnect };
}
