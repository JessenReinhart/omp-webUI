import { useCallback, useEffect, useRef, useState } from "react";
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
  | { seq: number; kind: "snapshot"; header?: SessionHeader | null; entries: SessionEntry[]; state?: SessionState | null; agents?: AgentSnapshot[] }
  | { seq: number; kind: "message"; type: string; message: WireMessage }
  | { seq: number; kind: "tool"; type: string; toolCallId: string; toolName: string; args?: unknown; partialResult?: unknown; result?: unknown; isError?: boolean; intent?: string }
  | { seq: number; kind: "state"; state: SessionState };

function asAgentEvent(frame: LocalFrame): AgentEvent | null {
  if (frame.kind === "message") {
    return {
      type: frame.type as "message_start" | "message_update" | "message_end",
      message: frame.message,
    };
  }
  if (frame.kind === "tool") {
    return {
      type: frame.type as "tool_execution_start" | "tool_execution_update" | "tool_execution_end",
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
  const connectRef = useRef<() => void>(() => {});

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

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
      let frame: LocalFrame;
      try {
        frame = JSON.parse(event.data) as LocalFrame;
      } catch {
        return;
      }
      if (typeof frame.seq === "number" && frame.seq > lastSeqRef.current) lastSeqRef.current = frame.seq;

      if (frame.kind === "snapshot") {
        setHeader(frame.header ?? null);
        setEntries(Array.isArray(frame.entries) ? frame.entries : []);
        if (frame.state) setState(frame.state);
        setAgents(Array.isArray(frame.agents) ? frame.agents : []);
        return;
      }
      if (frame.kind === "state") {
        if (frame.state) setState(frame.state);
        return;
      }

      const agentEvent = asAgentEvent(frame);
      if (!agentEvent) return;
      setEvents((previous) => {
        const next = [...previous, agentEvent];
        return next.length > EVENTS_LIMIT ? next.slice(-EVENTS_LIMIT) : next;
      });
    };

    source.onerror = () => {
      if (generation !== generationRef.current || stoppedRef.current) return;
      source.close();
      sourceRef.current = null;
      setStatus("reconnecting");
      setError("Connection to local session lost");
      const delay = Math.min(100 * 2 ** attemptRef.current++, MAX_BACKOFF_MS) * (0.9 + Math.random() * 0.2);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        connectRef.current();
      }, delay);
    };
  }, []);
  connectRef.current = connect;

  const sendPrompt = useCallback(
    async (text: string): Promise<void> => {
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
    },
    [],
  );

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
    setError(null);
    setReady(false);
    setStatus("connecting");
    connect();
  }, [connect]);

  useEffect(() => {
    stoppedRef.current = false;
    generationRef.current += 1;
    const generation = generationRef.current;
    clearTimer();
    sourceRef.current?.close();
    sourceRef.current = null;
    attemptRef.current = 0;
    setStatus("connecting");
    setReady(false);
    setHeader(null);
    setEntries([]);
    setEvents([]);
    setState(null);
    setAgents([]);
    setError(null);
    connect();
    return () => {
      if (generation !== generationRef.current) return;
      stoppedRef.current = true;
      clearTimer();
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [connect]);

  return { status, ready, header, entries, events, state, agents, readOnly, error, sendPrompt, sendAbort, reconnect, disconnect };
}
