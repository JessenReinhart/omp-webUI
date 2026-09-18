export interface TextContent {
  type: "text";
  text: string;
}

export interface WireMessage {
  role: "user" | "developer" | "assistant" | "toolResult";
  content: string | TextContent[] | unknown[];
  timestamp: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  [key: string]: unknown;
}

export interface SessionEntry {
  id: string;
  type: string;
  message?: WireMessage;
  [key: string]: unknown;
}

export type AgentEvent =
  | { type: "agent_start" | "agent_end" | "turn_start" | "turn_end" }
  | { type: "message_start" | "message_update" | "message_end"; message: WireMessage }
  | { type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end"; toolCallId: string; toolName: string; args?: unknown; partialResult?: unknown; result?: unknown; isError?: boolean; intent?: string }
  | { type: "notice"; level?: string; message?: string };

export interface SessionState {
  isStreaming?: boolean;
  queuedMessageCount?: number;
  [key: string]: unknown;
}

export interface AgentSnapshot {
  id: string;
  displayName: string;
  kind: "main" | "sub";
  status: string;
  lastActivity?: number;
  hasSessionFile?: boolean;
}

export interface SessionHeader {
  type?: string;
  id?: string;
  title?: string;
  [key: string]: unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function contentText(content: unknown): string {
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
export function messageIdentity(message: unknown): string {
  if (!isRecord(message)) return "invalid";
  const role = asText(message.role) ?? "unknown";
  const timestamp = typeof message.timestamp === "number" ? message.timestamp : "";
  const toolCallId = asText(message.toolCallId) ?? "";
  return `${role}:${timestamp}:${toolCallId}:${contentText(message.content)}`;
}

/**
 * Stable commit key for matching a streamed message against the committed
 * transcript. Content is deliberately excluded: partial `message_update` frames
 * carry truncated text that can never equal the committed final content, so an
 * exact-identity match would leave stale previews behind.
 */
export function messageCommitKey(message: unknown): string | null {
  if (!isRecord(message)) return null;
  const role = asText(message.role) ?? "unknown";
  const timestamp = message.timestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const toolCallId = asText(message.toolCallId) ?? "";
  return `${role}:${timestamp}:${toolCallId}`;
}

/** Commit keys of messages already present in a snapshot branch. */
export function committedMessageKeys(entries: SessionEntry[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
    const key = messageCommitKey(entry.message);
    if (key) keys.add(key);
  }
  return keys;
}

export type MessageAgentEvent = Extract<AgentEvent, { message: WireMessage }>;
export type ToolAgentEvent = Extract<AgentEvent, { toolCallId: string }>;

export function isMessageAgentEvent(event: AgentEvent): event is MessageAgentEvent {
  return event.type === "message_start" || event.type === "message_update" || event.type === "message_end";
}

export function isToolAgentEvent(event: AgentEvent): event is ToolAgentEvent {
  return event.type === "tool_execution_start" || event.type === "tool_execution_update" || event.type === "tool_execution_end";
}

/** Identities of messages already committed in a snapshot branch. */
export function committedMessageIdentities(entries: SessionEntry[]): Set<string> {
  const identities = new Set<string>();
  for (const entry of entries) {
    if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
    identities.add(messageIdentity(entry.message));
  }
  return identities;
}

/** toolCallIds that already have a committed toolResult message in a snapshot branch. */
export function committedToolCallIds(entries: SessionEntry[]): Set<string> {
  const settled = new Set<string>();
  for (const entry of entries) {
    if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
    if (entry.message.role !== "toolResult") continue;
    const toolCallId = asText(entry.message.toolCallId);
    if (toolCallId) settled.add(toolCallId);
  }
  return settled;
}

export type CollabStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "closed"
  | "error";

export interface CollabSession {
  status: CollabStatus;
  ready: boolean;
  header: SessionHeader | null;
  entries: SessionEntry[];
  events: AgentEvent[];
  state: SessionState | null;
  agents: AgentSnapshot[];
  readOnly: boolean;
  error: string | null;
}

export interface UseCollabSessionReturn extends CollabSession {
  sendPrompt(text: string): Promise<void>;
  sendAbort(): Promise<void>;
  reconnect(): void;
  disconnect(): void;
}

export interface CollabTranscriptProps {
  entries: SessionEntry[];
  events: AgentEvent[];
  status: CollabStatus;
  welcomeTitle?: string;
  isStreaming?: boolean;
  queuedMessages?: number;
  scrollRef?: React.Ref<HTMLDivElement>;
}

export interface CollabComposerProps {
  disabled?: boolean;
  placeholder?: string;
  isStreaming?: boolean;
  onSend(text: string): void | Promise<void>;
  onAbort?(): void | Promise<void>;
}

export interface CollabControlsProps {
  status: CollabStatus;
  readOnly: boolean;
  error: string | null;
  onReconnect(): void;
  onDisconnect(): void;
}
