import type {
  SessionEntry,
  AgentEvent,
  SessionState,
  AgentSnapshot,
  SessionHeader,
} from "@oh-my-pi/pi-wire";

export type CollabStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "closed"
  | "error";

export interface CollabSession {
  status: CollabStatus;
  /** True once the host has welcomed us and the snapshot is (at least partially) loaded. */
  ready: boolean;
  /** Snapshot header received in welcome. */
  header: SessionHeader | null;
  /** Full session transcript entries, in order. */
  entries: SessionEntry[];
  /** Live agent events (thinking, tool use, messages deltas, etc.). Kept bounded. */
  events: AgentEvent[];
  /** Latest host-reported session state. */
  state: SessionState | null;
  /** Latest agent snapshot. */
  agents: AgentSnapshot[];
  /** Whether the connection is read-only (no write token). */
  readOnly: boolean;
  /** Human-readable error, if any. Never contains secrets. */
  error: string | null;
}

export interface UseCollabSessionReturn extends CollabSession {
  /** Send a user prompt to the live session. */
  sendPrompt(text: string): Promise<void>;
  /** Abort the current generation/turn. */
  sendAbort(): Promise<void>;
  /** Manually reconnect after a close/error. */
  reconnect(): void;
  /** Close the connection and stop reconnection attempts. */
  disconnect(): void;
}

export interface CollabTranscriptProps {
  entries: SessionEntry[];
  events: AgentEvent[];
  status: CollabStatus;
  /** Ref forwarded to the scrollable transcript container. */
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
