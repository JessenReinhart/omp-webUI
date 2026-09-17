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
        <span className="transcript-tool-name">Calling {name}</span>
        {intent ? <span className="transcript-tool-intent">{intent}</span> : null}
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
          if (!isRecord(block)) return <p key={index} className="collab-muted">Unsupported assistant content</p>;
          switch (block.type) {
            case "text": {
              const text = asText(block.text);
              return text ? <p key={index} style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{text}</p> : null;
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
              return <p key={index} className="collab-muted">Thinking redacted</p>;
            case "toolCall":
              return <ToolBlock key={index} block={block} />;
            default:
              return <p key={index} className="collab-muted">Unsupported assistant content</p>;
          }
        })}
        {asText(message.errorMessage) ? <p className="collab-error">{asText(message.errorMessage)}</p> : null}
      </>
    );
  }

  if (message.role === "toolResult") {
    const text = contentText(message.content);
    const toolLabel = asText(message.toolName) ?? "Tool";
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

export function TranscriptEntry({ entry }: { entry: SessionEntry }) {
  if (!isRecord(entry) || typeof entry.type !== "string") {
    return <p className="collab-system-event">Unsupported transcript entry</p>;
  }
  switch (entry.type) {
    case "message": {
      if (!isWireMessage(entry.message)) return <p className="collab-system-event">Unsupported transcript entry</p>;
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
      return <p className="collab-system-event">Context compacted{summary ? `: ${summary}` : ""}</p>;
    }
    case "branch_summary": {
      const summary = asText(entry.summary);
      return <p className="collab-system-event">Branch summary{summary ? `: ${summary}` : ""}</p>;
    }
    case "model_change":
      return <p className="collab-system-event">Model changed to {asText(entry.model) ?? "unknown model"}</p>;
    case "thinking_level_change":
      return <p className="collab-system-event">Thinking level: {asText(entry.thinkingLevel) ?? "default"}</p>;
    case "model_usage": {
      const purpose = asText((entry as Record<string, unknown>).purpose) ?? "usage";
      const model = asText((entry as Record<string, unknown>).model) ?? "unknown model";
      return <p className="collab-system-event">Model usage: {purpose} → {model}</p>;
    }
    case "service_tier_change": {
      const tier = (entry as Record<string, unknown>).serviceTier;
      return <p className="collab-system-event">Service tier changed{tier != null ? ` to ${String(tier)}` : ""}</p>;
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
