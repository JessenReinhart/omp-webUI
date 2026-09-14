import {
  Activity,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Copy,
  FileText,
  FlaskConical,
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
import { useEffect, useMemo, useState, type ReactNode } from "react";
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

const sampleSessions = [
  { title: "Widget system cleanup", subtitle: "Refactor widget architecture", time: "9:12 AM" },
  { title: "Collab reconnect", subtitle: "Handle websocket timeouts", time: "8:41 AM" },
];

const olderSessions = [
  { title: "Docs: plugin runtime", subtitle: "Update subagent docs", time: "Mar 2" },
  { title: "Test framework setup", subtitle: "Add e2e test harness", time: "Mar 2" },
  { title: "Improve error handling", subtitle: "Better error messages", time: "Mar 1" },
];

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

function AgentCard({
  icon,
  name,
  status,
  description,
  detail,
  active,
}: {
  icon: ReactNode;
  name: string;
  status: string;
  description: string;
  detail?: string;
  active?: boolean;
}) {
  return (
    <article className="agent-card">
      <div className="agent-icon">{icon}</div>
      <div className="agent-main">
        <div className="agent-heading">
          <strong>{name}</strong>
          <span className={`agent-status${active ? " live" : ""}`}>
            <i />
            {status}
          </span>
        </div>
        <p>{description}</p>
        {detail ? <code>{detail}</code> : null}
        <div className="agent-actions">
          <button>View</button>
          <button>Message</button>
          <button className="icon-button" aria-label={`More actions for ${name}`}>
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
    </article>
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
          {sampleSessions.map((item) => (
            <SessionRow key={item.title} {...item} />
          ))}

          <span className="session-group-label">Earlier</span>
          {olderSessions.map((item) => (
            <SessionRow key={item.title} {...item} />
          ))}
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

          {!connected ? (
            <div className="connection-empty">
              <OmpMark />
              <h1>{loading ? "Finding your OMP session..." : "No active OMP collab session"}</h1>
              <p>{currentSubtitle}</p>
              <code>/collab</code>
            </div>
          ) : (
            <div className="conversation-stream">
              <div className="message user-message">
                <div className="avatar">U</div>
                <div className="message-body">
                  <div className="message-meta">
                    <strong>You</strong>
                    <span>10:24 AM</span>
                  </div>
                  <div className="user-bubble">
                    Build the browser workspace around the running OMP session. Keep the UI quiet,
                    familiar, and focused on the conversation.
                  </div>
                </div>
              </div>

              <div className="message assistant-message">
                <OmpMark />
                <div className="message-body">
                  <div className="message-meta">
                    <strong>OMP</strong>
                    <span>10:24 AM</span>
                  </div>
                  <p>
                    I’ll use the current OMP session as the source of truth, with sessions on the
                    left and live subagents on the right.
                  </p>

                  <button className="thinking-row">
                    <ChevronRight size={15} />
                    <strong>Thinking</strong>
                    <span>Inspecting the session and workspace state...</span>
                    <small>6.8s</small>
                  </button>

                  <p>The workspace shell is ready.</p>

                  <div className="workspace-summary">
                    <div>
                      <span className="summary-label">Workspace</span>
                      <strong>{currentTitle}</strong>
                      <code>{host?.cwd || "~/project"}</code>
                    </div>
                    <div className="summary-model">
                      <span className="summary-label">Model</span>
                      <strong>{currentModel}</strong>
                    </div>
                    <span className="ready-indicator">Ready</span>
                  </div>

                  <div className="activity-list">
                    <button>
                      <span className="activity-icon"><FileText size={14} /></span>
                      <span>Created</span>
                      <code>WorkspaceWidget.tsx</code>
                      <small>+124 lines</small>
                      <ChevronRight size={14} />
                    </button>
                    <button>
                      <span className="activity-icon"><Terminal size={14} /></span>
                      <span>Ran</span>
                      <code>npm run dev</code>
                      <small className="success-copy">Development server started</small>
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <Slot name="chat.after" />

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
          <button className="add-agent-button">
            <Plus size={14} />
            Add
          </button>
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

        <div className="agent-section">
          <div className="agent-section-title">
            <span>Active</span>
            <small>2</small>
          </div>
          <AgentCard
            active
            icon={<Code2 size={18} />}
            name="Code"
            status="Working"
            description="Implementing component"
            detail="Edit · WorkspaceWidget.tsx"
          />
          <AgentCard
            active
            icon={<Activity size={18} />}
            name="Architect"
            status="Thinking"
            description="Reviewing component structure"
          />
        </div>

        <div className="agent-section muted-agents">
          <div className="agent-section-title">
            <span>Available</span>
            <small>3</small>
          </div>
          <AgentCard
            icon={<FileText size={18} />}
            name="Docs"
            status="Idle"
            description="Ready when needed"
          />
          <AgentCard
            icon={<FlaskConical size={18} />}
            name="Test"
            status="Idle"
            description="Write and run tests"
          />
          <AgentCard
            icon={<Terminal size={18} />}
            name="Deploy"
            status="Idle"
            description="Build and deployment"
          />
        </div>

        <div className="subagent-note">
          Real subagents will populate this panel from OMP’s <code>agents</code> and <code>bus</code>{" "}
          frames once the pi-wire transport lands.
        </div>

        <Slot name="agent.panel" />
      </aside>
    </main>
  );
}
