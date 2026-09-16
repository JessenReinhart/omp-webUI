import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AgentEvent, SessionEntry, WireMessage } from "./collabTypes";
const COLLAB_PROMPT_MESSAGE_TYPE = "collab-prompt";
import type { CollabTranscriptProps } from "./collabTypes";

type UnknownRecord = Record<string, unknown>;

type ToolActivity = {
  id: string;
  name: string;
  status: "running" | "complete" | "error";
  detail?: string;
};

type NoticeView = { level: string; message: string };

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object";
}
function isWireMessage(value: unknown): value is WireMessage {
  if (!isRecord(value)) return false;
  const role = value.role;
  if (role === "assistant") return Array.isArray(value.content);
  if (role === "user" || role === "developer") return typeof value.content === "string" || Array.isArray(value.content);
  return role === "toolResult" && Array.isArray(value.content);
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "image") parts.push("[image]");
    else {
      const text = asText(part.text);
      if (text) parts.push(text);
    }
  }
  return parts.join("\n");
}

/** Identity of a wire message: role + timestamp + toolCallId + content fingerprint. */
function messageIdentity(message: unknown): string {
  if (!isRecord(message)) return "invalid";
  const role = asText(message.role) ?? "unknown";
  const timestamp = typeof message.timestamp === "number" ? message.timestamp : "";
  const toolCallId = asText(message.toolCallId) ?? "";
  return `${role}:${timestamp}:${toolCallId}:${contentText(message.content)}`;
}

