import { isToolAgentEvent, type AgentEvent, type AgentSnapshot, type SessionEntry, type WireMessage } from "./collabTypes";
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

/**
 * Agent identifiers embedded in a delegated run's result text. Task results
 * carry a `<task-result id="...">` envelope; subagent tools mention registry
 * UUIDs inline. Lower-cased UUIDs so merge comparisons are case-stable.
 */
const TASK_RESULT_ID_RE = /<task-result\s+id="([^"]+)"/g;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function extractAgentIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(TASK_RESULT_ID_RE)) {
    const id = match[1];
    if (id) ids.add(id);
  }
  for (const match of text.matchAll(UUID_RE)) ids.add(match[0].toLowerCase());
  return [...ids];
}

/**
 * Runs described by one delegated tool call. `description`/`prompt` are null
 * when the args carry no usable text (partial streaming args) so callers can
 * keep previously stored values instead of clobbering them with tool-name
 * fallbacks.
 */
function subagentRuns(args: unknown, toolName: string, toolCallId: string): Array<{ id: string; description: string | null; prompt: string | null }> {
  if (toolName === "task" && isRecord(args) && Array.isArray(args.tasks)) {
    const tasks = args.tasks.filter(isRecord);
    if (tasks.length > 0) {
      return tasks.map((task, index) => ({
        id: `${toolCallId}:${index}`,
        description: asText(task.name) ?? asText(task.agent) ?? null,
        prompt: asText(task.task) ?? asText(task.description) ?? null,
      }));
    }
  }

  if (!isRecord(args)) return [{ id: toolCallId, description: null, prompt: null }];
  return [{
    id: toolCallId,
    description: asText(args.description) ?? asText(args.label) ?? asText(args.name) ?? null,
    prompt: asText(args.prompt) ?? asText(args.objective) ?? asText(args.task) ?? null,
  }];
}

function subagentRunIds(runs: Map<string, SubagentRecord>, toolCallId: string): string[] {
  const ids = [...runs.keys()].filter((id) => id === toolCallId || id.startsWith(`${toolCallId}:`));
  return ids.length > 0 ? ids : [toolCallId];
}

/**
 * Every delegated run in the session, keyed by tool call id: the call supplies
 * the task text, the result supplies the outcome, and live events refresh
 * whichever runs are still in flight.
 */
