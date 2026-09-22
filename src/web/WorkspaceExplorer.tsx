import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  Attachment01Icon,
  File01Icon,
  FileCodeIcon,
  Folder01Icon,
  FolderUploadIcon,
  Image01Icon,
  RefreshIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useState } from "react";
import LatticeLoader from "./LatticeLoader";
import type { WorkspaceFileEntry, WorkspaceTreeResponse } from "./workspaceTypes";

export interface WorkspaceExplorerProps {
  token: string;
  onSelectFile: (path: string) => void;
  onAttachFile?: (attachment: { path: string; name: string; kind: "file" | "image" }) => void;
  refreshTrigger?: number;
}

function getFileCategory(extension?: string, name?: string): { icon: typeof File01Icon; isImage: boolean } {
  const ext = (extension || name?.split(".").pop() || "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "tiff"].includes(ext)) {
    return { icon: Image01Icon, isImage: true };
  }
  if (
    [
      "js",
      "ts",
      "tsx",
      "jsx",
      "json",
      "html",
      "css",
      "scss",
      "less",
      "py",
      "rs",
      "go",
      "c",
      "cpp",
      "h",
      "hpp",
      "java",
      "kt",
      "sh",
      "bash",
      "zsh",
      "yml",
      "yaml",
      "toml",
      "xml",
      "sql",
      "md",
      "mdx",
    ].includes(ext)
  ) {
    return { icon: FileCodeIcon, isImage: false };
  }
  return { icon: File01Icon, isImage: false };
}

export function WorkspaceExplorer({ token, onSelectFile, onAttachFile, refreshTrigger }: WorkspaceExplorerProps) {
  const [subPath, setSubPath] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [entries, setEntries] = useState<WorkspaceFileEntry[]>([]);
  const [root, setRoot] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/workspace/tree?token=${encodeURIComponent(token)}&path=${encodeURIComponent(subPath)}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      const data: WorkspaceTreeResponse = await res.json();
      if (!data.ok) {
        throw new Error(data.error || "Failed to fetch workspace tree");
      }
      setEntries(data.entries || []);
      if (data.root) setRoot(data.root);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error loading files");
    } finally {
      setLoading(false);
    }
  }, [token, subPath]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree, refreshTrigger]);

  const handleNavigateUp = () => {
    if (!subPath) return;
    const parts = subPath.replace(/\\/g, "/").split("/").filter(Boolean);
    parts.pop();
    setSubPath(parts.join("/"));
  };

  const filteredEntries = entries
    .filter((entry) => entry.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });

  const rootName = root ? root.replace(/\\/g, "/").split("/").filter(Boolean).pop() || root : "Workspace";
  const displayBreadcrumb = subPath ? `${rootName} / ${subPath.replace(/\\/g, "/")}` : rootName;

  return (
    <div className="workspace-explorer-container" style={{ display: "flex", flexDirection: "column", height: "100%", gap: "8px" }}>
      <header className="workspace-explorer-header" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h4 style={{ margin: 0, fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text)" }}>Files</h4>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            {subPath ? (
              <button
                type="button"
                onClick={handleNavigateUp}
                title="Navigate up"
                aria-label="Navigate up"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--muted)",
                  cursor: "pointer",
                  padding: "4px",
                  borderRadius: "var(--radius-sm)",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                <HugeiconsIcon icon={FolderUploadIcon} size={15} strokeWidth={1.8} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={fetchTree}
              disabled={loading}
              title="Refresh workspace"
              aria-label="Refresh workspace"
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

        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <span style={{ position: "absolute", left: "8px", display: "inline-flex", alignItems: "center", pointerEvents: "none", color: "var(--faint)" }}>
            <HugeiconsIcon icon={Search01Icon} size={13} strokeWidth={1.8} />
          </span>
          <input
            type="text"
            placeholder="Filter files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "4px 8px 4px 28px",
              fontSize: "var(--text-xs)",
              background: "var(--panel-2)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text)",
              outline: "none",
            }}
          />
        </div>
      </header>

      <div
        className="workspace-breadcrumb"
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--faint)",
          padding: "2px 4px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={displayBreadcrumb}
      >
        {displayBreadcrumb}
      </div>

      <div className="workspace-explorer-list" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
        {loading && entries.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 12px" }}>
            <LatticeLoader
              status="working"
              label="Loading files"
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
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--danger)", padding: "12px", fontSize: "var(--text-xs)" }}>
            <HugeiconsIcon icon={AlertCircleIcon} size={15} strokeWidth={1.8} />
            <span>{error}</span>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div style={{ color: "var(--muted)", padding: "12px", fontSize: "var(--text-xs)", textAlign: "center" }}>
            {search ? "No files matching filter" : "Folder is empty"}
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const { icon: IconComponent, isImage } = entry.isDirectory ? { icon: Folder01Icon, isImage: false } : getFileCategory(entry.extension, entry.name);
            return (
              <div
                key={entry.path}
                className="workspace-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  borderRadius: "var(--radius-sm)",
                  paddingRight: "4px",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (entry.isDirectory) {
                      setSubPath(entry.path);
                      setSearch("");
                    } else {
                      onSelectFile(entry.path);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "6px 8px",
                    fontSize: "var(--text-xs)",
                    color: entry.isDirectory ? "var(--purple)" : "var(--text)",
                    background: "transparent",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    textAlign: "left",
                    flex: 1,
                    minWidth: 0,
                  }}
                  className="workspace-item-btn"
                  title={entry.path}
                >
                  <HugeiconsIcon
                    icon={IconComponent}
                    size={15}
                    strokeWidth={1.8}
                    style={{ flexShrink: 0, color: entry.isDirectory ? "var(--purple)" : "var(--muted)" }}
                  />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{entry.name}</span>
                  {entry.size && !entry.isDirectory ? (
                    <span style={{ fontSize: "0.68rem", color: "var(--faint)", flexShrink: 0 }}>
                      {entry.size < 1024 ? `${entry.size}B` : `${Math.round(entry.size / 1024)}KB`}
                    </span>
                  ) : null}
                </button>

                {!entry.isDirectory && onAttachFile ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAttachFile({
                        path: entry.path,
                        name: entry.name,
                        kind: isImage ? "image" : "file",
                      });
                    }}
                    title="Attach file to prompt"
                    aria-label={`Attach ${entry.name} to prompt`}
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

export default WorkspaceExplorer;
