import type { SessionEntry } from "./collabTypes";
import { TranscriptEntry } from "./TranscriptEntry";

const MAX_DISPLAYED_ENTRIES = 1000;

export interface FullTranscriptViewerProps {
  entries: SessionEntry[];
  title?: string;
}

function entryKey(entry: SessionEntry, index: number): string {
  if (entry !== null && typeof entry === "object") {
    const id = typeof entry.id === "string" && entry.id.trim() ? entry.id : null;
    if (id) return id;
  }
  return `entry-${index}`;
}

export function FullTranscriptViewer({ entries, title }: FullTranscriptViewerProps) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const isOverCap = safeEntries.length > MAX_DISPLAYED_ENTRIES;
  const displayedEntries = isOverCap
    ? safeEntries.slice(safeEntries.length - MAX_DISPLAYED_ENTRIES)
    : safeEntries;

  return (
    <div className="collab-transcript full-transcript-viewer" role="log" aria-label="Session transcript">
      {title ? (
        <header className="full-transcript-header">
          <h2>{title}</h2>
        </header>
      ) : null}
      {isOverCap ? (
        <p className="transcript-cap-notice" role="status">
          Showing the newest {MAX_DISPLAYED_ENTRIES.toLocaleString()} entries. Older entries hidden.
        </p>
      ) : null}
      {displayedEntries.length === 0 ? (
        <div className="transcript-empty">
          <strong>No transcript entries.</strong>
          <p>This session does not contain any recorded messages yet.</p>
        </div>
      ) : (
        displayedEntries.map((entry, index) => (
          <TranscriptEntry key={entryKey(entry, index)} entry={entry} />
        ))
      )}
    </div>
  );
}
