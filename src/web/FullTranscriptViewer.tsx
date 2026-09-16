import type { SessionEntry, WireMessage } from "./collabTypes";

const MAX_DISPLAYED_ENTRIES = 1000;

const COLLAB_PROMPT_MESSAGE_TYPE = "collab-prompt";

function isWireMessage(value: unknown): value is WireMessage {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  const role = obj.role;
  if (role === "assistant") return Array.isArray(obj.content);
  if (role === "user" || role === "developer")
    return typeof obj.content === "string" || Array.isArray(obj.content);
  return role === "toolResult" && Array.isArray(obj.content);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (part === null || typeof part !== "object") continue;
    const obj = part as Record<string, unknown>;
    if (obj.type === "image") parts.push("[image]");
    else if (typeof obj.text === "string" && obj.text.trim()) parts.push(obj.text);
  }
  return parts.join("\n");
}

function extractTimestamp(message: WireMessage): number | null {
  const ts = (message as Record<string, unknown>).timestamp;
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : ts;
}

function formatTimestamp(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function safeStringify(value: unknown): string {
  try {
    const seen = new Set<object>();
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        return val;
      },
      2
    );
  } catch {
    try {
      return String(value);
    } catch {
      return "[Cannot render value]";
    }
  }
}

function ToolBlock({ block }: { block: Record<string, unknown> }) {
  const name =
    typeof block.name === "string" && block.name.trim() ? block.name : "tool";
  const intent =
    typeof block.intent === "string" && block.intent.trim()
      ? block.intent
      : null;
  const argsJson = safeStringify(block.arguments ?? block.input ?? null);

  return (
    <details className="transcript-tool-card">
      <summary className="transcript-tool-summary">
        <span className="transcript-tool-name">Calling {name}</span>
        {intent ? <span className="transcript-tool-intent">{intent}</span> : null}
      </summary>
      <pre className="transcript-pre">{argsJson}</pre>
    </details>
  );
}

function MessageContent({ message }: { message: WireMessage }) {
  if (message.role === "assistant") {
    const blocks = Array.isArray(message.content) ? message.content : [];
    return (
      <>
        {blocks.map((block, index) => {
          if (block === null || typeof block !== "object")
            return (
              <p key={index} className="collab-muted">
                Unsupported assistant content
              </p>
            );
          const b = block as Record<string, unknown>;
          switch (b.type) {
            case "text": {
              return typeof b.text === "string" && b.text.trim() ? (
                <p key={index}>{b.text}</p>
              ) : null;
            }
            case "thinking": {
              return typeof b.thinking === "string" && b.thinking.trim() ? (
                <details key={index} className="collab-thinking">
                  <summary>Thinking</summary>
                  <p>{b.thinking}</p>
                </details>
              ) : null;
            }
            case "redactedThinking":
              return (
                <p key={index} className="collab-muted">
                  Thinking redacted
                </p>
              );
            case "toolCall":
              return <ToolBlock key={index} block={b} />;
            default:
              return (
                <p key={index} className="collab-muted">
                  Unsupported assistant content
                </p>
              );
          }
        })}
        {typeof message.errorMessage === "string" && message.errorMessage.trim() ? (
          <p className="collab-error">{message.errorMessage}</p>
        ) : null}
      </>
    );
  }

  if (message.role === "toolResult") {
    const text = contentText(message.content);
    const toolLabel =
      typeof message.toolName === "string" && message.toolName.trim()
        ? message.toolName
        : "Tool";
    const isError = message.isError === true;
    return (
      <div className={`transcript-tool-result${isError ? " transcript-tool-error" : ""}`}>
        <details>
          <summary className="transcript-tool-summary">
            <span className="transcript-tool-name">{toolLabel} result</span>
            {isError ? <span className="transcript-error-badge">Error</span> : null}
          </summary>
          <pre className="transcript-pre">{safeStringify(message.content)}</pre>
        </details>
        {text ? <p className="collab-muted">{text}</p> : null}
      </div>
    );
  }

  const text = contentText(message.content);
  return <p>{text || "(empty message)"}</p>;
}

