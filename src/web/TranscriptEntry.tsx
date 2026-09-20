import {
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Code,
  FilePlus2,
  FileSearch,
  FileText,
  Globe,
  ListChecks,
  MessagesSquare,
  PencilLine,
  Search,
  Sparkles,
  SquareTerminal,
  UserCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
import { MarkdownMessage } from "./MarkdownMessage";

export type ActionState = "running" | "complete" | "error" | "info";

const TOOL_ICONS: Record<string, LucideIcon> = {
  bash: SquareTerminal,
  edit: PencilLine,
  eval: Code,
  glob: FileSearch,
  grep: Search,
  hub: MessagesSquare,
  learn: Sparkles,
  manage_skill: Sparkles,
  read: FileText,
  task: UserCheck,
  todo: ListChecks,
  web_search: Globe,
  write: FilePlus2,
};

export function toolIcon(name: string): LucideIcon {
  return TOOL_ICONS[name.toLowerCase()] ?? Wrench;
}

interface ActionRowProps {
  className?: string;
  icon: LucideIcon;
  label: string;
  state: ActionState;
  stateLabel: string;
  children?: React.ReactNode;
}

/**
 * Collapsed disclosure for agent-internal activity: icon plus action only.
 * Payloads stay inside the details body so nothing leaks before expansion.
 * Rows without a payload render as a static (non-clickable) line.
 */
export function ActionRow({ className = "", icon: Icon, label, state, stateLabel, children }: ActionRowProps) {
  const head = (
    <>
      <span className={`transcript-action-icon is-${state}`} aria-hidden="true">
        <Icon size={15} strokeWidth={2.1} />
      </span>
      <span className="transcript-action-label">{label}</span>
      <span className="transcript-action-state">{stateLabel}</span>
    </>
  );

  const rowClass = `transcript-action-row is-${state} ${className}`.trim();

  if (!children) {
    return (
      <div className={`${rowClass} is-static`}>
        <span className="transcript-action-summary">{head}</span>
      </div>
    );
  }

  return (
    <details className={rowClass}>
      <summary className="transcript-action-summary">
        {head}
        <ChevronDown className="transcript-action-chevron" size={14} aria-hidden="true" />
      </summary>
      <div className="transcript-action-detail">{children}</div>
    </details>
  );
}

function ToolBlock({ block }: { block: Record<string, unknown> }) {
  const name = asText(block.name) ?? "tool";
  const intent = asText(block.intent);
  const argsJson = safeStringify(block.arguments ?? block.input ?? null);
  const Icon = toolIcon(name);
  const label = intent ? `Calling ${name}: ${intent}` : `Calling ${name}`;

  return (
    <ActionRow icon={Icon} label={label} state="info" stateLabel="Tool call">
      <pre className="transcript-pre">{argsJson}</pre>
    </ActionRow>
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
              return text ? <MarkdownMessage key={index} text={text} /> : null;
            }
            case "thinking": {
              const text = asText(block.thinking);
              return text ? (
                <ActionRow
                  key={index}
                  stateLabel="Reasoning"
                  icon={BrainCircuit}
                  label="Thinking"
                  state="info"
                >
                  <p className="transcript-thinking-text">{text}</p>
                </ActionRow>
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
    const toolLabel = asText(message.toolName) ?? "Tool";
    const isError = message.isError === true;
    return (
      <ActionRow
        stateLabel={isError ? "Failed" : "Completed"}
        icon={isError ? XCircle : CheckCircle2}
        label={`${toolLabel} ${isError ? "failed" : "completed"}`}
        state={isError ? "error" : "complete"}
      >
        <pre className="transcript-pre">{safeStringify(message.content)}</pre>
      </ActionRow>
    );
  }

  const blocks: Record<string, unknown>[] = Array.isArray(message.content)
    ? message.content.flatMap((block) => isRecord(block) ? [block] : [])
    : [];
  const images = blocks.flatMap((block) => {
    if (block.type !== "image" || typeof block.data !== "string" || typeof block.mimeType !== "string") return [];
    if (!/^image\/(png|jpeg|gif|webp)$/.test(block.mimeType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(block.data)) return [];
    return [{ src: `data:${block.mimeType};base64,${block.data}` }];
  });
  const text = typeof message.content === "string"
    ? message.content
    : blocks.flatMap((block) => block.type === "text" && typeof block.text === "string" ? [block.text] : []).join("\n");
  return (
    <>
      {text ? <p>{text}</p> : null}
      {images.length > 0 ? (
        <div className="transcript-image-grid">
          {images.map((image, index) => <img key={index} src={image.src} alt={`Pasted attachment ${index + 1}`} />)}
        </div>
      ) : null}
      {!text && images.length === 0 ? <p>{contentText(message.content) || "(empty message)"}</p> : null}
    </>
  );
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
      const rawCustomType = asText(entry.customType);
      // Advisor notes surface in the dedicated Advisor panel (derived from
      // details.notes); their raw model-facing <advisory ...> content must not
      // also leak into the main transcript.
      if (rawCustomType && rawCustomType.toLowerCase().includes("advisor")) return null;
      const text = contentText(entry.content);
      const customType = rawCustomType ?? "Custom message";
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
