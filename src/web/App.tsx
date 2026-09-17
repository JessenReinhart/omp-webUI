import { Circle, Terminal, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollabComposer } from "./CollabComposer";
import { CollabControls } from "./CollabControls";
import { CollabTranscript } from "./CollabTranscript";
import { FullTranscriptViewer } from "./FullTranscriptViewer";
import { SessionList } from "./SessionList";
import type { SessionEntry } from "./collabTypes";
import { Slot } from "./plugin-system";
import { useLocalSession } from "./useLocalSession";

interface SessionHost {
  sessionName?: string;
  cwd?: string;
  model?: unknown;
}

interface SessionResponse {
  connected: boolean;
  reason?: string;
  error?: string;
  host?: SessionHost;
  transport?: string;
}

interface TranscriptResponse {
  ok?: boolean;
  entries?: unknown;
  error?: string;
}

// Failure buckets surfaced to the user. Raw server/transport messages stay in the
// console only — they can carry absolute paths, and never belong in the DOM.
type PastSessionFailure = "offline" | "unauthorized" | "missing" | "unreadable";

const PAST_SESSION_COPY: Record<PastSessionFailure, string> = {
  offline: "Can't reach the OMP server right now. Make sure it is still running, then try again.",
  unauthorized: "This page lost its authorization for past sessions. Reload the page to reconnect.",
  missing: "That past session is no longer available. It may have been removed or renamed.",
  unreadable: "OMP couldn't read that past session. Try again, or pick another session.",
};

function displayModel(model: unknown) {
  if (!model) return "OMP model";
  if (typeof model === "string") return model;
  if (typeof model === "object") {
    const record = model as Record<string, unknown>;
    return String(record.name ?? record.id ?? record.model ?? "OMP model");
  }
  return "OMP model";
}

function workspaceName(path?: string) {
  if (!path) return "workspace";
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? "workspace";
}

function OmpMark() {
  return <div className="omp-mark" aria-label="omp">π</div>;
}