function Message({ message }: { message: WireMessage }) {
  const label = message.role === "toolResult" ? "tool" : message.role;
  const ts = extractTimestamp(message);
  return (
    <article className={`collab-message collab-message-${label}`}>
      <header className="transcript-message-header">
        <span className="transcript-role">{label}</span>
        {ts !== null ? (
          <time className="transcript-timestamp" dateTime={new Date(ts).toISOString()}>
            {formatTimestamp(ts)}
          </time>
        ) : null}
      </header>
      <MessageContent message={message} />
    </article>
  );
}

function Entry({ entry }: { entry: SessionEntry }) {
  if (entry === null || typeof entry !== "object" || typeof entry.type !== "string") {
    return <p className="collab-system-event">Unsupported transcript entry</p>;
  }
  switch (entry.type) {
    case "message": {
      if (!isWireMessage(entry.message))
        return <p className="collab-system-event">Unsupported transcript entry</p>;
      return <Message message={entry.message} />;
    }
    case "custom_message": {
      if (!entry.display) return null;
      const text = contentText(entry.content);
      const customType =
        typeof entry.customType === "string" && entry.customType.trim()
          ? entry.customType
          : "Custom message";
      let label = customType;
      if (customType === COLLAB_PROMPT_MESSAGE_TYPE) {
        const details =
          entry.details !== null && typeof entry.details === "object"
            ? (entry.details as Record<string, unknown>)
            : null;
        const from =
          details && typeof details.from === "string" && details.from.trim()
            ? details.from
            : null;
        label = from ? `Prompt from ${from}` : "Guest prompt";
      }
      return (
        <article className="collab-message collab-message-custom">
          <header>{label}</header>
          <p>{text || "(empty message)"}</p>
        </article>
      );
    }
    case "compaction": {
      const summary =
        (typeof entry.shortSummary === "string" && entry.shortSummary.trim()
          ? entry.shortSummary
          : null) ??
        (typeof entry.summary === "string" && entry.summary.trim()
          ? entry.summary
          : null);
      return (
        <p className="collab-system-event">
          Context compacted{summary ? `: ${summary}` : ""}
        </p>
      );
    }
    case "branch_summary": {
      const summary =
        typeof entry.summary === "string" && entry.summary.trim()
          ? entry.summary
          : null;
      return (
        <p className="collab-system-event">
          Branch summary{summary ? `: ${summary}` : ""}
        </p>
      );
    }
    case "model_change": {
      const model =
        typeof entry.model === "string" && entry.model.trim()
          ? entry.model
          : "unknown model";
      return <p className="collab-system-event">Model changed to {model}</p>;
    }
    case "thinking_level_change": {
      const level =
        typeof entry.thinkingLevel === "string" && entry.thinkingLevel.trim()
          ? entry.thinkingLevel
          : "default";
      return <p className="collab-system-event">Thinking level: {level}</p>;
    }
    case "model_usage": {
      const purpose = String((entry as Record<string, unknown>).purpose ?? "usage");
      const model = String((entry as Record<string, unknown>).model ?? "unknown model");
      return (
        <p className="collab-system-event">
          Model usage: {purpose} → {model}
        </p>
      );
    }
    case "service_tier_change": {
      const tier = (entry as Record<string, unknown>).serviceTier;
      return (
        <p className="collab-system-event">
          Service tier changed
          {tier != null ? ` to ${String(tier)}` : ""}
        </p>
      );
    }
    case "label":
    case "title_change":
    case "session_init":
    case "mode_change":
    case "credential_pin":
    case "reset_boundary":
    case "ttsr_injection": {
      const name = entry.type.replace(/_/g, " ");
      return <p className="collab-system-event">{name}</p>;
    }
    default:
      return <p className="collab-system-event">Unsupported transcript entry</p>;
  }
}

export interface FullTranscriptViewerProps {
  entries: SessionEntry[];
  title?: string;
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
        displayedEntries.map((entry, index) => {
          const key =
            entry !== null && typeof entry === "object"
              ? (typeof entry.id === "string" && entry.id.trim() ? entry.id : null) ??
                `entry-${index}`
              : `entry-${index}`;
          return <Entry key={key} entry={entry} />;
        })
      )}
    </div>
  );
}
