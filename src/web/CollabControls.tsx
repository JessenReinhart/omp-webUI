import type { CollabControlsProps, CollabStatus } from "./collabTypes";

const STATUS_LABELS: Record<CollabStatus, string> = {
  idle: "Not connected",
  connecting: "Connecting",
  live: "Connected",
  reconnecting: "Reconnecting",
  closed: "Disconnected",
  error: "Connection error",
};

const STATUS_MODIFIERS: Record<CollabStatus, string> = {
  idle: "is-idle",
  connecting: "is-busy",
  live: "is-live",
  reconnecting: "is-busy",
  closed: "is-error",
  error: "is-error",
};

export function CollabControls({
  status,
  readOnly,
  error,
  sessionReady = true,
  onReconnect,
  onDisconnect,
}: CollabControlsProps & { sessionReady?: boolean }) {
  const isLive = status === "live";
  const canRetry = status === "error" || status === "closed" || status === "reconnecting";
  const busy = status === "connecting" || status === "reconnecting";

  // Without a discovered OMP session there is nothing to connect to or control:
  // a single waiting chip replaces the whole control group.
  if (!sessionReady) {
    return (
      <div className="connection-controls" role="group" aria-label="Session connection status">
        <span className="status-chip is-idle" role="status" aria-live="polite">
          <i aria-hidden="true" />
          Waiting for OMP
        </span>
      </div>
    );
  }

  return (
    <div className="connection-controls" role="group" aria-label="Session connection controls">
      <span className={`status-chip ${STATUS_MODIFIERS[status]}`} role="status" aria-live="polite">
        <i aria-hidden="true" />
        {STATUS_LABELS[status]}
      </span>

      {readOnly ? <span className="status-chip is-readonly">Read-only</span> : null}

      {error ? (
        <span className="visually-hidden" role="alert">
          The session connection failed. No connection details are shown for security.
        </span>
      ) : null}

      {canRetry ? (
        <button
          type="button"
          className="button-ghost"
          onClick={onReconnect}
          aria-label="Retry session connection"
          disabled={busy}
        >
          Retry
        </button>
      ) : null}

      {isLive ? (
        <button type="button" className="button-ghost" onClick={onDisconnect} aria-label="Disconnect session">
          Disconnect
        </button>
      ) : null}
    </div>
  );
}
