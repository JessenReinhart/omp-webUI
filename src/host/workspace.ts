import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";

export interface WorkspaceTreeEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  extension?: string;
}

export interface WorkspaceTreeResult {
  root: string;
  cwd: string;
  subPath: string;
  entries: WorkspaceTreeEntry[];
}

export interface WorkspaceFileResult {
  path: string;
  name: string;
  size: number;
  content: string;
  isBinary: boolean;
}

export interface WorkspaceFileChange {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  staged: boolean;
  additions: number;
  deletions: number;
}

export interface WorkspaceChangesResult {
  branch: string;
  clean: boolean;
  files: WorkspaceFileChange[];
  summary: {
    total: number;
    staged: number;
    unstaged: number;
    untracked: number;
  };
}

export interface WorkspaceDiffResult {
  path: string;
  diff: string;
}

const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist"]);

function isInsideWorkspace(resolvedCwd: string, targetPath: string): boolean {
  const rel = relative(resolvedCwd, targetPath);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

function isSafePath(filePath: string): boolean {
  const parts = filePath.split(/[\\/]/);
  if (parts.some((part) => EXCLUDED_DIRS.has(part))) return false;
  const name = parts.at(-1)?.toLowerCase() ?? "";
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return false;
  return !name.endsWith(".pem") && !name.endsWith(".key");
}

export function getWorkspaceTree(cwd: string, subPath?: string): WorkspaceTreeResult {
  const resolvedCwd = resolve(cwd);
  const targetPath = resolve(resolvedCwd, subPath ?? "");

  if (!isInsideWorkspace(resolvedCwd, targetPath)) {
    throw new Error("Access denied: path outside workspace");
  }

  if (!existsSync(targetPath)) {
    throw new Error("Directory not found");
  }

  const dirents = readdirSync(targetPath, { withFileTypes: true });
  const relativeSubPath = relative(resolvedCwd, targetPath).replace(/\\/g, "/");

  const entries: WorkspaceTreeEntry[] = [];

  for (const dirent of dirents) {
    if (EXCLUDED_DIRS.has(dirent.name)) {
      continue;
    }

    const fullPath = join(targetPath, dirent.name);
    const relPath = relative(resolvedCwd, fullPath).replace(/\\/g, "/");

    if (!isSafePath(relPath)) {
      continue;
    }

    const isDirectory = dirent.isDirectory();

    if (isDirectory) {
      entries.push({
        name: dirent.name,
        path: relPath,
        isDirectory: true,
      });
    } else {
      let size: number | undefined;
      try {
        size = statSync(fullPath).size;
      } catch {
        size = undefined;
      }

      entries.push({
        name: dirent.name,
        path: relPath,
        isDirectory: false,
        size,
        extension: extname(dirent.name),
      });
    }
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });

  return {
    root: basename(resolvedCwd),
    cwd: resolvedCwd,
    subPath: relativeSubPath,
    entries,
  };
}

export function getWorkspaceFile(cwd: string, filePath: string): WorkspaceFileResult {
  const resolvedCwd = resolve(cwd);
  const targetPath = resolve(resolvedCwd, filePath);

  if (!isInsideWorkspace(resolvedCwd, targetPath)) {
    throw new Error("Access denied: path outside workspace");
  }

  const relPath = relative(resolvedCwd, targetPath).replace(/\\/g, "/");
  if (!isSafePath(relPath)) {
    throw new Error("Access denied: protected file");
  }

  if (!existsSync(targetPath)) {
    throw new Error("File not found");
  }

  const stats = statSync(targetPath);
  if (stats.isDirectory()) {
    throw new Error("Path is a directory");
  }

  const fileName = basename(targetPath);
  const size = stats.size;

  if (size > 1024 * 1024) {
    return {
      path: relPath,
      name: fileName,
      size,
      content: "",
      isBinary: true,
    };
  }

  const buffer = readFileSync(targetPath);
  const isBinary = buffer.includes(0);

  if (isBinary) {
    return {
      path: relPath,
      name: fileName,
      size,
      content: "",
      isBinary: true,
    };
  }

  return {
    path: relPath,
    name: fileName,
    size,
    content: buffer.toString("utf-8"),
    isBinary: false,
  };
}