function safeSummary(value: unknown): string | undefined {
  const text = asText(value);
  if (text) return text.length > 160 ? `${text.slice(0, 157)}…` : text;
  if (Array.isArray(value)) return value.length ? `${value.length} result${value.length === 1 ? "" : "s"}` : undefined;
  if (isRecord(value)) return "details available";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function MessageContent({ message }: { message: WireMessage }) {
  if (message.role === "assistant") {
    const blocks = Array.isArray(message.content) ? message.content : [];
    return (
      <>
        {blocks.map((block, index) => {
          if (!isRecord(block)) return <p key={index} className="collab-muted">Unsupported assistant content</p>;
          switch (block.type) {
            case "text": {
              const text = asText(block.text);
              return text ? <p key={index}>{text}</p> : null;
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
            case "toolCall": {
              const name = asText(block.name) ?? "tool";
              const intent = asText(block.intent);
              return <p key={index} className="collab-tool-call">Calling {name}{intent ? `: ${intent}` : ""}</p>;
            }
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
    return <p className={message.isError ? "collab-error" : undefined}>{text || `${asText(message.toolName) ?? "Tool"} completed`}</p>;
  }

  const text = contentText(message.content);
  return <p>{text || "(empty message)"}</p>;
}

function Message({ message, live = false }: { message: WireMessage; live?: boolean }) {
  const label = message.role === "toolResult" ? "tool" : message.role;
  return (
    <article className={`collab-message collab-message-${label}${live ? " is-live" : ""}`}>
      <header>{live ? `${label} · streaming` : label}</header>
      <MessageContent message={message} />
    </article>
  );
}

function Entry({ entry }: { entry: SessionEntry }) {
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
      if (customType === COLLAB_PROMPT_MESSAGE_TYPE) {
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
    default:
      return <p className="collab-system-event">Unsupported transcript entry</p>;
  }
}

function committedIdentities(entries: SessionEntry[]): Set<string> {
  const identities = new Set<string>();
  for (const entry of entries) {
    if (isRecord(entry) && entry.type === "message" && isRecord(entry.message)) {
      identities.add(messageIdentity(entry.message));
    }
  }
  return identities;
}

function liveMessage(events: AgentEvent[], entries: SessionEntry[]): WireMessage | null {
  const committed = committedIdentities(entries);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!isRecord(event) || typeof event.type !== "string") continue;
    if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
      const message = event.message;
      if (!isWireMessage(message)) return null;
      return committed.has(messageIdentity(message)) ? null : message;
    }
  }
  return null;
}

function toolActivities(events: AgentEvent[], entries: SessionEntry[]): ToolActivity[] {
  const activities = new Map<string, ToolActivity>();
  for (const event of events) {
    if (!isRecord(event)) continue;
    if (event.type !== "tool_execution_start" && event.type !== "tool_execution_update" && event.type !== "tool_execution_end") continue;
    const toolCallId = asText(event.toolCallId);
    if (!toolCallId) continue;
    if (event.type === "tool_execution_start") {
      activities.set(toolCallId, { id: toolCallId, name: asText(event.toolName) ?? "tool", status: "running", detail: asText(event.intent) ?? undefined });
    } else if (event.type === "tool_execution_update") {
      activities.set(toolCallId, { id: toolCallId, name: asText(event.toolName) ?? activities.get(toolCallId)?.name ?? "tool", status: "running", detail: safeSummary(event.partialResult) });
    } else if (event.type === "tool_execution_end") {
      activities.set(toolCallId, { id: toolCallId, name: asText(event.toolName) ?? activities.get(toolCallId)?.name ?? "tool", status: event.isError ? "error" : "complete", detail: safeSummary(event.result) });
    }
  }
  const settled = new Set<string>();
  for (const entry of entries) {
    if (isRecord(entry) && entry.type === "message" && isRecord(entry.message) && entry.message.role === "toolResult") {
      const toolCallId = asText(entry.message.toolCallId);
      if (toolCallId) settled.add(toolCallId);
    }
  }
  return [...activities.values()].filter((activity) => !settled.has(activity.id)).slice(-4);
}

function notices(events: AgentEvent[]): NoticeView[] {
  const found: NoticeView[] = [];
  for (const event of events) {
    if (event.type !== "notice") continue;
    found.push({ level: asText(event.level) ?? "info", message: asText(event.message) ?? "Notice" });
  }
  return found.slice(-3);
}

const NEAR_BOTTOM_PX = 96;

export function CollabTranscript({ entries, events, status, scrollRef }: CollabTranscriptProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef(true);

  const safeEntries = useMemo(() => (Array.isArray(entries) ? entries : []), [entries]);
  const safeEvents = useMemo(() => (Array.isArray(events) ? events : []), [events]);
  const latestMessage = useMemo(() => liveMessage(safeEvents, safeEntries), [safeEntries, safeEvents]);
  const tools = useMemo(() => toolActivities(safeEvents, safeEntries), [safeEvents, safeEntries]);
  const latestNotices = useMemo(() => notices(safeEvents), [safeEvents]);

  useEffect(() => {
    const element = containerRef.current;
    if (element && stickyRef.current) element.scrollTop = element.scrollHeight;
  }, [safeEntries, latestMessage, tools, latestNotices]);

  const setContainer = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
    if (typeof scrollRef === "function") scrollRef(element);
    else if (scrollRef && typeof scrollRef === "object" && "current" in scrollRef) scrollRef.current = element;
  }, [scrollRef]);

  function handleScroll() {
    const element = containerRef.current;
    if (element) stickyRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
  }

  const stateMessage = status === "connecting" || status === "reconnecting"
    ? "Connecting to the OMP session…"
    : status === "error"
      ? "Connection error. Reconnect to try again."
      : status === "closed"
        ? "Connection closed."
        : status === "idle"
          ? "Waiting for an OMP session…"
          : null;
  const isEmpty = safeEntries.length === 0 && !latestMessage && tools.length === 0 && latestNotices.length === 0;

  return (
    <div ref={setContainer} onScroll={handleScroll} className="collab-transcript" role="log" aria-live="polite" aria-relevant="additions text">
      {stateMessage && !isEmpty ? <p className="collab-connection-state">{stateMessage}</p> : null}
      {isEmpty ? <p className="collab-empty-state">{stateMessage ?? "No transcript yet."}</p> : null}
      {safeEntries.map((entry, index) => (
        <Entry key={isRecord(entry) ? asText(entry.id) ?? `entry-${index}` : `entry-${index}`} entry={entry} />
      ))}
      {latestMessage ? <Message message={latestMessage} live /> : null}
      {tools.map((tool) => (
        <p key={tool.id} className={`collab-tool-activity ${tool.status}`}>{tool.name}: {tool.status}{tool.detail ? ` · ${tool.detail}` : ""}</p>
      ))}
      {latestNotices.map((notice, index) => {
        const level = notice.level;
        return <p key={`notice-${index}`} className={`collab-notice ${level}`}>{notice.message}</p>;
      })}
    </div>
  );
}
