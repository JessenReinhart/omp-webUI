import {
  Clock01Icon,
  Folder01Icon,
  GitBranchIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { memo } from "react";
import { SessionList } from "./SessionList";
import { Slot } from "./plugin-system";
import { WorkspaceChanges } from "./WorkspaceChanges";
import { WorkspaceExplorer } from "./WorkspaceExplorer";
import type { SidebarHandleProps } from "./useSidebar";

export interface SidebarProps {
  workspaceName: string;
  workspacePath?: string;
  authToken: string;
  activeTab: "sessions" | "files" | "changes";
  onTabChange: (tab: "sessions" | "files" | "changes") => void;
  changesCount: number;
  mobileOpen: boolean;
  onMobileClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  handleProps: SidebarHandleProps;
  pastSessionId: string | null;
  currentTitle: string;
  currentSubtitle: string;
  connected: boolean;
  workspaceRefreshNonce: number;
  onSelectSession: (fileId: string, title?: string) => void;
  onBackToLive: (keepSidebarOpen?: unknown) => void;
  onNewSession: () => void;
  onAddWorkspace: () => void;
  onSelectFile: (path: string) => void;
  onAttachFile: (attachment: { path: string; name: string; kind: "file" | "image" }) => void;
  onSelectDiff: (path: string, staged?: boolean) => void;
  onPromptReview?: (files: string[]) => void;
  onChangeCount: (count: number) => void;
}

export function OmpMark() {
  return (
    <span className="omp-mark" aria-hidden="true">
      π
    </span>
  );
}

export const Sidebar = memo(function Sidebar({
  workspaceName,
  workspacePath,
  authToken,
  activeTab,
  onTabChange,
  changesCount,
  mobileOpen,
  onMobileClose,
  collapsed,
  onToggleCollapse,
  handleProps,
  pastSessionId,
  currentTitle,
  currentSubtitle,
  connected,
  workspaceRefreshNonce,
  onSelectSession,
  onBackToLive,
  onNewSession,
  onAddWorkspace,
  onSelectFile,
  onAttachFile,
  onSelectDiff,
  onPromptReview,
  onChangeCount,
}: SidebarProps) {
  return (
    <>
      <div
        className="sidebar-scrim"
        aria-hidden="true"
        onClick={onMobileClose}
      />

      <aside
        className={`session-sidebar${collapsed ? " is-collapsed" : ""}`}
        aria-label="Session navigation"
        aria-hidden={collapsed && !mobileOpen}
      >
        <div className="sidebar-heading">
          <div className="sidebar-heading-start">
            <OmpMark />
            <div className="sidebar-heading-copy">
              <span className="sidebar-heading-label">Workspace</span>
              <strong
                className="sidebar-heading-title"
                title={workspacePath || workspaceName}
              >
                {workspaceName}
              </strong>
            </div>
          </div>

          <div className="sidebar-heading-actions">
            <button
              className="icon-button sidebar-collapse-btn"
              type="button"
              onClick={onToggleCollapse}
              title={collapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <PanelLeftOpen size={16} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={16} aria-hidden="true" />
              )}
            </button>
            <button
              className="icon-button sidebar-close"
              type="button"
              onClick={onMobileClose}
              aria-label="Close session navigation"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="sidebar-tabs" role="tablist" aria-label="Sidebar navigation views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "sessions"}
            className={`sidebar-tab${activeTab === "sessions" ? " is-active" : ""}`}
            onClick={() => onTabChange("sessions")}
            title="Sessions"
          >
            <HugeiconsIcon icon={Clock01Icon} size={14} strokeWidth={1.8} aria-hidden="true" />
            <span className="sidebar-tab-text">Sessions</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "files"}
            className={`sidebar-tab${activeTab === "files" ? " is-active" : ""}`}
            onClick={() => onTabChange("files")}
            title="Files"
          >
            <HugeiconsIcon icon={Folder01Icon} size={14} strokeWidth={1.8} aria-hidden="true" />
            <span className="sidebar-tab-text">Files</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "changes"}
            className={`sidebar-tab${activeTab === "changes" ? " is-active" : ""}`}
            onClick={() => onTabChange("changes")}
            title={changesCount > 0 ? `Changes (${changesCount})` : "Changes"}
          >
            <HugeiconsIcon icon={GitBranchIcon} size={14} strokeWidth={1.8} aria-hidden="true" />
            <span className="sidebar-tab-text">Changes</span>
            {changesCount > 0 ? <span className="sidebar-tab-badge">{changesCount}</span> : null}
          </button>
        </div>

        <div
          className="sidebar-tab-content sidebar-tab-sessions"
          style={{
            display: activeTab === "sessions" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            minWidth: 0,
          }}
        >
          <Slot name="sidebar.top" />
          <nav className="session-nav" aria-label="Current session">
            <SessionList
              token={authToken}
              onSelectSession={onSelectSession}
              selectedFileId={pastSessionId}
              onBackToLive={onBackToLive}
              liveTitle={currentTitle}
              liveSubtitle={currentSubtitle}
              liveActive={!pastSessionId}
              connectionState={connected ? "connected" : "waiting"}
              onNewSession={onNewSession}
              onAddWorkspace={onAddWorkspace}
              refreshTrigger={workspaceRefreshNonce}
            />
          </nav>
          <Slot name="sidebar.bottom" />
        </div>

        <div
          className="sidebar-tab-content sidebar-tab-files"
          style={{
            display: activeTab === "files" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            padding: "10px 12px",
          }}
        >
          <WorkspaceExplorer
            token={authToken}
            onSelectFile={onSelectFile}
            onAttachFile={onAttachFile}
            refreshTrigger={workspaceRefreshNonce}
          />
        </div>

        <div
          className="sidebar-tab-content sidebar-tab-changes"
          style={{
            display: activeTab === "changes" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            padding: "10px 12px",
          }}
        >
          <WorkspaceChanges
            token={authToken}
            onSelectDiff={onSelectDiff}
            onAttachFile={onAttachFile}
            onPromptReview={onPromptReview}
            onChangeCount={onChangeCount}
            refreshTrigger={workspaceRefreshNonce}
          />
        </div>
      </aside>

      {!collapsed && <div className="sidebar-resize-handle" {...handleProps} />}
    </>
  );
});

export default Sidebar;
