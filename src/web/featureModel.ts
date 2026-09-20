import { isToolAgentEvent, type AgentEvent, type SessionEntry, type WireMessage } from "./collabTypes";
import { asText, contentText, isRecord, safeStringify } from "./transcript-model";
import type { AdvisorNote, SubagentRecord, TodoPhase, TodoTask } from "./featureTypes";

/** Tools whose runs are surfaced as "delegated work" in the subagent view. */
const SUB_TOOLS = new Set(["subagent", "subagent_fork", "task", "ralph", "workflow"]);
const ADVISOR_ENTRY_TYPES = new Set(["custom_message", "custom-message", "custom"]);

function messageOf(entry: SessionEntry): WireMessage | null {
  if (entry.type !== "message") return null;
  const message = entry.message;
  return message && isRecord(message) ? message : null;
}

function fieldOf(message: WireMessage, key: string): unknown {
  return (message as Record<string, unknown>)[key];
}

function timestampOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

/* -------------------------------------------------------------------------- */
/* To-do                                                                       */
/* -------------------------------------------------------------------------- */

/** Parse the `todo` tool's own details payload: the authoritative phase snapshot. */
function todoPhasesFromDetails(details: unknown): TodoPhase[] | null {
  if (!isRecord(details) || !Array.isArray(details.phases)) return null;
  return details.phases.filter(isRecord).map((phase): TodoPhase => ({
    name: asText(phase.name) ?? "Tasks",
    tasks: Array.isArray(phase.tasks)
      ? phase.tasks.filter(isRecord).map((task): TodoTask => ({
          content: asText(task.content) ?? asText(task.task) ?? "",
          status: (asText(task.status) ?? "pending") as TodoTask["status"],
          blocker: asText(task.blocker) ?? undefined,
        }))
      : [],
  }));
}

/** Fallback for an in-flight `todo init` call, whose result has not landed yet. */
function todoPhasesFromArgs(args: unknown): TodoPhase[] | null {
  if (!isRecord(args)) return null;
  if (Array.isArray(args.list)) {
    return args.list.filter(isRecord).map((group): TodoPhase => ({
      name: asText(group.phase) ?? "Tasks",
      tasks: Array.isArray(group.items)
        ? group.items.flatMap((item) => {
            const content = asText(item);
            return content ? [{ content, status: "pending" as const }] : [];
          })
        : [],
    }));
  }
  if (Array.isArray(args.items)) {
    return [{
      name: asText(args.phase) ?? "Tasks",
      tasks: args.items.flatMap((item) => {
        const content = asText(item);
        return content ? [{ content, status: "pending" as const }] : [];
      }),
    }];
  }
  return null;
}

/**
 * Newest todo snapshot for the session. Live events win over the committed
 * transcript because a streaming `todo` result is newer than anything already
 * persisted; both are scanned newest-first so the first hit is the answer.
 */
export function getLatestTodoPhasesFromEntries(
  entries: SessionEntry[],
  events: AgentEvent[],
): TodoPhase[] | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!isToolAgentEvent(event) || event.toolName !== "todo") continue;
    if (event.type === "tool_execution_start") continue;
    const result = event.type === "tool_execution_end" ? event.result : event.partialResult;
    const fromResult = isRecord(result) ? todoPhasesFromDetails(result.details ?? result) : null;
    if (fromResult) return fromResult;
    const fromArgs = todoPhasesFromArgs(event.args);
    if (fromArgs) return fromArgs;
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const message = messageOf(entries[index]);
    if (!message || message.role !== "toolResult") continue;
    if (asText(fieldOf(message, "toolName")) !== "todo") continue;
    const phases = todoPhasesFromDetails(fieldOf(message, "details"));
    if (phases) return phases;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Advisor                                                                     */
/* -------------------------------------------------------------------------- */

function advisorNotesFrom(details: unknown, idPrefix: string, fallbackTs: number): AdvisorNote[] {
  if (!isRecord(details)) return [];
  const raw = Array.isArray(details.notes) ? details.notes : [details];
  return raw.filter(isRecord).flatMap((note, index) => {
    const message = asText(note.note) ?? asText(note.message) ?? asText(note.advice) ?? asText(note.text);
    if (!message) return [];
    const severity = asText(note.severity) as AdvisorNote["severity"] | null;
    return [{
      id: `${idPrefix}:${index}`,
      timestamp: timestampOf(note.timestamp ?? fallbackTs),
      message,
      severity: severity ?? "info",
      toolCallId: asText(note.toolCallId) ?? undefined,
    }];
  });
}

