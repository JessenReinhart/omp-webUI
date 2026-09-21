import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionEntry } from "./collabTypes";
import { isRecord } from "./transcript-model";

/** Server shape for GET /api/agents/:agentId/transcript. */
interface AgentTranscriptResponse {
  agentId: string;
  kind: string;
  status: string;
  activity: string | null;
  hasSessionFile: boolean;
  source: "live" | "parked" | "none";
  entries: unknown[];
}

export interface AgentTranscript {
  agentId: string;
  kind: string | null;
  status: string | null;
  /** Lets the UI tell "no session file yet" from "empty transcript". Never rendered. */
  hasSessionFile: boolean;
  /** Latest registry activity gist (current tool / last intent), when known. */
  activity: string | null;
  entries: SessionEntry[];
}

/** Failure tagged with the agent it belongs to, so a superseded error can't render. */
export interface AgentTranscriptError {
  agentId: string;
  message: string;
}

export interface AgentTranscriptState {
  transcript: AgentTranscript | null;
  loading: boolean;
  error: AgentTranscriptError | null;
  reload: () => void;
}

// Failure buckets surfaced to the user. Raw server/transport messages stay in
// the console only — they can carry absolute paths and never belong in the DOM.
type TranscriptFailure = "offline" | "unauthorized" | "missing" | "unreadable";

const TRANSCRIPT_COPY: Record<TranscriptFailure, string> = {
  offline: "Can't reach the OMP server right now. Make sure it is still running, then try again.",
  unauthorized: "This page lost its authorization for agent transcripts. Reload the page to reconnect.",
  missing: "That agent has no readable transcript. It may have been parked or cleaned up.",
  unreadable: "OMP couldn't read this agent's transcript. Try again.",
};

function parseTranscript(body: unknown, requestedId: string): AgentTranscript | null {
  if (!isRecord(body)) return null;
  const payload = body as Partial<AgentTranscriptResponse>;
  if (!Array.isArray(payload.entries)) return null;
  return {
    agentId: typeof payload.agentId === "string" && payload.agentId ? payload.agentId : requestedId,
    kind: typeof payload.kind === "string" ? payload.kind : null,
    status: typeof payload.status === "string" ? payload.status : null,
    hasSessionFile: payload.hasSessionFile === true,
    activity: typeof payload.activity === "string" ? payload.activity : null,
    // Entries stay `unknown` at the boundary; TranscriptEntry re-validates each one.
    entries: payload.entries as SessionEntry[],
  };
}

/**
 * Read-only transcript for one registry agent.
 *
 * Fetches only while `enabled` (panel visible) and an agent is actually
 * selected. In-flight requests are superseded the same way App.tsx supersedes
 * past-session loads: an AbortController aborts the previous request and a
 * monotonic sequence number keeps a late resolution from overwriting a newer
 * selection.
 */
export function useAgentTranscript(agentId: string | null, enabled: boolean): AgentTranscriptState {
  const authToken = useMemo(() => new URLSearchParams(window.location.search).get("token") ?? "", []);
  const [transcript, setTranscript] = useState<AgentTranscript | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AgentTranscriptError | null>(null);
  const [nonce, setNonce] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Guard: nothing is fetched while the drawer is hidden or no run is selected.
    if (!enabled || !agentId) {
      abortRef.current?.abort();
      abortRef.current = null;
      seqRef.current += 1;
      setTranscript(null);
      setLoading(false);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const seq = ++seqRef.current;
    const stale = () => ac.signal.aborted || seq !== seqRef.current;

    setTranscript(null);
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const url = `/api/agents/${encodeURIComponent(agentId)}/transcript?token=${encodeURIComponent(authToken)}`;
        const response = await fetch(url, { signal: ac.signal });
        if (stale()) return;

        const body = (await response.json().catch(() => null)) as unknown;
        if (stale()) return;

        const parsed = response.ok ? parseTranscript(body, agentId) : null;
        if (!parsed) {
          let failure: TranscriptFailure = "unreadable";
          if (response.status === 401 || response.status === 403) failure = "unauthorized";
          else if (response.status === 404) failure = "missing";
          setError({ agentId, message: TRANSCRIPT_COPY[failure] });
          return;
        }

        setTranscript(parsed);
        setError(null);
      } catch (err) {
        if (stale()) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const failure: TranscriptFailure =
          typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "unreadable";
        setError({ agentId, message: TRANSCRIPT_COPY[failure] });
      } finally {
        if (seq === seqRef.current && !ac.signal.aborted) setLoading(false);
        if (abortRef.current === ac) abortRef.current = null;
      }
    };

    void load();

    return () => {
      ac.abort();
    };
  }, [agentId, authToken, enabled, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { transcript, loading, error, reload };
}
