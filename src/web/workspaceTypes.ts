export interface WorkspaceFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  extension?: string;
}

export interface WorkspaceTreeResponse {
  ok?: boolean;
  root?: string;
  subPath?: string;
  entries?: WorkspaceFileEntry[];
  error?: string;
}

export interface WorkspaceFileResponse {
  ok?: boolean;
  path?: string;
  name?: string;
  size?: number;
  content?: string;
  isBinary?: boolean;
  error?: string;
}

export interface GitFileChange {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  staged: boolean;
  additions: number;
  deletions: number;
}

export interface WorkspaceChangesSummary {
  total: number;
  staged: number;
  unstaged: number;
  untracked: number;
}

export interface WorkspaceChangesResponse {
  ok?: boolean;
  branch?: string;
  clean?: boolean;
  files?: GitFileChange[];
  summary?: WorkspaceChangesSummary;
  error?: string;
}

export interface WorkspaceDiffResponse {
  ok?: boolean;
  path?: string;
  diff?: string;
  error?: string;
}

export interface WorkspaceSessionSummary {
  id: string;
  title: string;
  cwd: string;
  created: string;
  modified: string;
  messageCount: number;
  fileId: string;
  path?: string;
}

export interface WorkspaceGroup {
  id: string;
  name: string;
  cwd: string;
  isCurrent: boolean;
  sessions: WorkspaceSessionSummary[];
}

export interface MultiWorkspaceSessionsResponse {
  ok: boolean;
  workspaces?: WorkspaceGroup[];
  sessions?: WorkspaceSessionSummary[];
  currentWorkspace?: string;
  error?: string;
}

