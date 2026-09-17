import { Menu, PanelRightClose, PanelRightOpen, X } from "lucide-react";
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
  return (
    <div className="omp-mark" aria-hidden="true">
      π
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const authToken = useMemo(() => new URLSearchParams(window.location.search).get("token") ?? "", []);
  // Session discovery: poll the loopback API until an active OMP runtime answers.
  const [sessionNonce, setSessionNonce] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  // Once the user explicitly opens/closes the agents panel, stop auto-opening it.
  const agentsTouchedRef = useRef(false);

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
        setSession(!response.ok || !payload ? null : payload);
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

  useEffect(() => {
    return () => {
      pastFetchAbortRef.current?.abort();
    };
  }, []);

  const handleSelectSession = useCallback(
    async (fileId: string, title?: string) => {
      pastFetchAbortRef.current?.abort();
      const ac = new AbortController();
      pastFetchAbortRef.current = ac;
      const seq = ++pastFetchSeqRef.current;

      setPastSessionId(fileId);
      setPastSessionTitle(title ?? fileId);
      setLoadingPast(true);
      setErrorPast(null);
      setPastEntries([]);
      setSidebarOpen(false);

      try {
        const url = `/api/sessions/${encodeURIComponent(fileId)}?token=${encodeURIComponent(authToken)}`;
        const response = await fetch(url, { signal: ac.signal });
        if (ac.signal.aborted || seq !== pastFetchSeqRef.current) return;

        const data = (await response.json().catch(() => null)) as TranscriptResponse | null;
        if (ac.signal.aborted || seq !== pastFetchSeqRef.current) return;

        if (!response.ok || !data || data.ok !== true || !Array.isArray(data.entries)) {
          let failure: PastSessionFailure = "unreadable";
          if (response.status === 401 || response.status === 403) failure = "unauthorized";
          else if (response.status === 404) failure = "missing";
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
          if (pastFetchAbortRef.current === ac) pastFetchAbortRef.current = null;
        }
      }
    },
    [authToken],
  );

  const handleBackToLive = useCallback(() => {
    pastFetchAbortRef.current?.abort();
    pastFetchAbortRef.current = null;
    pastFetchSeqRef.current += 1;
    setPastSessionId(null);
    setPastSessionTitle(null);
    setPastEntries([]);
    setLoadingPast(false);
    setErrorPast(null);
    setSidebarOpen(false);
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
  const viewedTitle = pastSessionId ? pastSessionTitle || pastSessionId : currentTitle;
  const connectionLabel = loading && !connected ? "Discovering" : connected ? "Connected" : "Waiting for OMP";

  // Auto-open the agents panel when agents first appear, unless the user has
  // already toggled it by hand.
  useEffect(() => {
    if (hasAgents && !agentsTouchedRef.current) setAgentsOpen(true);
    if (!hasAgents) setAgentsOpen(false);
  }, [hasAgents]);

  // Escape dismisses whichever overlay drawer is open.
  useEffect(() => {
    if (!sidebarOpen && !agentsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSidebarOpen(false);
      setAgentsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen, agentsOpen]);

  return (
    <div className={`app-shell${sidebarOpen ? " sidebar-is-open" : ""}${agentsOpen ? " agents-is-open" : ""}`}>
      <div className="sidebar-scrim" aria-hidden="true" onClick={() => setSidebarOpen(false)} />

      <aside className="session-sidebar" aria-label="Session navigation">
        <div className="sidebar-heading">
          <OmpMark />
          <div className="sidebar-heading-copy">
            <span className="sidebar-heading-label">Workspace</span>
            <strong title={host?.cwd || currentWorkspace}>{currentWorkspace}</strong>
          </div>
          <button
            className="icon-button sidebar-close"
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close session navigation"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <Slot name="sidebar.top" />
        <nav className="session-nav" aria-label="Current session">
          <SessionList
            token={authToken}
            onSelectSession={handleSelectSession}
            selectedFileId={pastSessionId}
            onBackToLive={handleBackToLive}
            liveTitle={currentTitle}
            liveSubtitle={currentSubtitle}
            liveActive={!pastSessionId}
            connectionState={connected ? "connected" : "waiting"}
          />
        </nav>
        <Slot name="sidebar.bottom" />
      </aside>

      <main className="main-column">
        <header className="topbar">
          <button
            className="icon-button nav-trigger"
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open session navigation"
          >
            <Menu size={18} aria-hidden="true" />
          </button>
          <div className="session-heading">
            <h1 title={viewedTitle}>{viewedTitle}</h1>
            <span className={`connection-label${connected ? " is-connected" : ""}`}>{connectionLabel}</span>
          </div>
          <div className="topbar-actions">
            <span className="model-chip" title={currentModel}>
              {currentModel}
            </span>
            <CollabControls
              status={collab.status}
              readOnly={collab.readOnly}
              error={collab.error}
              sessionReady={connected}
              onReconnect={collab.reconnect}
              onDisconnect={collab.disconnect}
            />
            {hasAgents ? (
              <button
                className="icon-button agents-trigger"
                type="button"
                onClick={() => {
                  agentsTouchedRef.current = true;
                  setAgentsOpen((open) => !open);
                }}
                aria-expanded={agentsOpen}
                aria-controls="agents-panel"
                aria-label={agentsOpen ? "Hide agents" : "Show agents"}
                title={agentsOpen ? "Hide agents" : "Show agents"}
              >
                {agentsOpen ? (
                  <PanelRightClose size={18} aria-hidden="true" />
                ) : (
                  <PanelRightOpen size={18} aria-hidden="true" />
                )}
              </button>
            ) : null}
          </div>
        </header>

        <section className="conversation" aria-label={pastSessionId ? "Past session transcript" : "Live session"}>
          <Slot name="chat.before" />
          {pastSessionId ? (
            <div className="past-session-container">
              <div className="past-session-header">
                <div className="past-session-heading">
                  <span className="past-session-kicker">Read-only</span>
                  <h2 className="past-session-title">{pastSessionTitle || pastSessionId}</h2>
                </div>
                <div className="past-session-actions">
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
                    Back to live
                  </button>
                </div>
              </div>
              {resumeError ? (
                <p className="past-session-resume-error" role="status">
                  {resumeError}
                </p>
              ) : null}
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
                    <button
                      className="past-session-back past-session-back-secondary"
                      type="button"
                      onClick={handleBackToLive}
                    >
                      Back to live session
                    </button>
                  </div>
                </div>
              ) : (
                <FullTranscriptViewer entries={pastEntries} />
              )}
            </div>
          ) : connected ? (
            <>
              <CollabTranscript entries={collab.entries} events={collab.events} status={collab.status} />
              {isStreaming ? (
                <p className="streaming-note" role="status" aria-live="polite">
                  Streaming{queuedMessages > 0 ? ` · ${queuedMessages} queued` : ""}
                </p>
              ) : null}
            </>
          ) : (
            <div className="transport-state">
              <OmpMark />
              <div className="transport-copy">
                <span className="transport-kicker">{loading ? "Discovering session" : "Waiting for OMP"}</span>
                <h2>{loading ? "Finding your OMP session…" : "No active OMP session"}</h2>
                <p>{loading ? currentSubtitle : <>Run <code>/webui</code> in OMP to open this workspace.</>}</p>
              </div>
            </div>
          )}
          <Slot name="chat.after" />
          {!pastSessionId ? (
            <CollabComposer
              disabled={!connected || !collab.ready || collab.readOnly || collab.status !== "live"}
              placeholder={connected ? "Message OMP..." : "Connect an OMP session to start chatting"}
              isStreaming={isStreaming}
              onSend={collab.sendPrompt}
              onAbort={collab.sendAbort}
            />
          ) : null}
        </section>
      </main>

      {hasAgents ? (
        <aside id="agents-panel" className="subagents-panel" aria-label="Agents" inert={!agentsOpen}>
          <div className="subagents-header">
            <div>
              <h2>Agents</h2>
              <p>{`${collab.agents.length} active agent${collab.agents.length === 1 ? "" : "s"}`}</p>
            </div>
            <button
              className="icon-button agents-close"
              type="button"
              onClick={() => {
                agentsTouchedRef.current = true;
                setAgentsOpen(false);
              }}
              aria-label="Hide agents"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="agents-list">
            {collab.agents.map((agent) => (
              <article key={agent.id} className="agent-card">
                <div className="agent-main">
                  <div className="agent-heading">
                    <strong>{agent.displayName}</strong>
                    {agent.kind === "sub" ? <span className="agent-parent">subagent</span> : null}
                  </div>
                  <div className={`agent-status${agent.status === "running" ? " live" : ""}`}>
                    <i aria-hidden="true" />
                    {agent.status}
                  </div>
                </div>
                <div className="agent-meta">
                  {agent.lastActivity ? (
                    <small>Last activity {new Date(agent.lastActivity).toLocaleTimeString()}</small>
                  ) : null}
                  {agent.hasSessionFile ? <small>Session file available</small> : null}
                </div>
              </article>
            ))}
          </div>
          <Slot name="agent.panel" />
        </aside>
      ) : null}
    </div>
  );
}
