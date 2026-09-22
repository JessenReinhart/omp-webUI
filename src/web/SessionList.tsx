import {
  AddSquareIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  Folder01Icon,
  FolderAddIcon,
  PreferenceHorizontalIcon,
  Radio01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface SessionSummary {
  id: string;
  title: string;
  cwd: string;
  created: string;
  modified: string;
  messageCount: number;
  fileId: string;
  path?: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  cwd: string;
  isCurrent: boolean;
  sessions: SessionSummary[];
}

interface RawSessionItem {
  id: string;
  title?: string;
  cwd?: string;
  created?: string | number | Date;
  modified?: string | number | Date;
  messageCount?: number;
  fileId: string;
  path?: string;
}

interface RawWorkspaceItem {
  id: string;
  name?: string;
  cwd?: string;
  isCurrent?: boolean;
  sessions?: RawSessionItem[];
}

interface SessionsResponse {
  ok: boolean;
  workspaces?: RawWorkspaceItem[];
  sessions?: RawSessionItem[];
  currentWorkspace?: string;
  error?: string;
}

export interface SessionListProps {
  token: string;
  onSelectSession: (fileId: string, title?: string) => void;
  selectedFileId?: string | null;
  onBackToLive?: () => void;
  liveTitle?: string;
  liveSubtitle?: string;
  liveActive?: boolean;
  connectionState?: "connected" | "waiting";
  onNewSession?: () => void;
  onAddWorkspace?: () => void;
  refreshTrigger?: number;
}

type SortOption = "recent" | "name" | "count";
type FilterOption = "all" | "current";

const LOAD_ERROR_MESSAGE = "Could not load past sessions. Check your connection and try again.";

function toIsoString(value: string | number | Date | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  return value ?? "";
}

/**
 * Compact relative time:
 * < 1m -> 'just now'
 * < 60m -> '${m}min'
 * < 24h -> '${h}h'
 * >= 24h -> '${d}d'
 */
function formatCompactRelativeTime(value: string): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return "just now";

  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function parseSession(raw: RawSessionItem): SessionSummary {
  return {
    id: raw.id,
    title: raw.title || raw.id,
    cwd: raw.cwd || "",
    created: toIsoString(raw.created),
    modified: toIsoString(raw.modified),
    messageCount: raw.messageCount ?? 0,
    fileId: raw.fileId,
    path: raw.path,
  };
}

export function SessionList({
  token,
  onSelectSession,
  selectedFileId,
  onBackToLive,
  liveTitle = "Live session",
  liveSubtitle = "Connected to running OMP process",
  liveActive = true,
  connectionState = "connected",
  onNewSession,
  onAddWorkspace,
  refreshTrigger,
}: SessionListProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // UI state
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [filterBy, setFilterBy] = useState<FilterOption>("all");

  // Expanded/collapsed workspaces (workspaceId -> boolean: true = collapsed)
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Record<string, boolean>>({});

  // Workspaces with "show more" expanded (workspaceId -> boolean: true = expanded beyond 5)
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});
  const [creatingNewSession, setCreatingNewSession] = useState(false);

  const mountedRef = useRef(true);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Close sort menu when clicking outside
  useEffect(() => {
    if (!sortMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [sortMenuOpen]);

  // Focus search input when toggled open
  useEffect(() => {
    if (searchActive) {
      searchInputRef.current?.focus();
    } else {
      setSearchQuery("");
    }
  }, [searchActive]);

  const loadSessions = useCallback(
    async (silent = false) => {
      if (!silent && mountedRef.current) setLoading(true);
      try {
        const response = await fetch(`/api/sessions?token=${encodeURIComponent(token)}`);
        const payload = (await response.json()) as SessionsResponse;

        if (!response.ok || !payload.ok) {
          throw new Error("sessions request failed");
        }

        if (!mountedRef.current) return;

        if (Array.isArray(payload.workspaces) && payload.workspaces.length > 0) {
          const parsedWorkspaces: WorkspaceSummary[] = payload.workspaces.map((ws) => ({
            id: ws.id,
            name: ws.name || ws.id,
            cwd: ws.cwd || "",
            isCurrent: Boolean(ws.isCurrent),
            sessions: Array.isArray(ws.sessions) ? ws.sessions.map(parseSession) : [],
          }));
          setWorkspaces(parsedWorkspaces);
        } else if (Array.isArray(payload.sessions)) {
          const fallbackWorkspace: WorkspaceSummary = {
            id: "default",
            name: payload.currentWorkspace || "Current Workspace",
            cwd: "",
            isCurrent: true,
            sessions: payload.sessions.map(parseSession),
          };
          setWorkspaces([fallbackWorkspace]);
        } else {
          setWorkspaces([]);
        }

        setError(false);
      } catch {
        if (mountedRef.current) setError(true);
      } finally {
        if (mountedRef.current && !silent) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void loadSessions(false);
    const poller = window.setInterval(() => void loadSessions(true), 5000);
    return () => window.clearInterval(poller);
  }, [loadSessions]);

  useEffect(() => {
    if (refreshTrigger !== undefined) {
      void loadSessions(true);
    }
  }, [loadSessions, refreshTrigger]);

  const toggleWorkspaceCollapse = (wsId: string) => {
    setCollapsedWorkspaces((prev) => ({
      ...prev,
      [wsId]: !prev[wsId],
    }));
  };

  const toggleShowMore = (wsId: string) => {
    setExpandedSessions((prev) => ({
      ...prev,
      [wsId]: !prev[wsId],
    }));
  };

  // Filter and sort workspaces and sessions
  const processedWorkspaces = useMemo(() => {
    let wsList = workspaces;

    // Filter by current vs all
    if (filterBy === "current") {
      wsList = wsList.filter((ws) => ws.isCurrent);
    }

    const query = searchQuery.trim().toLowerCase();

    // Filter and map sessions inside each workspace
    const filtered = wsList
      .map((ws) => {
        const wsNameMatches = query.length > 0 && ws.name.toLowerCase().includes(query);

        let sessions = ws.sessions.filter((session) => {
          if (!query) return true;
          if (wsNameMatches) return true;
          return session.title.toLowerCase().includes(query);
        });

        // Sort sessions inside workspace
        sessions = [...sessions].sort((a, b) => {
          if (sortBy === "recent") {
            const timeA = a.modified ? new Date(a.modified).getTime() : 0;
            const timeB = b.modified ? new Date(b.modified).getTime() : 0;
            return timeB - timeA;
          }
          if (sortBy === "name") {
            return a.title.localeCompare(b.title);
          }
          if (sortBy === "count") {
            return b.messageCount - a.messageCount;
          }
          return 0;
        });

        // For the current active workspace, ensure the active live session is shown at top
        if (ws.isCurrent) {
          const liveTitleDisplay = liveTitle || "New session";
          const alreadyHasLive = sessions.some((s) => s.fileId === "live" || s.title === liveTitleDisplay);
          if (!alreadyHasLive) {
            const liveEntry: SessionSummary = {
              id: "live",
              title: liveTitleDisplay,
              cwd: ws.cwd,
              created: new Date().toISOString(),
              modified: new Date().toISOString(),
              messageCount: 0,
              fileId: "live",
            };
            sessions = [liveEntry, ...sessions];
          }
        }

        return {
          ...ws,
          sessions,
        };
      })
      .filter((ws) => {
        if (!query) return true;
        // Keep workspace if it matches or has matching sessions
        return ws.name.toLowerCase().includes(query) || ws.sessions.length > 0;
      });

    // Sort workspace list itself
    return [...filtered].sort((a, b) => {
      // Keep current workspace at top
      if (a.isCurrent && !b.isCurrent) return -1;
      if (!a.isCurrent && b.isCurrent) return 1;

      if (sortBy === "name") {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "count") {
        return b.sessions.length - a.sessions.length;
      }
      // "recent": most recently active workspace first
      const getLatestTime = (ws: WorkspaceSummary) =>
        ws.sessions.reduce((max, s) => {
          const t = s.modified ? new Date(s.modified).getTime() : 0;
          return !Number.isNaN(t) && t > max ? t : max;
        }, 0);
      return getLatestTime(b) - getLatestTime(a);
    });
  }, [workspaces, filterBy, searchQuery, sortBy]);

  const totalSessionsCount = useMemo(() => {
    return workspaces.reduce((sum, ws) => sum + ws.sessions.length, 0);
  }, [workspaces]);

  const showLoading = loading && workspaces.length === 0 && !error;
  const showEmpty = !loading && !error && processedWorkspaces.every((ws) => ws.sessions.length === 0);

  return (
    <div className="session-list-wrapper">
      {/* Workspaces Header */}
      <div className="workspaces-header">
        <div className="workspaces-header-title">
          <span>Workspaces</span>
        </div>
        <div className="workspaces-actions workspaces-header-actions" ref={sortMenuRef}>
          <button
            type="button"
            className={`workspaces-action-btn ws-action-btn${searchActive ? " is-active" : ""}`}
            onClick={() => setSearchActive((prev) => !prev)}
            aria-label="Search workspaces & sessions"
            title="Search"
          >
            <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={1.8} />
          </button>

          <button
            type="button"
            className={`workspaces-action-btn ws-action-btn${sortMenuOpen ? " is-active" : ""}`}
            onClick={() => setSortMenuOpen((prev) => !prev)}
            aria-label="Filter and sort"
            title="Filter and sort"
          >
            <HugeiconsIcon icon={PreferenceHorizontalIcon} size={15} strokeWidth={1.8} />
          </button>

          <button
            type="button"
            className={`workspaces-action-btn ws-action-btn${creatingNewSession ? " is-loading" : ""}`}
            onClick={async () => {
              if (creatingNewSession) return;
              setCreatingNewSession(true);
              try {
                if (onNewSession) {
                  await onNewSession();
                }
                await loadSessions(true);
              } finally {
                setCreatingNewSession(false);
              }
            }}
            disabled={creatingNewSession}
            aria-label="New session"
            title={creatingNewSession ? "Creating new session..." : "New session"}
          >
            <HugeiconsIcon
              icon={AddSquareIcon}
              size={15}
              strokeWidth={1.8}
              className={creatingNewSession ? "animate-spin" : ""}
            />
          </button>

          {onAddWorkspace ? (
            <button
              type="button"
              className="workspaces-action-btn ws-action-btn ws-action-btn-accent"
              onClick={onAddWorkspace}
              aria-label="Add workspace"
              title="Add new workspace"
            >
              <HugeiconsIcon icon={FolderAddIcon} size={15} strokeWidth={1.8} />
            </button>
          ) : null}

          {/* Sort / Filter Dropdown Menu */}
          {sortMenuOpen ? (
            <div className="workspaces-sort-popover ws-dropdown-menu" role="menu">
              <div className="ws-dropdown-section">
                <span className="ws-dropdown-label">Sort by</span>
                <button
                  type="button"
                  className={`ws-dropdown-item${sortBy === "recent" ? " is-selected" : ""}`}
                  onClick={() => {
                    setSortBy("recent");
                    setSortMenuOpen(false);
                  }}
                >
                  <span>Recent</span>
                  {sortBy === "recent" ? (
                    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={13} strokeWidth={2} />
                  ) : null}
                </button>
                <button
                  type="button"
                  className={`ws-dropdown-item${sortBy === "name" ? " is-selected" : ""}`}
                  onClick={() => {
                    setSortBy("name");
                    setSortMenuOpen(false);
                  }}
                >
                  <span>Name (A-Z)</span>
                  {sortBy === "name" ? (
                    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={13} strokeWidth={2} />
                  ) : null}
                </button>
                <button
                  type="button"
                  className={`ws-dropdown-item${sortBy === "count" ? " is-selected" : ""}`}
                  onClick={() => {
                    setSortBy("count");
                    setSortMenuOpen(false);
                  }}
                >
                  <span>Message Count</span>
                  {sortBy === "count" ? (
                    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={13} strokeWidth={2} />
                  ) : null}
                </button>
              </div>

              <div className="ws-dropdown-divider" />

              <div className="ws-dropdown-section">
                <span className="ws-dropdown-label">Filter</span>
                <button
                  type="button"
                  className={`ws-dropdown-item${filterBy === "all" ? " is-selected" : ""}`}
                  onClick={() => {
                    setFilterBy("all");
                    setSortMenuOpen(false);
                  }}
                >
                  <span>All workspaces</span>
                  {filterBy === "all" ? (
                    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={13} strokeWidth={2} />
                  ) : null}
                </button>
                <button
                  type="button"
                  className={`ws-dropdown-item${filterBy === "current" ? " is-selected" : ""}`}
                  onClick={() => {
                    setFilterBy("current");
                    setSortMenuOpen(false);
                  }}
                >
                  <span>Current workspace</span>
                  {filterBy === "current" ? (
                    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={13} strokeWidth={2} />
                  ) : null}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Inline Search Bar */}
      {searchActive ? (
        <div className="workspaces-search-box ws-search-bar">
          <HugeiconsIcon icon={Search01Icon} size={14} strokeWidth={1.8} className="ws-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="workspaces-search-input ws-search-input"
            placeholder="Search workspaces & sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery ? (
            <button
              type="button"
              className="ws-search-clear"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Return to Live Session Button (when viewing a past session) */}
      {selectedFileId && onBackToLive ? (
        <div style={{ padding: "0 4px 6px 4px" }}>
          <button
            className="session-row session-list-live-row"
            type="button"
            onClick={onBackToLive}
            style={{ width: "100%", justifyContent: "flex-start", gap: "8px" }}
          >
            <span className="session-icon" aria-hidden="true">
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.8} />
            </span>
            <span className="session-copy">
              <span className="session-title-line">
                <strong>Return to active session</strong>
              </span>
            </span>
          </button>
        </div>
      ) : null}

      {/* Workspaces & Sessions List */}
      <section className="session-list" aria-label="Workspaces and sessions" aria-busy={loading}>
        {showLoading ? (
          <div className="session-list-status" role="status">
            <span className="session-list-spinner" aria-hidden="true" />
            <p>Loading workspaces & sessions…</p>
          </div>
        ) : null}

        {error && workspaces.length === 0 ? (
          <div className="session-list-error" role="alert">
            <p>{LOAD_ERROR_MESSAGE}</p>
            <button className="session-list-retry" type="button" onClick={() => void loadSessions(false)}>
              Try again
            </button>
          </div>
        ) : null}

        {showEmpty ? (
          <div className="session-list-empty">
            <p className="session-list-empty-title">
              {searchQuery ? "No matching sessions" : "No sessions found"}
            </p>
            <p className="session-list-empty-copy">
              {searchQuery ? "Try a different search query." : "Finished sessions will appear here."}
            </p>
          </div>
        ) : null}

        <div className="workspaces-container ws-groups-container">
          {processedWorkspaces.map((ws) => {
            // Default non-current workspaces to collapsed if not explicitly toggled in collapsedWorkspaces
            const hasUserPreference = Object.prototype.hasOwnProperty.call(collapsedWorkspaces, ws.id);
            const isCollapsed = hasUserPreference ? Boolean(collapsedWorkspaces[ws.id]) : !ws.isCurrent;
            const isExpanded = Boolean(expandedSessions[ws.id]);
            const hasMoreThan5 = ws.sessions.length > 5;
            const visibleSessions = !isExpanded && hasMoreThan5 ? ws.sessions.slice(0, 5) : ws.sessions;
            const remainingCount = ws.sessions.length - 5;

            return (
              <div className="workspace-group ws-group" key={ws.id}>
                {/* Workspace Header Row */}
                <button
                  type="button"
                  className={`workspace-group-header ws-header-row${isCollapsed ? " is-collapsed" : ""}`}
                  onClick={() =>
                    setCollapsedWorkspaces((prev) => ({
                      ...prev,
                      [ws.id]: !isCollapsed,
                    }))
                  }
                  aria-expanded={!isCollapsed}
                  title={isCollapsed ? `Expand workspace ${ws.name}` : `Collapse workspace ${ws.name}`}
                >
                  <span className="ws-header-arrow" aria-hidden="true">
                    <HugeiconsIcon
                      icon={isCollapsed ? ArrowRight01Icon : ArrowDown01Icon}
                      size={12}
                      strokeWidth={2}
                    />
                  </span>
                  <span className="ws-folder-icon" aria-hidden="true">
                    <HugeiconsIcon icon={Folder01Icon} size={15} strokeWidth={1.8} />
                  </span>
                  <span className="workspace-group-title ws-header-name" title={ws.name}>
                    {ws.name}
                  </span>
                  <span className="ws-header-count">{ws.sessions.length}</span>
                </button>

                {/* Workspace Sessions (when not collapsed) */}
                {!isCollapsed && (
                  <div className="workspace-session-list ws-sessions-list" role="list">
                    {ws.sessions.length === 0 ? (
                      <div className="ws-empty-sessions">No sessions</div>
                    ) : (
                      visibleSessions.map((session) => {
                        // Only mark as selected if an explicit past session is selected.
                        // A past session must never be automatically selected by default.
                        const isSelected = selectedFileId
                          ? selectedFileId === session.fileId
                          : false;
                        const timeStr = formatCompactRelativeTime(session.modified);

                        return (
                          <button
                            key={session.fileId}
                            type="button"
                            className={`workspace-session-item ws-session-row${isSelected ? " is-selected active" : ""}`}
                            onClick={() => {
                              if (session.fileId === "live") {
                                onBackToLive?.();
                              } else {
                                onSelectSession(session.fileId, session.title);
                              }
                            }}
                            aria-current={isSelected ? "true" : undefined}
                            title={session.title}
                          >
                            <span className="workspace-session-title ws-session-title" title={session.title}>
                              {session.title}
                            </span>
                            {timeStr ? <span className="workspace-session-time ws-session-time">{timeStr}</span> : null}
                          </button>
                        );
                      })
                    )}

                    {/* Show N more sessions button */}
                    {hasMoreThan5 && !isExpanded ? (
                      <button
                        type="button"
                        className="workspace-show-more-btn ws-show-more-btn"
                        onClick={() => toggleShowMore(ws.id)}
                      >
                        Show {remainingCount} more session{remainingCount === 1 ? "" : "s"}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && workspaces.length > 0 ? (
          <div className="session-list-stale" role="status">
            <p>List may be out of date.</p>
            <button
              className="session-list-retry session-list-retry-compact"
              type="button"
              onClick={() => void loadSessions(true)}
            >
              Retry
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
