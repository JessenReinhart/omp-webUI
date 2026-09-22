import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  Attachment01Icon,
  CheckmarkCircle01Icon,
  GitBranchIcon,
  RefreshIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useState } from "react";
import LatticeLoader from "./LatticeLoader";
import type {
  GitFileChange,
  WorkspaceChangesResponse,
  WorkspaceChangesSummary,
} from "./workspaceTypes";

export interface WorkspaceChangesProps {
  token: string;
  onSelectDiff: (path: string, staged?: boolean) => void;
  onAttachFile?: (attachment: { path: string; name: string; kind: "file" }) => void;
  onPromptReview?: (files: string[]) => void;
  onChangeCount?: (count: number) => void;
  refreshTrigger?: number;
}

const STATUS_CONFIG: Record<
  GitFileChange["status"],
  { label: string; color: string; bg: string }
> = {
  modified: { label: "M", color: "var(--amber)", bg: "var(--amber-soft)" },
  added: { label: "A", color: "var(--green)", bg: "var(--green-soft)" },
  deleted: { label: "D", color: "var(--danger)", bg: "var(--danger-soft)" },
  untracked: { label: "U", color: "var(--blue)", bg: "rgba(84, 151, 255, 0.12)" },
  renamed: { label: "R", color: "var(--purple)", bg: "var(--purple-soft)" },
};