/** Advisor notes from batched advisor custom messages, `advise` results, and live `advise` calls. */
export function deriveAdvisorNotes(entries: SessionEntry[], events: AgentEvent[]): AdvisorNote[] {
  const notes: AdvisorNote[] = [];

  entries.forEach((entry, index) => {
    if (ADVISOR_ENTRY_TYPES.has(entry.type)) {
      const customType = asText(entry.customType);
      if (customType && customType.includes("advisor")) {
        notes.push(...advisorNotesFrom(entry.details ?? entry, `entry-${entry.id || index}`, timestampOf(entry.timestamp)));
      }
      return;
    }
    const message = messageOf(entry);
    if (!message || message.role !== "toolResult") return;
    if (asText(fieldOf(message, "toolName")) !== "advise") return;
    const fallbackTs = timestampOf(fieldOf(message, "timestamp"));
    const fromDetails = advisorNotesFrom(fieldOf(message, "details"), `advise-${entry.id || index}`, fallbackTs);
    if (fromDetails.length > 0) {
      notes.push(...fromDetails);
      return;
    }
    const text = contentText(message.content);
    if (text) {
      notes.push({ id: `advise-${entry.id || index}`, timestamp: fallbackTs, message: text, severity: "info" });
    }
  });

  for (const event of events) {
    if (!isToolAgentEvent(event) || event.toolName !== "advise") continue;
    if (event.type !== "tool_execution_end") continue;
    const now = Date.now();
    const fromResult = advisorNotesFrom(isRecord(event.result) ? (event.result.details ?? event.result) : null, event.toolCallId, now);
    if (fromResult.length > 0) {
      notes.push(...fromResult);
      continue;
    }
    const fromArgs = advisorNotesFrom(event.args, event.toolCallId, now);
    notes.push(...fromArgs);
  }

  const seen = new Set<string>();
  return notes
    .filter((note) => {
      const key = `${note.timestamp}:${note.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-60);
}

/* -------------------------------------------------------------------------- */
/* Subagents                                                                   */
/* -------------------------------------------------------------------------- */

function subagentLabel(args: unknown, toolName: string): { description: string; prompt: string } {
  if (!isRecord(args)) return { description: toolName, prompt: "" };
  return {
    description: asText(args.description) ?? asText(args.label) ?? asText(args.name) ?? toolName,
    prompt: asText(args.prompt) ?? asText(args.objective) ?? asText(args.task) ?? "",
  };
}

/**
 * Every delegated run in the session, keyed by tool call id: the call supplies
 * the task text, the result supplies the outcome, and live events refresh
 * whichever runs are still in flight.
 */
export function deriveSubagentRecords(entries: SessionEntry[], events: AgentEvent[]): SubagentRecord[] {
  const runs = new Map<string, SubagentRecord>();

  for (const entry of entries) {
    const message = messageOf(entry);
    if (!message) continue;

    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isRecord(block) || block.type !== "toolCall") continue;
        const toolName = asText(block.name);
        const toolCallId = asText(block.toolCallId) ?? asText(block.id);
        if (!toolName || !toolCallId || !SUB_TOOLS.has(toolName)) continue;
        const { description, prompt } = subagentLabel(block.arguments ?? block.input, toolName);
        const existing = runs.get(toolCallId);
        runs.set(toolCallId, {
          id: toolCallId,
          description,
          prompt,
          status: existing?.status ?? "running",
          lastActivity: timestampOf(fieldOf(message, "timestamp")),
          result: existing?.result,
          isError: existing?.isError,
        });
      }
      continue;
    }

    if (message.role === "toolResult") {
      const toolName = asText(fieldOf(message, "toolName"));
      const toolCallId = asText(fieldOf(message, "toolCallId"));
      if (!toolName || !toolCallId || !SUB_TOOLS.has(toolName)) continue;
      const existing = runs.get(toolCallId);
      const isError = fieldOf(message, "isError") === true;
      runs.set(toolCallId, {
        id: toolCallId,
        description: existing?.description ?? toolName,
        prompt: existing?.prompt ?? "",
        status: isError ? "failed" : "completed",
        lastActivity: timestampOf(fieldOf(message, "timestamp")),
        result: contentText(message.content),
        isError,
      });
    }
  }

  for (const event of events) {
    if (!isToolAgentEvent(event) || !SUB_TOOLS.has(event.toolName)) continue;
    const existing = runs.get(event.toolCallId);
    const { description, prompt } = subagentLabel(event.args, event.toolName);

    if (event.type === "tool_execution_end") {
      const isError = event.isError === true;
      runs.set(event.toolCallId, {
        id: event.toolCallId,
        description: existing?.description ?? description,
        prompt: prompt || (existing?.prompt ?? ""),
        status: isError ? "failed" : "completed",
        lastActivity: Date.now(),
        result: typeof event.result === "string" ? event.result : safeStringify(event.result),
        isError,
      });
      continue;
    }

    runs.set(event.toolCallId, {
      id: event.toolCallId,
      description: description || (existing?.description ?? event.toolName),
      prompt: prompt || (existing?.prompt ?? ""),
      status: "running",
      lastActivity: Date.now(),
      result: existing?.result,
      isError: existing?.isError,
    });
  }

  return [...runs.values()];
}
