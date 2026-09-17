import type { AgentEvent, SessionEntry, WireMessage } from "./collabTypes";

export const COLLAB_PROMPT_MESSAGE_TYPE = "collab-prompt";

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object";
}

export function asText(value: unknown): string | null {
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

export function isWireMessage(value: unknown): value is WireMessage {
  if (!isRecord(value)) return false;
  const role = value.role;
  if (role === "assistant") return Array.isArray(value.content);
  if (role === "user" || role === "developer") return typeof value.content === "string" || Array.isArray(value.content);
  return role === "toolResult" && Array.isArray(value.content);
}

/** Identity of a wire message: role + timestamp + toolCallId + content fingerprint. */
export function messageIdentity(message: unknown): string {
  if (!isRecord(message)) return "invalid";
  const role = asText(message.role) ?? "unknown";
  const timestamp = typeof message.timestamp === "number" ? message.timestamp : "";
  const toolCallId = asText(message.toolCallId) ?? "";
  return `${role}:${timestamp}:${toolCallId}:${contentText(message.content)}`;
}

export function safeSummary(value: unknown): string | undefined {
  const text = asText(value);
  if (text) return text.length > 160 ? `${text.slice(0, 157)}…` : text;
  if (Array.isArray(value)) return value.length ? `${value.length} result${value.length === 1 ? "" : "s"}` : undefined;
  if (isRecord(value)) return "details available";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

export function extractTimestamp(message: WireMessage): number | null {
  const ts = (message as UnknownRecord).timestamp;
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : ts;
}

export function formatTimestamp(ts: number): string {
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

export function safeStringify(value: unknown): string {
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

export function isSessionEntry(entry: unknown): entry is SessionEntry {
  return isRecord(entry) && typeof entry.type === "string";
}

export type ToolActivity = {
  id: string;
  name: string;
  status: "running" | "complete" | "error";
  detail?: string;
};

export type NoticeView = { level: string; message: string };

/** Identities of wire messages already committed in the transcript (for dedupe). */
export function committedIdentities(entries: SessionEntry[]): Set<string> {
  const identities = new Set<string>();
  for (const entry of entries) {
    if (isRecord(entry) && entry.type === "message" && isRecord(entry.message)) {
      identities.add(messageIdentity(entry.message));
    }
  }
  return identities;
}

/** The newest live message not already committed, if any. */
export function liveMessage(events: AgentEvent[], entries: SessionEntry[]): WireMessage | null {
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

/** Tool activities still running (no committed result), newest 4 last. */
export function toolActivities(events: AgentEvent[], entries: SessionEntry[]): ToolActivity[] {
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

/** Most recent notices (max 3 last). */
export function notices(events: AgentEvent[]): NoticeView[] {
  const found: NoticeView[] = [];
  for (const event of events) {
    if (event.type !== "notice") continue;
    found.push({ level: asText(event.level) ?? "info", message: asText(event.message) ?? "Notice" });
  }
  return found.slice(-3);
}

export const NEAR_BOTTOM_PX = 96;

/** Returns true when the system prefers reduced motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function scrollToBottom(element: HTMLElement, animate: boolean): void {
  if (animate) {
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  } else {
    element.scrollTop = element.scrollHeight;
  }
}
