import { ArrowLeft, Clock, Radio } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface SessionSummary {
  id: string;
  title: string;
  cwd: string;
  created: string;
  modified: string;
  messageCount: number;
  fileId: string;
}

interface SessionsResponse {
  ok: boolean;
  sessions?: Array<{
    id: string;
    title?: string;
    cwd?: string;
    created?: string | number | Date;
    modified?: string | number | Date;
    messageCount?: number;
    fileId: string;
  }>;
  error?: string;
}

export interface SessionListProps {
  token: string;
  onSelectSession: (fileId: string, title?: string) => void;
  selectedFileId?: string | null;
  onBackToLive?: () => void;
  liveTitle?: string;
  liveSubtitle?: string;
  liveActive?: boolean;
  connectionState?: "connected" | "waiting";
}

const LOAD_ERROR_MESSAGE = "Could not load past sessions. Check your connection and try again.";

function toIsoString(value: string | number | Date | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  return value ?? "";
}

function formatModifiedTime(value: string): string {
  const modified = new Date(value);
  const timestamp = modified.getTime();

  if (!value || Number.isNaN(timestamp)) return "Unknown";

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (elapsedSeconds < 60) return "just now";
  if (elapsedSeconds < 3_600) return `${Math.floor(elapsedSeconds / 60)}m ago`;
  if (elapsedSeconds < 86_400) return `${Math.floor(elapsedSeconds / 3_600)}h ago`;
  if (elapsedSeconds < 604_800) return `${Math.floor(elapsedSeconds / 86_400)}d ago`;

  return modified.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function messageCountLabel(count: number): string {
  return `${count} ${count === 1 ? "msg" : "msgs"}`;
}

export function SessionList({
  token,
  onSelectSession,
  selectedFileId,
  onBackToLive,
  liveTitle = "Live session",
  liveSubtitle = "Connected to running OMP process",
  liveActive = true,
  connectionState = "connected",
}: SessionListProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadSessions = useCallback(
    async (silent = false) => {
      if (!silent && mountedRef.current) setLoading(true);
      try {
        const response = await fetch(`/api/sessions?token=${encodeURIComponent(token)}`);
        const payload = (await response.json()) as SessionsResponse;

        if (!response.ok || !payload.ok || !Array.isArray(payload.sessions)) {
          throw new Error("sessions request failed");
        }

        if (!mountedRef.current) return;

        setSessions(
          payload.sessions.map((session) => ({
            id: session.id,
            title: session.title || session.id,
            cwd: session.cwd || "",
            created: toIsoString(session.created),
            modified: toIsoString(session.modified),
            messageCount: session.messageCount ?? 0,
            fileId: session.fileId,
          })),
        );
        setError(false);
      } catch {
        if (mountedRef.current) setError(true);
      } finally {
        if (mountedRef.current && !silent) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void loadSessions(false);
    const poller = window.setInterval(() => void loadSessions(true), 5_000);

    return () => {
      window.clearInterval(poller);
    };
  }, [loadSessions]);

  const showLoading = loading && sessions.length === 0 && !error;
  const showEmpty = !loading && !error && sessions.length === 0;

  return (
    <div className="session-list-wrapper">
      <div className="session-list-section">
        <span className="session-group-label">Active</span>
        <button
          className={`session-row live-row${liveActive ? " active" : ""}`}
          type="button"
          onClick={onBackToLive}
          aria-current={liveActive ? "page" : undefined}
          title={liveTitle}
        >
          <span className="session-icon" aria-hidden="true">
            <Radio size={14} />
          </span>
          <span className="session-copy">
            <span className="session-title-line">
              <strong>{liveTitle}</strong>
              <span className={`live-badge${connectionState === "connected" ? " is-connected" : ""}`}>
                {connectionState === "connected" ? "Live" : "Waiting"}
              </span>
            </span>
            <p>{liveSubtitle}</p>
          </span>
        </button>
      </div>

      <section className="session-list" aria-label="Past sessions" aria-busy={loading}>
        <div className="session-list-header">
          <span className="session-group-label session-list-heading">Past sessions</span>
          {!loading && !error && sessions.length > 0 ? (
            <span className="session-list-count" aria-label={`${sessions.length} past sessions`}>
              {sessions.length}
            </span>
          ) : null}
        </div>

        {selectedFileId && onBackToLive ? (
          <button className="session-row session-list-live-row" type="button" onClick={onBackToLive}>
            <span className="session-icon" aria-hidden="true">
              <ArrowLeft size={13} />
            </span>
            <span className="session-copy">
              <span className="session-title-line">
                <strong>Return to live session</strong>
              </span>
            </span>
          </button>
        ) : null}

        {showLoading ? (
          <div className="session-list-status" role="status">
            <span className="session-list-spinner" aria-hidden="true" />
            <p>Loading past sessions…</p>
          </div>
        ) : null}

        {error && sessions.length === 0 ? (
          <div className="session-list-error" role="alert">
            <p>{LOAD_ERROR_MESSAGE}</p>
            <button className="session-list-retry" type="button" onClick={() => void loadSessions(false)}>
              Try again
            </button>
          </div>
        ) : null}

        {showEmpty ? (
          <div className="session-list-empty">
            <p className="session-list-empty-title">No past sessions</p>
            <p className="session-list-empty-copy">Finished sessions will appear here.</p>
          </div>
        ) : null}

        <div className="session-rows-group" role="list">
          {sessions.map((session) => {
            const isActive = session.fileId === selectedFileId;
            return (
              <button
                className={`session-row${isActive ? " active" : ""}`}
                key={session.fileId}
                type="button"
                onClick={() => onSelectSession(session.fileId, session.title)}
                aria-current={isActive ? "true" : undefined}
                title={session.title}
              >
                <span className="session-icon" aria-hidden="true">
                  <Clock size={13} />
                </span>
                <span className="session-copy">
                  <span className="session-title-line">
                    <strong>{session.title}</strong>
                    <span>{formatModifiedTime(session.modified)}</span>
                  </span>
                  <p>{messageCountLabel(session.messageCount)}</p>
                </span>
                <span className="session-more" aria-hidden="true">
                  ›
                </span>
              </button>
            );
          })}
        </div>

        {error && sessions.length > 0 ? (
          <div className="session-list-stale" role="status">
            <p>List may be out of date.</p>
            <button
              className="session-list-retry session-list-retry-compact"
              type="button"
              onClick={() => void loadSessions(true)}
            >
              Retry
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
