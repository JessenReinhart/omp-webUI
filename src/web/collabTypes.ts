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