function SessionRow({ title, subtitle, time }: { title: string; subtitle: string; time: string }) {
  return (
    <div className="session-row active">
      <div className="session-icon"><Circle size={13} strokeWidth={1.6} /></div>
      <div className="session-copy">
        <div className="session-title-line"><strong>{title}</strong><span>{time}</span></div>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const authToken = useMemo(() => new URLSearchParams(window.location.search).get("token") ?? "", []);
  // Session discovery: poll the loopback API until an active OMP runtime answers.
  const [sessionNonce, setSessionNonce] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const refresh = async () => {
      try {
        const response = await fetch(`/api/session?token=${encodeURIComponent(authToken)}`, {
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as SessionResponse | null;
        if (!active) return;
        if (!response.ok || !payload) {
          setSession(null);
        } else {
          setSession(payload);
        }
      } catch {
        if (active) setSession(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    void refresh();
    const intervalId = window.setInterval(refresh, 2500);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [authToken, sessionNonce]);

  // Past session state
  const [pastSessionId, setPastSessionId] = useState<string | null>(null);
  const [pastSessionTitle, setPastSessionTitle] = useState<string | null>(null);
  const [pastEntries, setPastEntries] = useState<SessionEntry[]>([]);
  const [loadingPast, setLoadingPast] = useState<boolean>(false);
  const [errorPast, setErrorPast] = useState<string | null>(null);

  // Sequence guard + cancellation controller so rapid session clicking never lets
  // slow responses from selection A overwrite newer selection B.
  const pastFetchAbortRef = useRef<AbortController | null>(null);
  const pastFetchSeqRef = useRef<number>(0);

  // Abort any in-flight past-session fetch when the component unmounts.
  useEffect(() => {
    return () => {
      pastFetchAbortRef.current?.abort();
    };
  }, []);

  const handleSelectSession = useCallback(
    async (fileId: string, title?: string) => {
      // Cancel any previous session transcript request and advance the sequence.
      pastFetchAbortRef.current?.abort();
      const ac = new AbortController();
      pastFetchAbortRef.current = ac;
      const seq = ++pastFetchSeqRef.current;

      setPastSessionId(fileId);
      setPastSessionTitle(title ?? fileId);
      setLoadingPast(true);
      setErrorPast(null);
      setPastEntries([]);

      try {
        const url = `/api/sessions/${encodeURIComponent(fileId)}?token=${encodeURIComponent(authToken)}`;
        const response = await fetch(url, { signal: ac.signal });

        if (ac.signal.aborted || seq !== pastFetchSeqRef.current) return;

        let data: TranscriptResponse | null = null;
        try {
          data = (await response.json()) as TranscriptResponse;
        } catch {
          data = null;
        }

        if (ac.signal.aborted || seq !== pastFetchSeqRef.current) return;

        if (!response.ok || !data || data.ok !== true || !Array.isArray(data.entries)) {
          let failure: PastSessionFailure = "unreadable";
          if (response.status === 401 || response.status === 403) failure = "unauthorized";
          else if (response.status === 404) failure = "missing";
          else if (response.status >= 500) failure = "unreadable";

          setErrorPast(PAST_SESSION_COPY[failure]);
          return;
        }

        setPastEntries(data.entries as SessionEntry[]);
        setErrorPast(null);
      } catch (err) {
        if (ac.signal.aborted || seq !== pastFetchSeqRef.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;

        const failure: PastSessionFailure =
          typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "unreadable";
        setErrorPast(PAST_SESSION_COPY[failure]);
      } finally {
        if (seq === pastFetchSeqRef.current && !ac.signal.aborted) {
          setLoadingPast(false);
          if (pastFetchAbortRef.current === ac) {
            pastFetchAbortRef.current = null;
          }
        }
      }
    },
    [authToken],
  );

  const handleBackToLive = useCallback(() => {
    // Immediately cancel any pending past session fetch so it cannot settle
    // into state after the user has navigated back to the live view.
    pastFetchAbortRef.current?.abort();
    pastFetchAbortRef.current = null;
    pastFetchSeqRef.current += 1;

    setPastSessionId(null);
    setPastSessionTitle(null);
    setPastEntries([]);
    setLoadingPast(false);
    setErrorPast(null);
  }, []);

  const handleRetryPastSession = useCallback(() => {
    if (!pastSessionId) return;
    void handleSelectSession(pastSessionId, pastSessionTitle ?? undefined);
  }, [pastSessionId, pastSessionTitle, handleSelectSession]);
  // Resume a past session: make it the active OMP session via switchSession,
  // then drop back to the live view so the composer works immediately.
  const [resumingPast, setResumingPast] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const handleResumePastSession = useCallback(async () => {
    if (!pastSessionId || resumingPast) return;
    setResumingPast(true);
    setResumeError(null);
    try {
      const url = `/api/sessions/${encodeURIComponent(pastSessionId)}/resume?token=${encodeURIComponent(authToken)}`;
      const response = await fetch(url, { method: "POST" });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setResumeError("Couldn’t resume this session (not authorized).");
        } else if (response.status === 409) {
          setResumeError("Session switch was cancelled.");
        } else if (response.status >= 500) {
          setResumeError("Couldn’t resume this session. The server hit an error.");
        } else {
          setResumeError("Couldn’t resume this session. Try again.");
        }
        return;
      }
      const payload = (await response.json().catch(() => null)) as { ok?: boolean } | null;
      if (!payload || payload.ok !== true) {
        setResumeError("Couldn’t resume this session. Try again.");
        return;
      }
      handleBackToLive();
      setSessionNonce((n) => n + 1);
    } catch {
      setResumeError("Couldn’t resume this session. Check your connection and try again.");
    } finally {
      setResumingPast(false);
    }
  }, [authToken, pastSessionId, resumingPast, handleBackToLive]);

  const connected = Boolean(session?.connected);
  const collab = useLocalSession();
  const host = session?.host;
  const currentTitle = host?.sessionName || "Current OMP session";
  const currentWorkspace = workspaceName(host?.cwd);
  const currentModel = displayModel(host?.model);
  const currentSubtitle = connected
    ? host?.cwd || "Connected to running OMP process"
    : session?.error || session?.reason || "Waiting for OMP session";
  const hasAgents = collab.agents.length > 0;
  const isStreaming = collab.state?.isStreaming === true;
  const queuedMessages = collab.state?.queuedMessageCount ?? 0;

  return (
    <div className="app-shell">
      <aside className="utility-rail">
        <div className="rail-top"><OmpMark /><div className="rail-button active" aria-label="Session"><Terminal size={18} /></div></div>
      </aside>

      <aside className="session-sidebar">
        <div className="workspace-switcher"><span className="section-label">Live workspace</span><strong>{currentWorkspace}</strong></div>
        <div className="current-session-block">
          <span className="session-group-label">Current session</span>
          <SessionRow title={currentTitle} subtitle={currentSubtitle} time={loading ? "…" : connected ? "Now" : "Offline"} />
        </div>
        <SessionList
          token={authToken}
          onSelectSession={handleSelectSession}
          selectedFileId={pastSessionId}
          onBackToLive={handleBackToLive}
        />
        {connected && isStreaming && <div className="subagent-note">Streaming · {queuedMessages} queued message{queuedMessages === 1 ? "" : "s"}</div>}
        <div className="session-sidebar-footer"><span className={`connection-dot${connected ? " connected" : ""}`} /><span>{connected ? "OMP connected" : "Waiting for OMP"}</span></div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{currentWorkspace}</span>
            <strong>{pastSessionId ? (pastSessionTitle || pastSessionId) : currentTitle}</strong>
          </div>
          <span className="model-button">{currentModel}</span>
        </header>
        <section className="conversation" aria-label={pastSessionId ? "Past session transcript" : "Live session"}>
          <Slot name="chat.before" />
          {pastSessionId ? (
            <div className="past-session-container">
              <div className="past-session-header">
                <div className="past-session-heading">
                  <span className="past-session-kicker">Viewed past session</span>
                  <h1 className="past-session-title">{pastSessionTitle || pastSessionId}</h1>
                </div>
                <div className="past-session-header-actions">
                  <button
                    className="past-session-resume"
                    type="button"
                    onClick={handleResumePastSession}
                    disabled={resumingPast}
                    aria-busy={resumingPast}
                  >
                    {resumingPast ? "Resuming…" : "Resume in OMP"}
                  </button>
                  <button className="past-session-back" type="button" onClick={handleBackToLive}>
                    ← Back to live
                  </button>
                  {resumeError && (
                    <span className="past-session-resume-error" role="status">
                      {resumeError}
                    </span>
                  )}
                </div>
              </div>
              {loadingPast ? (
                <div className="past-session-state" role="status" aria-live="polite" aria-busy="true">
                  <span className="past-session-spinner" aria-hidden="true" />
                  <p className="past-session-state-copy">Loading past session transcript…</p>
                </div>
              ) : errorPast ? (
                <div className="past-session-state past-session-state-error" role="alert">
                  <strong className="past-session-state-title">Couldn’t load this past session</strong>
                  <p className="past-session-state-copy">{errorPast}</p>
                  <div className="past-session-state-actions">
                    <button className="past-session-retry" type="button" onClick={handleRetryPastSession}>
                      Try again
                    </button>
                    <button className="past-session-back past-session-back-secondary" type="button" onClick={handleBackToLive}>
                      Back to live session
                    </button>
                  </div>
                </div>
              ) : (
                <FullTranscriptViewer entries={pastEntries} />
              )}
            </div>
          ) : (
            connected ? (
              <>
                <CollabControls status={collab.status} readOnly={collab.readOnly} error={collab.error} onReconnect={collab.reconnect} onDisconnect={collab.disconnect} />
                <CollabTranscript entries={collab.entries} events={collab.events} status={collab.status} />
              </>
            ) : (
              <div className="transport-state">
                <OmpMark />
                <div className="transport-copy">
                  <span className="transport-kicker">{loading ? "DISCOVERING SESSION" : "WAITING FOR OMP"}</span>
                  <h1>{loading ? "Finding your OMP session..." : "No active OMP session"}</h1>
                  <p>{loading ? currentSubtitle : <>Run <code>/webui</code> in OMP to open this workspace.</>}</p>
                </div>
              </div>
            )
          )}
          <Slot name="chat.after" />
          {!pastSessionId && (
            <CollabComposer disabled={!connected || !collab.ready || collab.readOnly || collab.status !== "live"} placeholder={connected ? "Message OMP..." : "Connect an OMP session to start chatting"} isStreaming={isStreaming} onSend={collab.sendPrompt} onAbort={collab.sendAbort} />
          )}
        </section>
      </main>

      <aside className="subagents-panel">
        <div className="subagents-header"><div><h2>Agents</h2><p>{hasAgents ? `${collab.agents.length} active agent${collab.agents.length === 1 ? "" : "s"}` : "No active agents"}</p></div></div>
        {hasAgents ? (
          <div className="agents-list">
            {collab.agents.map((agent) => (
              <div key={agent.id} className="agent-card">
                <div className="agent-main">
                  <div className="agent-heading"><strong>{agent.displayName}</strong>{agent.kind === "sub" && <span className="agent-parent">subagent</span>}</div>
                  <div className={`agent-status${agent.status === "running" ? " live" : ""}`}><i aria-hidden="true" />{agent.status}</div>
                </div>
                <div className="agent-meta">
                  {agent.lastActivity && <small>Last activity {new Date(agent.lastActivity).toLocaleTimeString()}</small>}
                  {agent.hasSessionFile && <small>Session file available</small>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="subagent-empty">
            <Users size={19} />
            <strong>No agents yet</strong>
            <p>OMP subagents appear here while they run.</p>
          </div>
        )}
        <Slot name="agent.panel" />
      </aside>
    </div>
  );
}
