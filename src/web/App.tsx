import {
  Activity,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  FileText,
  Folder,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings2,
  Terminal,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Slot } from "./plugin-system";

interface SessionHost {
  instanceId?: string;
  pid?: number;
  sessionId?: string;
  sessionName?: string;
  cwd?: string;
  participants?: number;
  model?: unknown;
  connected?: boolean;
  inputRequired?: boolean;
  access?: "view" | "control";
  [key: string]: unknown;
}

interface SessionResponse {
  connected: boolean;
  reason?: string;
  error?: string;
  access?: "view" | "control";
  host?: SessionHost;
}

function token() {
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

function displayModel(model: unknown) {
  if (!model) return "OMP model";
  if (typeof model === "string") return model;
  if (typeof model === "object") {
    const record = model as Record<string, unknown>;
    return String(record.name ?? record.id ?? record.model ?? "OMP model");
  }
  return "OMP model";
}

function workspaceName(path?: string) {
  if (!path) return "workspace";
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? "workspace";
}

function OmpMark() {
  return <div className="omp-mark" aria-label="omp">π</div>;
}

function SessionRow({
  title,
  subtitle,
  time,
  active = false,
}: {
  title: string;
  subtitle: string;
  time: string;
  active?: boolean;
}) {
  return (
    <button className={`session-row${active ? " active" : ""}`}>
      <div className="session-icon">
        <Circle size={13} strokeWidth={1.6} />
      </div>
      <div className="session-copy">
        <div className="session-title-line">
          <strong>{title}</strong>
          <span>{time}</span>
        </div>
        <p>{subtitle}</p>
      </div>
      <MoreHorizontal size={15} className="session-more" />
    </button>
  );
}

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const authToken = useMemo(token, []);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const response = await fetch(`/api/session?token=${encodeURIComponent(authToken)}`);
        const data = (await response.json()) as SessionResponse;
        if (!cancelled) setSession(data);
      } catch (error) {
        if (!cancelled) {
          setSession({
            connected: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authToken]);

  const connected = Boolean(session?.connected);
  const host = session?.host;
  const currentTitle = host?.sessionName || "Current OMP session";
  const currentWorkspace = workspaceName(host?.cwd);
  const currentModel = displayModel(host?.model);
  const currentSubtitle = connected
    ? host?.cwd || "Connected to the running OMP process"
    : session?.error || session?.reason || "Waiting for a collab host";

  return (
    <main className="app-shell">
      <aside className="utility-rail">
        <div className="rail-top">
          <OmpMark />
          <button className="rail-button active" aria-label="Sessions">
            <Terminal size={18} />
          </button>
          <button className="rail-button" aria-label="Subagents">
            <Users size={18} />
          </button>
          <button className="rail-button" aria-label="Workspace files">
            <Folder size={18} />
          </button>
          <button className="rail-button" aria-label="Plugins">
            <Activity size={18} />
          </button>
        </div>
        <button className="rail-button" aria-label="Settings">
          <Settings2 size={18} />
        </button>
      </aside>

      <aside className="session-sidebar">
        <div className="workspace-switcher">
          <span className="section-label">Workspace</span>
          <button className="workspace-button">
            <Folder size={15} />
            <span>{currentWorkspace}</span>
            <ChevronDown size={14} />
          </button>
        </div>

        <div className="session-search">
          <Search size={14} />
          <input placeholder="Search sessions..." aria-label="Search sessions" />
          <kbd>⌘ K</kbd>
        </div>

        <button className="new-session-button">
          <Plus size={15} />
          New Session
        </button>

        <div className="session-list">
          <span className="session-group-label">Today</span>
          <SessionRow
            active
            title={currentTitle}
            subtitle={currentSubtitle}
            time={loading ? "..." : connected ? "Now" : "Offline"}
          />
          <div className="list-placeholder">
            <span>More sessions will appear here once session discovery is wired.</span>
          </div>
        </div>

        <div className="session-sidebar-footer">
          <span className={`connection-dot${connected ? " connected" : ""}`} />
          <span>{connected ? "OMP connected" : "Waiting for OMP"}</span>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{currentWorkspace}</span>
            <ChevronRight size={14} />
            <strong>{currentTitle}</strong>
            <ChevronDown size={14} />
          </div>

          <div className="topbar-actions">
            <button className="model-button">
              <Activity size={14} />
              {currentModel}
              <ChevronDown size={13} />
            </button>
            <button className="icon-button" aria-label="Session settings">
              <Settings2 size={16} />
            </button>
            <button className="icon-button" aria-label="More session actions">
              <MoreHorizontal size={16} />
            </button>
          </div>
        </header>

        <section className="conversation">
          <Slot name="chat.before" />

          <div className="transport-state">\n            <OmpMark />\n            <div className="transport-copy">\n              <span className="transport-kicker">\n                {loading ? "DISCOVERING SESSION" : connected ? "SESSION CONNECTED" : "WAITING FOR OMP"}\n              </span>\n              <h1>\n                {loading\n                  ? "Finding your OMP session..."\n                  : connected\n                    ? currentTitle\n                    : "No active OMP collab session"}\n              </h1>\n              <p>\n                {connected\n                  ? "The browser is attached to this OMP process. Live transcript, tool events, and prompts will populate this workspace through pi-wire."\n                  : currentSubtitle}\n              </p>\n              {connected ? (\n                <div className="transport-details">\n                  <div>\n                    <span>Workspace</span>\n                    <strong>{host?.cwd || currentWorkspace}</strong>\n                  </div>\n                  <div>\n                    <span>Model</span>\n                    <strong>{currentModel}</strong>\n                  </div>\n                  <div>\n                    <span>Access</span>\n                    <strong>{session?.access ?? "control"}</strong>\n                  </div>\n                </div>\n              ) : (\n                <code>/collab</code>\n              )}\n            </div>\n          </div>\n          <Slot name="chat.after" />

          <div className="composer">
            <button className="composer-icon" aria-label="Attach file">
              <Paperclip size={18} />
            </button>
            <textarea
              disabled
              placeholder={connected ? "Message OMP..." : "Connect an OMP session to start chatting"}
            />
            <div className="composer-hint">⌘ ↵ to send</div>
            <button className="send-button" disabled aria-label="Send message">
              <Send size={17} />
            </button>
          </div>
        </section>
      </section>

      <aside className="subagents-panel">
        <div className="subagents-header">
          <div>
            <h2>Subagents</h2>
            <p>Agents working with you on this session.</p>
          </div>
        </div>

        <div className="session-context-card">
          <div>
            <span>Session context</span>
            <strong>{currentTitle}</strong>
            <small>{currentWorkspace} · {currentModel}</small>
          </div>
          <button className="icon-button" aria-label="Copy session context">
            <Copy size={14} />
          </button>
        </div>

        <div className="subagent-empty">
          <Users size={19} />
          <strong>No subagent stream yet</strong>
          <p>
            Running OMP subagents will appear here automatically once the pi-wire client is
            connected.
          </p>
          <span>View transcript · Message · Kill · Revive</span>
        </div>

        <Slot name="agent.panel" />
      </aside>
    </main>
  );
}
