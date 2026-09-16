import type { CollabControlsProps, CollabStatus } from "./collabTypes";

const STATUS_LABELS: Record<CollabStatus, string> = {
  idle: "Not connected",
  connecting: "Connecting",
  live: "Connected",
  reconnecting: "Reconnecting",
  closed: "Disconnected",
  error: "Connection error",
};

export function CollabControls({
  status,
  readOnly,
  error,
  onReconnect,
  onDisconnect,
}: CollabControlsProps) {
  const isLive = status === "live";
  const canRetry = status === "error" || status === "closed" || status === "reconnecting";
  const busy = status === "connecting" || status === "reconnecting";
  const statusLabel = STATUS_LABELS[status];

  return (
    <div className="connection-controls" role="group" aria-label="Session connection controls">
      <span className={`agent-status${isLive ? " live" : ""}`} role="status" aria-live="polite">
        <i aria-hidden="true" />
        {statusLabel}
      </span>

      {readOnly && <span aria-label="Read-only access">Read-only</span>}

      {error && (
        <span role="alert">
          The session connection failed. No connection details are shown for security.
        </span>
      )}

      {canRetry && (
        <button
          type="button"
          onClick={onReconnect}
          aria-label="Retry session connection"
          disabled={busy}
        >
          Retry
        </button>
      )}

      {isLive && (
        <button
          type="button"
          onClick={onDisconnect}
          aria-label="Disconnect session"
        >
          Disconnect
        </button>
      )}
    </div>
  );
}