export function getWorkspaceChanges(cwd: string): WorkspaceChangesResult {
  const resolvedCwd = resolve(cwd);

  const fallback: WorkspaceChangesResult = {
    branch: "",
    clean: true,
    files: [],
    summary: {
      total: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
    },
  };

  const branchProc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: resolvedCwd });
  if (branchProc.exitCode !== 0) {
    return fallback;
  }
  const branch = branchProc.stdout.toString().trim() || "HEAD";

  const statusProc = Bun.spawnSync(["git", "status", "--porcelain=v1", "-u"], { cwd: resolvedCwd });
  if (statusProc.exitCode !== 0) {
    return fallback;
  }
  const statusOutput = statusProc.stdout.toString();

  const diffUnstagedProc = Bun.spawnSync(["git", "diff", "--numstat"], { cwd: resolvedCwd });
  const diffStagedProc = Bun.spawnSync(["git", "diff", "--cached", "--numstat"], { cwd: resolvedCwd });

  const numstatMap = new Map<string, { additions: number; deletions: number }>();

  const parseNumstat = (output: string) => {
    const lines = output.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const additions = parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
        const deletions = parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
        const file = parts.slice(2).join(" ");
        numstatMap.set(file, { additions, deletions });
      }
    }
  };

  if (diffUnstagedProc.exitCode === 0) {
    parseNumstat(diffUnstagedProc.stdout.toString());
  }
  if (diffStagedProc.exitCode === 0) {
    parseNumstat(diffStagedProc.stdout.toString());
  }

  const files: WorkspaceFileChange[] = [];
  let stagedCount = 0;
  let unstagedCount = 0;
  let untrackedCount = 0;

  const statusLines = statusOutput.split("\n");
  for (const line of statusLines) {
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    let fileStr = line.slice(3).trim();

    if (fileStr.startsWith('"') && fileStr.endsWith('"')) {
      fileStr = fileStr.slice(1, -1);
    }

    if (fileStr.includes(" -> ")) {
      fileStr = fileStr.split(" -> ")[1];
    }

    const code = x !== " " && x !== "?" ? x : y;

    let status: "modified" | "added" | "deleted" | "renamed" | "untracked" = "modified";
    if (code === "M") status = "modified";
    else if (code === "A") status = "added";
    else if (code === "D") status = "deleted";
    else if (code === "R") status = "renamed";
    else if (code === "?" || x === "?" || y === "?") status = "untracked";

    const isStaged = x !== " " && x !== "?";

    if (status === "untracked") {
      untrackedCount++;
    } else if (isStaged) {
      stagedCount++;
    } else {
      unstagedCount++;
    }

    const numstat = numstatMap.get(fileStr) ?? { additions: 0, deletions: 0 };

    files.push({
      path: fileStr,
      status,
      staged: isStaged,
      additions: numstat.additions,
      deletions: numstat.deletions,
    });
  }

  return {
    branch,
    clean: files.length === 0,
    files,
    summary: {
      total: files.length,
      staged: stagedCount,
      unstaged: unstagedCount,
      untracked: untrackedCount,
    },
  };
}

export function getWorkspaceDiff(cwd: string, filePath?: string, staged?: boolean): WorkspaceDiffResult {
  const resolvedCwd = resolve(cwd);

  const args = ["git", "diff"];
  if (staged) {
    args.push("--cached");
  }
  if (filePath) {
    args.push("--", filePath);
  }

  const proc = Bun.spawnSync(args, { cwd: resolvedCwd });
  let diffStr = proc.exitCode === 0 ? proc.stdout.toString() : "";

  if (!diffStr && filePath) {
    const statusProc = Bun.spawnSync(["git", "status", "--porcelain=v1", "-u", "--", filePath], { cwd: resolvedCwd });
    const statusOut = statusProc.exitCode === 0 ? statusProc.stdout.toString().trim() : "";

    if (statusOut.startsWith("??") || statusOut.startsWith("?")) {
      try {
        const fileRes = getWorkspaceFile(resolvedCwd, filePath);
        if (!fileRes.isBinary && fileRes.content) {
          const lines = fileRes.content.split("\n");
          diffStr = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => `+${l}`).join("\n");
        }
      } catch {
        // File reading error, fallback to empty diff
      }
    }
  }

  return {
    path: filePath ?? "",
    diff: diffStr,
  };
}
