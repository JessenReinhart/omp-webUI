import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  Attachment01Icon,
  Cancel01Icon,
  Copy01Icon,
  FileCodeIcon,
  GitCommitIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useState } from "react";
import LatticeLoader from "./LatticeLoader";
import type { WorkspaceDiffResponse, WorkspaceFileResponse } from "./workspaceTypes";

export interface FileDiffViewerProps {
  token: string;
  target: {
    type: "file" | "diff";
    path: string;
    staged?: boolean;
  } | null;
  onClose: () => void;
  onAttachFile?: (attachment: { path: string; name: string; kind: "file" }) => void;
}

export function FileDiffViewer({ token, target, onClose, onAttachFile }: FileDiffViewerProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [fileData, setFileData] = useState<WorkspaceFileResponse | null>(null);
  const [diffData, setDiffData] = useState<WorkspaceDiffResponse | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [attached, setAttached] = useState<boolean>(false);

  const fetchData = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    setError(null);
    setFileData(null);
    setDiffData(null);
    setCopied(false);

    try {
      if (target.type === "file") {
        const url = `/api/workspace/file?token=${encodeURIComponent(token)}&path=${encodeURIComponent(target.path)}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Server returned HTTP ${res.status}`);
        }
        const data: WorkspaceFileResponse = await res.json();
        if (!data.ok) {
          throw new Error(data.error || "Failed to fetch file content");
        }
        setFileData(data);
      } else {
        const stagedParam = target.staged ? "&staged=true" : "";
        const url = `/api/workspace/diff?token=${encodeURIComponent(token)}&path=${encodeURIComponent(target.path)}${stagedParam}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Server returned HTTP ${res.status}`);
        }
        const data: WorkspaceDiffResponse = await res.json();
        if (!data.ok) {
          throw new Error(data.error || "Failed to fetch diff");
        }
        setDiffData(data);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error loading content");
    } finally {
      setLoading(false);
    }
  }, [token, target]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!target) return null;

  const textToCopy =
    target.type === "file" ? fileData?.content || "" : diffData?.diff || "";

  const handleCopy = () => {
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleAttach = () => {
    if (!target || !onAttachFile) return;
    const name = target.path.split("/").pop() || target.path;
    onAttachFile({ path: target.path, name, kind: "file" });
    setAttached(true);
    setTimeout(() => setAttached(false), 2000);
  };

  return (
    <div
      className="file-diff-viewer-overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        className="file-diff-viewer-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "960px",
          height: "85vh",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-md)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--line)",
            background: "var(--panel-2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
            {target.type === "file" ? (
              <HugeiconsIcon icon={FileCodeIcon} size={18} strokeWidth={1.8} style={{ color: "var(--purple)", flexShrink: 0 }} />
            ) : (
              <HugeiconsIcon icon={GitCommitIcon} size={18} strokeWidth={1.8} style={{ color: "var(--amber)", flexShrink: 0 }} />
            )}
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text)" }}>
                  {target.type === "file" ? "File Preview" : "Git Diff"}
                </span>
                <span
                  style={{
                    fontSize: "0.68rem",
                    padding: "2px 6px",
                    borderRadius: "var(--radius-sm)",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    background:
                      target.type === "file"
                        ? "var(--purple-soft)"
                        : target.staged
                        ? "var(--green-soft)"
                        : "var(--amber-soft)",
                    color:
                      target.type === "file"
                        ? "var(--purple)"
                        : target.staged
                        ? "var(--green)"
                        : "var(--amber)",
                  }}
                >
                  {target.type === "file"
                    ? "File"
                    : target.staged
                    ? "Staged Diff"
                    : "Diff"}
                </span>
              </div>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--muted)",
                  fontFamily: "monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={target.path}
              >
                {target.path}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {onAttachFile ? (
              <button
                type="button"
                onClick={handleAttach}
                title="Attach file to prompt"
                aria-label="Attach file to prompt"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "6px 10px",
                  fontSize: "var(--text-xs)",
                  background: "var(--purple-soft)",
                  border: "1px solid rgba(184, 92, 255, 0.3)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--purple)",
                  cursor: "pointer",
                }}
              >
                {attached ? (
                  <>
                    <HugeiconsIcon icon={Tick01Icon} size={14} strokeWidth={1.8} style={{ color: "var(--green)" }} />
                    <span>Attached!</span>
                  </>
                ) : (
                  <>
                    <HugeiconsIcon icon={Attachment01Icon} size={14} strokeWidth={1.8} />
                    <span>Attach to prompt</span>
                  </>
                )}
              </button>
            ) : null}

            <button
              type="button"
              onClick={handleCopy}
              disabled={loading || !textToCopy}
              title="Copy content"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "6px 10px",
                fontSize: "var(--text-xs)",
                background: "var(--panel-3)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text)",
                cursor: loading || !textToCopy ? "default" : "pointer",
              }}
            >
              {copied ? (
                <>
                  <HugeiconsIcon icon={Tick01Icon} size={14} strokeWidth={1.8} style={{ color: "var(--green)" }} />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={1.8} />
                  <span>Copy</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              title="Close modal (Esc)"
              aria-label="Close modal"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                padding: "6px",
                borderRadius: "var(--radius-sm)",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={1.8} />
            </button>
          </div>
        </header>

        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "16px",
            fontFamily: "monospace",
            fontSize: "var(--text-xs)",
            background: "var(--bg)",
          }}
        >
          {loading ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                height: "100%",
                color: "var(--muted)",
              }}
            >
              <LatticeLoader
                status="working"
                label="Loading preview"
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
                justifyContent: "center",
                gap: "8px",
                height: "100%",
                color: "var(--danger)",
              }}
            >
              <HugeiconsIcon icon={AlertCircleIcon} size={20} strokeWidth={1.8} />
              <span>{error}</span>
            </div>
          ) : target.type === "file" ? (
            fileData?.isBinary ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "var(--muted)",
                }}
              >
                Binary file cannot be previewed textually.
              </div>
            ) : (
              <div style={{ display: "table", width: "100%", borderCollapse: "collapse" }}>
                {(fileData?.content ?? "").split("\n").map((line, index) => (
                  <div
                    key={`line-${index + 1}`}
                    style={{
                      display: "table-row",
                      lineHeight: "1.5",
                    }}
                  >
                    <span
                      style={{
                        display: "table-cell",
                        width: "48px",
                        paddingRight: "16px",
                        color: "var(--faint)",
                        textAlign: "right",
                        userSelect: "none",
                      }}
                    >
                      {index + 1}
                    </span>
                    <span
                      style={{
                        display: "table-cell",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        color: "var(--text)",
                      }}
                    >
                      {line || " "}
                    </span>
                  </div>
                ))}
              </div>
            )
          ) : !diffData?.diff ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--muted)",
              }}
            >
              No diff changes detected for this file.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {diffData.diff.split("\n").map((line, index) => {
                let color = "var(--text)";
                let background = "transparent";
                let fontWeight = "normal";

                if (line.startsWith("@@")) {
                  color = "var(--purple)";
                  background = "var(--purple-soft)";
                  fontWeight = "600";
                } else if (line.startsWith("+") && !line.startsWith("+++")) {
                  color = "var(--green)";
                  background = "var(--green-soft)";
                } else if (line.startsWith("-") && !line.startsWith("---")) {
                  color = "var(--danger)";
                  background = "var(--danger-soft)";
                } else if (
                  line.startsWith("diff --git") ||
                  line.startsWith("---") ||
                  line.startsWith("+++") ||
                  line.startsWith("index")
                ) {
                  color = "var(--faint)";
                  fontWeight = "600";
                }

                return (
                  <div
                    key={`diff-line-${index + 1}`}
                    style={{
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      padding: "1px 4px",
                      color,
                      background,
                      fontWeight,
                      lineHeight: "1.5",
                    }}
                  >
                    {line || " "}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default FileDiffViewer;
