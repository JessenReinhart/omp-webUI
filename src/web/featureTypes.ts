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
}


