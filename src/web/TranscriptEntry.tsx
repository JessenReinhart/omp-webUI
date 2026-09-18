import type { SessionEntry, WireMessage } from "./collabTypes";
import {
  asText,
  contentText,
  extractTimestamp,
  formatTimestamp,
  isRecord,
  isWireMessage,
  safeStringify,
} from "./transcript-model";

function ToolBlock({ block }: { block: Record<string, unknown> }) {
  const name = asText(block.name) ?? "tool";
  const intent = asText(block.intent);
  const argsJson = safeStringify(block.arguments ?? block.input ?? null);

  return (
    <details className="transcript-tool-card">
      <summary className="transcript-tool-summary">
        <span className="transcript-tool-name">{name}</span>
        {intent ? <span className="transcript-tool-intent">{intent}</span> : null}
        <span className="transcript-tool-kind">tool call</span>
      </summary>
      <pre className="transcript-pre">{argsJson}</pre>
    </details>
  );
}

function MessageContent({ message }: { message: WireMessage }) {
  if (message.role === "assistant") {
    const blocks = Array.isArray(message.content) ? (message.content as unknown[]) : [];
    return (
      <>
        {blocks.map((block, index) => {
          if (!isRecord(block)) return null;
          switch (block.type) {
            case "text": {
              const text = asText(block.text);
              return text ? (
                <p key={index} style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
                  {text}
                </p>
              ) : null;
            }
            case "thinking": {
              const text = asText(block.thinking);
              return text ? (
                <details key={index} className="collab-thinking">
                  <summary>Thinking</summary>
                  <p>{text}</p>
                </details>
              ) : null;
            }
            case "redactedThinking":
              return null;
            case "toolCall":
              return <ToolBlock key={index} block={block} />;
            default:
              return null;
          }
        })}
        {asText(message.errorMessage) ? <p className="collab-error">{asText(message.errorMessage)}</p> : null}
      </>
    );
  }

  if (message.role === "toolResult") {
    const text = contentText(message.content);
    const preview = text.length > 260 ? `${text.slice(0, 260).trimEnd()}…` : text;
    const toolLabel = asText(message.toolName) ?? "Tool";
    const isError = message.isError === true;
    return (
      <div className={`transcript-tool-result${isError ? " transcript-tool-error" : ""}`}>
        <details>
          <summary className="transcript-tool-summary">
            <span className="transcript-tool-name">{toolLabel}</span>
            <span className="transcript-tool-intent">{isError ? "failed" : "completed"}</span>
            {isError ? <span className="transcript-error-badge">Error</span> : null}
          </summary>
          <pre className="transcript-pre">{safeStringify(message.content)}</pre>
        </details>
        {preview ? <p className="collab-muted tool-result-preview">{preview}</p> : null}
      </div>
    );
  }

  const text = contentText(message.content);
  return <p>{text || "(empty message)"}</p>;
}

export function Message({ message, live = false }: { message: WireMessage; live?: boolean }) {
  const label = message.role === "toolResult" ? "tool" : message.role;
  const ts = extractTimestamp(message);
  return (
    <article className={`collab-message collab-message-${label}${live ? " is-live" : ""}`}>
      <header className="transcript-message-header">
        <span className="transcript-role">{live ? `${label} · streaming` : label}</span>
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

function SystemDetail({ label, summary }: { label: string; summary?: string | null }) {
  if (!summary) return <p className="collab-system-event">{label}</p>;

  return (
    <details className="collab-system-detail">
      <summary>{label}</summary>
      <p>{summary}</p>
    </details>
  );
}

export function TranscriptEntry({ entry }: { entry: SessionEntry }) {
  if (!isRecord(entry) || typeof entry.type !== "string") return null;

  switch (entry.type) {
    case "message": {
      if (!isWireMessage(entry.message)) return null;
      return <Message message={entry.message} />;
    }
    case "custom_message": {
      if (!entry.display) return null;
      const text = contentText(entry.content);
      const customType = asText(entry.customType) ?? "Custom message";
      let label = customType;
      if (customType === "collab-prompt") {
        const details = isRecord(entry.details) ? entry.details : null;
        const from = details ? asText(details.from) : null;
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
      const summary = asText(entry.shortSummary) ?? asText(entry.summary);
      return <SystemDetail label="Context compacted" summary={summary} />;
    }
    case "branch_summary": {
      const summary = asText(entry.summary);
      return <SystemDetail label="Branch summary" summary={summary} />;
    }
    case "model_change":
      return <p className="collab-system-event">Model · {asText(entry.model) ?? "unknown"}</p>;
    case "thinking_level_change":
      return <p className="collab-system-event">Thinking · {asText(entry.thinkingLevel) ?? "default"}</p>;
    case "service_tier_change": {
      const tier = (entry as Record<string, unknown>).serviceTier;
      return tier != null ? <p className="collab-system-event">Service tier · {String(tier)}</p> : null;
    }
    case "model_usage":
    case "label":
    case "title_change":
    case "session_init":
    case "mode_change":
    case "credential_pin":
    case "reset_boundary":
    case "ttsr_injection":
      return null;
    default:
      // OMP adds internal session entry types over time. Unknown metadata should
      // not leak into the workspace as an "unsupported" error-shaped message.
      return null;
  }
}