export function WorkspaceChanges({
  token,
  onSelectDiff,
  onAttachFile,
  onPromptReview,
  onChangeCount,
  refreshTrigger,
}: WorkspaceChangesProps) {
  const [branch, setBranch] = useState<string>("");
  const [clean, setClean] = useState<boolean>(true);
  const [files, setFiles] = useState<GitFileChange[]>([]);
  const [summary, setSummary] = useState<WorkspaceChangesSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChanges = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/workspace/changes?token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      const data: WorkspaceChangesResponse = await res.json();
      if (!data.ok) {
        throw new Error(data.error || "Failed to fetch git changes");
      }
      const totalChanges = data.summary?.total ?? (data.files?.length ?? 0);
      setBranch(data.branch || "");
      setClean(Boolean(data.clean));
      setFiles(data.files || []);
      setSummary(data.summary || null);
      onChangeCount?.(totalChanges);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error loading git changes");
    } finally {
      setLoading(false);
    }
  }, [token, onChangeCount]);

  useEffect(() => {
    fetchChanges();
  }, [fetchChanges, refreshTrigger]);

  return (
    <div
      className="workspace-changes-container"
      style={{ display: "flex", flexDirection: "column", height: "100%", gap: "8px" }}
    >
      <header
        className="workspace-changes-header"
        style={{ display: "flex", flexDirection: "column", gap: "8px" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <h4 style={{ margin: 0, fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text)" }}>
              Changes
            </h4>
            {branch ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "0.68rem",
                  color: "var(--purple)",
                  background: "var(--purple-soft)",
                  padding: "2px 6px",
                  borderRadius: "var(--radius-sm)",
                  fontFamily: "monospace",
                }}
                title={`Branch: ${branch}`}
              >
                <HugeiconsIcon icon={GitBranchIcon} size={12} strokeWidth={1.8} />
                <span style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {branch}
                </span>
              </span>
            ) : null}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            {files.length > 0 && onPromptReview ? (
              <button
                type="button"
                onClick={() => onPromptReview(files.map((f) => f.path))}
                title="Ask OMP to review uncommitted changes"
                aria-label="Review uncommitted changes in OMP"
                style={{
                  background: "var(--purple-soft)",
                  border: "1px solid rgba(184, 92, 255, 0.3)",
                  color: "var(--purple)",
                  cursor: "pointer",
                  padding: "3px 8px",
                  borderRadius: "var(--radius-sm)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                }}
              >
                <HugeiconsIcon icon={SparklesIcon} size={12} strokeWidth={1.8} />
                <span>Review</span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={fetchChanges}
              disabled={loading}
              title="Refresh changes"
              aria-label="Refresh git changes"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--muted)",
                cursor: loading ? "default" : "pointer",
                padding: "4px",
                borderRadius: "var(--radius-sm)",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                size={14}
                strokeWidth={1.8}
                className={loading ? "animate-spin" : ""}
              />
            </button>
          </div>
        </div>

        {summary && summary.total > 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "var(--text-xs)",
              color: "var(--muted)",
            }}
          >
            <span>{summary.total} changed {summary.total === 1 ? "file" : "files"}</span>
            {summary.staged > 0 ? (
              <span style={{ color: "var(--green)" }}>{summary.staged} staged</span>
            ) : null}
            {summary.unstaged > 0 ? (
              <span style={{ color: "var(--amber)" }}>{summary.unstaged} unstaged</span>
            ) : null}
            {summary.untracked > 0 ? (
              <span style={{ color: "var(--blue)" }}>{summary.untracked} untracked</span>
            ) : null}
          </div>
        ) : null}
      </header>

      <div
        className="workspace-changes-list"
        style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}
      >
        {loading && files.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 12px" }}>
            <LatticeLoader
              status="working"
              label="Inspecting git status"
              pattern="dots"
              grid={3}
              shape="round"
              cellSize={4}
              gap={2}
              fontSize={11}
              showTimer={false}
            />
          </div>
        ) : error ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              color: "var(--danger)",
              padding: "12px",
              fontSize: "var(--text-xs)",
            }}
          >
            <HugeiconsIcon icon={AlertCircleIcon} size={15} strokeWidth={1.8} />
            <span>{error}</span>
          </div>
        ) : clean || files.length === 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              color: "var(--muted)",
              padding: "16px 8px",
              fontSize: "var(--text-xs)",
              justifyContent: "center",
            }}
          >
            <HugeiconsIcon icon={CheckmarkCircle01Icon} size={16} strokeWidth={1.8} style={{ color: "var(--green)" }} />
            <span>Working tree clean</span>
          </div>
        ) : (
          files.map((file) => {
            const config = STATUS_CONFIG[file.status] || {
              label: "?",
              color: "var(--muted)",
              bg: "var(--panel-2)",
            };
            const fileName = file.path.split("/").pop() || file.path;

            return (
              <div
                key={`${file.path}-${file.staged ? "staged" : "unstaged"}`}
                className="workspace-change-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--panel-2)",
                  border: "1px solid var(--line-soft)",
                  paddingRight: "6px",
                }}
              >
                <button
                  type="button"
                  onClick={() => onSelectDiff(file.path, file.staged)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "6px 8px",
                    fontSize: "var(--text-xs)",
                    color: "var(--text)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    flex: 1,
                    minWidth: 0,
                  }}
                  className="workspace-change-item"
                  title={`${file.path} (${file.status})`}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "18px",
                      height: "18px",
                      borderRadius: "3px",
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      color: config.color,
                      background: config.bg,
                      flexShrink: 0,
                    }}
                    title={`Status: ${file.status}${file.staged ? " (staged)" : ""}`}
                  >
                    {config.label}
                  </span>

                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                      fontFamily: "monospace",
                    }}
                  >
                    {file.path}
                  </span>

                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "0.68rem",
                      fontFamily: "monospace",
                      flexShrink: 0,
                    }}
                  >
                    {file.additions > 0 ? (
                      <span style={{ color: "var(--green)" }}>+{file.additions}</span>
                    ) : null}
                    {file.deletions > 0 ? (
                      <span style={{ color: "var(--danger)" }}>-{file.deletions}</span>
                    ) : null}
                  </div>
                </button>

                {onAttachFile ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAttachFile({
                        path: file.path,
                        name: fileName,
                        kind: "file",
                      });
                    }}
                    title="Attach file to prompt"
                    aria-label={`Attach ${file.path} to prompt`}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--muted)",
                      cursor: "pointer",
                      padding: "4px",
                      borderRadius: "var(--radius-sm)",
                      display: "inline-flex",
                      alignItems: "center",
                      opacity: 0.7,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
                  >
                    <HugeiconsIcon icon={Attachment01Icon} size={13} strokeWidth={1.8} />
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default WorkspaceChanges;
