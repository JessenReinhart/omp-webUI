import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  Cancel01Icon,
  Folder01Icon,
  FolderAddIcon,
  FolderUploadIcon,
  RefreshIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import LatticeLoader from "./LatticeLoader";

export interface AddWorkspaceModalProps {
  token: string;
  isOpen: boolean;
  onClose: () => void;
  onWorkspaceAdded: (workspace: { name: string; cwd: string }) => void;
}

interface DirectorySuggestion {
  name: string;
  path: string;
}

export function AddWorkspaceModal({
  token,
  isOpen,
  onClose,
  onWorkspaceAdded,
}: AddWorkspaceModalProps) {
  const [pathInput, setPathInput] = useState("");
  const [createIfMissing, setCreateIfMissing] = useState(true);
  const [startFresh, setStartFresh] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<DirectorySuggestion[]>([]);
  const [currentBrowseDir, setCurrentBrowseDir] = useState<string>("");
  const [parentBrowseDir, setParentBrowseDir] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const fetchSuggestions = useCallback(
    async (browsePath = "") => {
      setLoadingSuggestions(true);
      try {
        const query = browsePath ? `&path=${encodeURIComponent(browsePath)}` : "";
        const res = await fetch(`/api/workspaces/browse?token=${encodeURIComponent(token)}${query}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.ok && Array.isArray(data.directories)) {
          setSuggestions(data.directories);
          if (data.current) setCurrentBrowseDir(data.current);
          if (data.parent) setParentBrowseDir(data.parent);
        }
      } catch {
        // Non-critical, ignore suggestion fetch error
      } finally {
        setLoadingSuggestions(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setPathInput("");
      void fetchSuggestions("");
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, fetchSuggestions]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = pathInput.trim();
    if (!trimmed) {
      setError("Please enter a directory path");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/workspaces/add?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: trimmed,
          createIfMissing,
          startFresh,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to add workspace");
      }

      onWorkspaceAdded(data.workspace);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error adding workspace");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelectSuggestion = (path: string) => {
    setPathInput(path);
    setError(null);
  };

  return (
    <div
      className="add-workspace-overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        className="add-workspace-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "560px",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-md)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid var(--line)",
            background: "var(--panel-2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <HugeiconsIcon icon={FolderAddIcon} size={18} strokeWidth={1.8} style={{ color: "var(--purple)" }} />
            <h3 style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text)" }}>
              Add Workspace
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
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
            <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={1.8} />
          </button>
        </header>

        {/* Content Form */}
        <form onSubmit={handleSubmit} style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Error Banner */}
          {error ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                background: "var(--danger-soft)",
                border: "1px solid rgba(255, 107, 107, 0.3)",
                color: "var(--danger)",
                fontSize: "var(--text-xs)",
              }}
            >
              <HugeiconsIcon icon={AlertCircleIcon} size={15} strokeWidth={1.8} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{error}</span>
            </div>
          ) : null}

          {/* Path Input Field */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label
              htmlFor="workspace-path-input"
              style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text)" }}
            >
              Directory Path
            </label>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input
                id="workspace-path-input"
                ref={inputRef}
                type="text"
                value={pathInput}
                onChange={(e) => {
                  setPathInput(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="e.g. C:\projects\my-app or /home/user/code/repo"
                disabled={submitting}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: "var(--text-xs)",
                  fontFamily: "monospace",
                  background: "var(--panel-2)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text)",
                  outline: "none",
                }}
              />
              {pathInput ? (
                <button
                  type="button"
                  onClick={() => setPathInput("")}
                  style={{
                    position: "absolute",
                    right: "8px",
                    background: "transparent",
                    border: "none",
                    color: "var(--muted)",
                    cursor: "pointer",
                    padding: "2px",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                  aria-label="Clear path"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.8} />
                </button>
              ) : null}
            </div>
          </div>

          {/* Directory Suggestions */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
                Quick suggestions {currentBrowseDir ? `in ${currentBrowseDir}` : ""}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                {parentBrowseDir ? (
                  <button
                    type="button"
                    onClick={() => void fetchSuggestions(parentBrowseDir)}
                    title="Browse parent directory"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--muted)",
                      cursor: "pointer",
                      padding: "2px 6px",
                      fontSize: "0.68rem",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <HugeiconsIcon icon={FolderUploadIcon} size={12} strokeWidth={1.8} />
                    <span>Up</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void fetchSuggestions(currentBrowseDir)}
                  title="Refresh suggestions"
                  disabled={loadingSuggestions}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--muted)",
                    cursor: loadingSuggestions ? "default" : "pointer",
                    padding: "2px",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <HugeiconsIcon
                    icon={RefreshIcon}
                    size={12}
                    strokeWidth={1.8}
                    className={loadingSuggestions ? "animate-spin" : ""}
                  />
                </button>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px",
                maxHeight: "120px",
                overflowY: "auto",
                padding: "6px",
                background: "var(--bg)",
                border: "1px solid var(--line-soft)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {loadingSuggestions && suggestions.length === 0 ? (
                <div style={{ padding: "8px", width: "100%", display: "flex", justifyContent: "center" }}>
                  <LatticeLoader status="working" label="Scanning directories" pattern="dots" cellSize={3} gap={2} fontSize={10} showTimer={false} />
                </div>
              ) : suggestions.length === 0 ? (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--faint)", padding: "4px" }}>
                  No directories found
                </span>
              ) : (
                suggestions.map((dir) => {
                  const isCurrentSelected = pathInput.trim() === dir.path;
                  return (
                    <button
                      key={dir.path}
                      type="button"
                      onClick={() => handleSelectSuggestion(dir.path)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "4px 8px",
                        fontSize: "0.72rem",
                        background: isCurrentSelected ? "var(--purple-soft)" : "var(--panel-2)",
                        border: isCurrentSelected
                          ? "1px solid rgba(184, 92, 255, 0.4)"
                          : "1px solid var(--line-soft)",
                        borderRadius: "var(--radius-sm)",
                        color: isCurrentSelected ? "var(--purple)" : "var(--text)",
                        cursor: "pointer",
                        maxWidth: "200px",
                      }}
                      title={dir.path}
                    >
                      <HugeiconsIcon icon={Folder01Icon} size={12} strokeWidth={1.8} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {dir.name}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Options */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingTop: "4px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--text-xs)", color: "var(--text)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={createIfMissing}
                onChange={(e) => setCreateIfMissing(e.target.checked)}
                disabled={submitting}
              />
              <span>Create directory if it does not exist</span>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--text-xs)", color: "var(--text)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={startFresh}
                onChange={(e) => setStartFresh(e.target.checked)}
                disabled={submitting}
              />
              <span>Start with a clean session in the new workspace</span>
            </label>
          </div>

          {/* Actions */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "10px",
              paddingTop: "10px",
              borderTop: "1px solid var(--line)",
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: "6px 14px",
                fontSize: "var(--text-xs)",
                background: "transparent",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-sm)",
                color: "var(--muted)",
                cursor: submitting ? "default" : "pointer",
              }}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={submitting || !pathInput.trim()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 16px",
                fontSize: "var(--text-xs)",
                fontWeight: 600,
                background: "var(--purple)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                color: "#ffffff",
                cursor: submitting || !pathInput.trim() ? "default" : "pointer",
                opacity: submitting || !pathInput.trim() ? 0.6 : 1,
              }}
            >
              {submitting ? (
                <>
                  <HugeiconsIcon icon={RefreshIcon} size={14} strokeWidth={1.8} className="animate-spin" />
                  <span>Opening Workspace...</span>
                </>
              ) : (
                <>
                  <HugeiconsIcon icon={Tick01Icon} size={14} strokeWidth={2} />
                  <span>Add Workspace</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddWorkspaceModal;
