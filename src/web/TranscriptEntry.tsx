import {
  Check,
  CheckCircle2,
  ChevronDown,
  Code,
  Copy,
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
import { createContext, useContext, useState } from "react";
import type { LucideIcon } from "lucide-react";

import type { SessionEntry, WireMessage } from "./collabTypes";
import CallChip from "./CallChip";
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

export type ToolResultLookup = Map<string, WireMessage>;
export const ToolResultsContext = createContext<ToolResultLookup>(new Map());

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

function toolChipIcon(name: string): "terminal" | "file" | "search" | "edit" {
  const n = name.toLowerCase();
  if (n.includes("bash") || n.includes("terminal") || n.includes("cmd") || n.includes("eval") || n.includes("sh")) return "terminal";
  if (n.includes("search") || n.includes("grep") || n.includes("find") || n.includes("glob")) return "search";
  if (n.includes("edit") || n.includes("write") || n.includes("patch") || n.includes("replace")) return "edit";
  return "file";
}

function summarizeToolInput(input: unknown): string {
  if (!input) return "";
  if (typeof input === "string") return input;
  if (typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;
    const direct = obj.command ?? obj.cmd ?? obj.file_path ?? obj.path ?? obj.pattern ?? obj.query ?? obj.prompt;
    if (typeof direct === "string") return direct;
    try {
      const s = JSON.stringify(input);
      return s.length > 50 ? s.slice(0, 47) + "…" : s;
    } catch {
      return "";
    }
  }
  return String(input);
}

function ToolDrawer({
  argsJson,
  resultJson,
  isOpen,
}: {
  argsJson: string | null;
  resultJson: string | null;
  isOpen: boolean;
}) {
  const hasInput = Boolean(argsJson && argsJson !== "null" && argsJson !== "{}");
  const hasResult = Boolean(resultJson);
  const [activeTab, setActiveTab] = useState<"input" | "result">(() => (hasResult ? "result" : "input"));
  const [copied, setCopied] = useState(false);

  if (!isOpen || (!hasInput && !hasResult)) return null;

  const currentContent = activeTab === "result" && hasResult ? resultJson : argsJson;

  const handleCopy = () => {
    if (!currentContent) return;
    void navigator.clipboard.writeText(currentContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="tool-drawer">
      <div className="tool-drawer-bar">
        <div className="tool-drawer-tabs">
          {hasInput ? (
            <button
              type="button"
              className={`tool-drawer-tab${activeTab === "input" ? " is-active" : ""}`}
              onClick={() => setActiveTab("input")}
            >
              Input
            </button>
          ) : null}
          {hasResult ? (
            <button
              type="button"
              className={`tool-drawer-tab${activeTab === "result" ? " is-active" : ""}`}
              onClick={() => setActiveTab("result")}
            >
              Result
            </button>
          ) : null}
        </div>
        {currentContent ? (
          <button
            type="button"
            className="tool-drawer-copy-btn"
            title="Copy payload"
            aria-label="Copy payload"
            onClick={handleCopy}
          >
            {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        ) : null}
      </div>
      <div className="tool-drawer-body">
        <pre className="transcript-pre">{currentContent}</pre>
      </div>
    </div>
  );
}

function ToolBlock({ block }: { block: Record<string, unknown> }) {
  const results = useContext(ToolResultsContext);
  const [open, setOpen] = useState(false);
  const name = asText(block.name) ?? "tool";
  const intent = asText(block.intent);
  const toolCallId = asText(block.toolCallId) ?? asText(block.id);
  const matchedResult = toolCallId ? results.get(toolCallId) : undefined;

  const argsJson = safeStringify(block.arguments ?? block.input ?? null);
  const resultJson = matchedResult ? safeStringify(matchedResult.content) : null;
  const argSummary = intent || summarizeToolInput(block.arguments ?? block.input);

  const status: "running" | "done" | "error" = matchedResult
    ? matchedResult.isError === true
      ? "error"
      : "done"
    : "running";

  const hasDrawer = Boolean((argsJson && argsJson !== "null" && argsJson !== "{}") || resultJson);

  return (
    <div className="transcript-tool-block">
      <CallChip
        name={name}
        argument={argSummary}
        icon={toolChipIcon(name)}
        status={status}
        surfaceColor="var(--panel-2)"
        color="inherit"
        progressColor="var(--purple)"
        doneColor="var(--green)"
        errorColor="var(--danger)"
        showTimer={false}
        showChevron={hasDrawer}
        isOpen={open}
        onClick={hasDrawer ? () => setOpen((prev) => !prev) : undefined}
        className={hasDrawer ? "is-expandable" : undefined}
      />
      <ToolDrawer argsJson={argsJson} resultJson={resultJson} isOpen={open} />
    </div>
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
            case "thinking":
              return null;
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
    // Lone toolResult that wasn't correlated with an assistant toolCall
    const [open, setOpen] = useState(false);
    const toolLabel = asText(message.toolName) ?? "Tool";
    const isError = message.isError === true;
    const resultJson = safeStringify(message.content);

    return (
      <div className="transcript-tool-block">
        <CallChip
          name={toolLabel}
          argument={isError ? "failed" : "completed"}
          icon={toolChipIcon(toolLabel)}
          status={isError ? "error" : "done"}
          surfaceColor="var(--panel-2)"
          color="inherit"
          doneColor="var(--green)"
          errorColor="var(--danger)"
          showTimer={false}
          showChevron={true}
          isOpen={open}
          onClick={() => setOpen((prev) => !prev)}
          className="is-expandable"
        />
        <ToolDrawer argsJson={null} resultJson={resultJson} isOpen={open} />
      </div>
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