export function deriveSubagentRecords(
  entries: SessionEntry[],
  events: AgentEvent[],
  agents: AgentSnapshot[] = [],
): SubagentRecord[] {
  const runs = new Map<string, SubagentRecord>();

  const upsertCall = (toolName: string, toolCallId: string, args: unknown, timestamp: number) => {
    for (const run of subagentRuns(args, toolName, toolCallId)) {
      const existing = runs.get(run.id);
      // Clobber guard: streaming tool_execution_update frames can arrive with
      // empty or partial args; never overwrite a real description/prompt with
      // the tool-name fallback.
      runs.set(run.id, {
        id: run.id,
        toolName,
        description: run.description ?? existing?.description ?? toolName,
        prompt: run.prompt ?? existing?.prompt ?? "",
        status: existing?.status ?? "running",
        lastActivity: timestamp,
        result: existing?.result,
        isError: existing?.isError,
        parentId: existing?.parentId,
        createdAt: existing?.createdAt,
        hasSessionFile: existing?.hasSessionFile,
        agentId: existing?.agentId,
        agentIds: existing?.agentIds,
        agentName: existing?.agentName,
      });
    }
  };

  const finishRuns = (toolName: string, toolCallId: string, result: unknown, isError: boolean, timestamp: number) => {
    const runIds = subagentRunIds(runs, toolCallId);
    const text = typeof result === "string" ? result : safeStringify(result);
    const extracted = extractAgentIds(text);
    // Attribute per run only when the count lines up (single spawn, or one
    // extracted id per batched task); otherwise leave ids unset rather than
    // smearing one id across sibling rows.
    const perRun = runIds.length === 1 || extracted.length === runIds.length ? extracted : [];
    for (let index = 0; index < runIds.length; index += 1) {
      const id = runIds[index]!;
      const existing = runs.get(id);
      const agentId = perRun[index];
      runs.set(id, {
        id,
        toolName: existing?.toolName ?? toolName,
        description: existing?.description ?? toolName,
        prompt: existing?.prompt ?? "",
        status: isError ? "failed" : "completed",
        lastActivity: timestamp,
        result: text,
        isError,
        parentId: existing?.parentId,
        createdAt: existing?.createdAt,
        hasSessionFile: existing?.hasSessionFile,
        agentId: agentId ?? existing?.agentId,
        agentIds: agentId ? [...new Set([...(existing?.agentIds ?? []), agentId])] : existing?.agentIds,
        agentName: existing?.agentName,
      });
    }
  };

  for (const entry of entries) {
    const message = messageOf(entry);
    if (!message) continue;

    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isRecord(block) || block.type !== "toolCall") continue;
        const toolName = asText(block.name);
        const toolCallId = asText(block.toolCallId) ?? asText(block.id);
        if (!toolName || !toolCallId || !SUB_TOOLS.has(toolName)) continue;
        upsertCall(toolName, toolCallId, block.arguments ?? block.input, timestampOf(fieldOf(message, "timestamp")));
      }
      continue;
    }

    if (message.role === "toolResult") {
      const toolName = asText(fieldOf(message, "toolName"));
      const toolCallId = asText(fieldOf(message, "toolCallId"));
      if (!toolName || !toolCallId || !SUB_TOOLS.has(toolName)) continue;
      finishRuns(toolName, toolCallId, contentText(message.content), fieldOf(message, "isError") === true, timestampOf(fieldOf(message, "timestamp")));
    }
  }

  const hasChildRuns = (toolCallId: string) => {
    for (const key of runs.keys()) if (key.startsWith(`${toolCallId}:`)) return true;
    return false;
  };

  for (const event of events) {
    if (!isToolAgentEvent(event) || !SUB_TOOLS.has(event.toolName)) continue;
    const timestamp = Date.now();
    if (event.type === "tool_execution_end") {
      finishRuns(event.toolName, event.toolCallId, event.result, event.isError === true, timestamp);
      continue;
    }
    // A batched `task` call is represented by its `${toolCallId}:N` child rows.
    // Later streaming events can carry the same or empty args; re-upserting
    // them would add a phantom parent row beside the children.
    if (event.toolName === "task" && hasChildRuns(event.toolCallId)) continue;
    upsertCall(event.toolName, event.toolCallId, event.args, timestamp);
  }

  // Merge each live registry agent into the transcript run that spawned it,
  // so a delegate renders as one row. Identity resolution order: an id
  // extracted from the run's result text, then an exact displayName match
  // against the run description (never against a bare tool-name label, since
  // display names are not unique and "task" is a valid agent name).
  const subAgents = agents.filter((agent) => agent.kind !== "main");
  const mergedAgents = new Set<string>();
  const recordList = [...runs.values()];

  const mergeInto = (record: SubagentRecord, agent: AgentSnapshot) => {
    mergedAgents.add(agent.id);
    record.agentId = agent.id;
    record.agentIds = [...new Set([...(record.agentIds ?? []), agent.id])];
    record.agentName = agent.displayName;
    // The registry tracks the agent's own lifecycle; once merged, the row is
    // that agent, so its live status wins over a transcript status that can
    // lag (result frame vs. park/abort).
    record.status = subagentStatus(agent.status);
    record.parentId = record.parentId ?? agent.parentId;
    record.createdAt = record.createdAt ?? agent.createdAt;
    record.hasSessionFile = record.hasSessionFile || agent.hasSessionFile;
    if (typeof agent.lastActivity === "number"
      && (!record.lastActivity || agent.lastActivity > record.lastActivity)) {
      record.lastActivity = agent.lastActivity;
    }
    // Prefer the human-readable registry name for the generic labels only.
    if (record.description === record.toolName) record.description = agent.displayName;
  };

  for (const agent of subAgents) {
    if (mergedAgents.has(agent.id)) continue;
    const byId = recordList.find((record) => record.agentIds?.includes(agent.id));
    if (byId && !mergedAgents.has(byId.agentId ?? "")) {
      mergeInto(byId, agent);
      continue;
    }
    const byName = recordList.find((record) => !record.agentId
      && record.description !== record.toolName
      && record.description === agent.displayName);
    if (byName) mergeInto(byName, agent);
  }

  // Registry agents with no transcript trace keep their own row.
  for (const agent of subAgents) {
    if (mergedAgents.has(agent.id) || runs.has(agent.id)) continue;
    runs.set(agent.id, {
      id: agent.id,
      description: agent.displayName,
      prompt: "",
      status: subagentStatus(agent.status),
      lastActivity: agent.lastActivity,
      parentId: agent.parentId,
      createdAt: agent.createdAt,
      hasSessionFile: agent.hasSessionFile,
      agentId: agent.id,
      agentIds: [agent.id],
      agentName: agent.displayName,
    });
  }

  return [...runs.values()];
}

function subagentStatus(status: string): SubagentRecord["status"] {
  switch (status) {
    case "parked":
      return "idle";
    case "aborted":
      return "failed";
    case "idle":
    case "ready":
    case "completed":
    case "failed":
    case "running":
      return status;
    default:
      return "running";
  }
}
