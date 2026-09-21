export interface TodoTask {
  content: string;
  status: "pending" | "in_progress" | "completed" | "abandoned" | "blocked";
  blocker?: string;
}

export interface TodoPhase {
  name: string;
  tasks: TodoTask[];
}

export interface AdvisorNote {
  id: string;
  timestamp: number;
  message: string;
  severity?: "nit" | "concern" | "blocker" | "info";
  toolCallId?: string;
}

export interface SubagentRecord {
  id: string;
  description: string;
  prompt: string;
  status: "running" | "idle" | "ready" | "completed" | "failed";
  lastActivity?: number;
  result?: string;
  isError?: boolean;
  parentId?: string;
  createdAt?: number;
  hasSessionFile?: boolean;
  /** Delegating tool this run came from ("task", "subagent", …); registry-only rows have none. */
  toolName?: string;
  /** Registry agent id this run was merged with, when identity resolved. */
  agentId?: string;
  /** Every agent id extracted from the run (tool result envelope, UUIDs, registry match). */
  agentIds?: string[];
  /** Resolved registry display name, row live agent. */
  agentName?: string;
}


