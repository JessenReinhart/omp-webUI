import { Circle, Terminal, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CollabComposer } from "./CollabComposer";
import { CollabControls } from "./CollabControls";
import { CollabTranscript } from "./CollabTranscript";
import { Slot } from "./plugin-system";
import { useCollabSession } from "./useCollabSession";

interface SessionHost {
  sessionName?: string;
  cwd?: string;
  model?: unknown;
}

interface SessionResponse {
  connected: boolean;
  reason?: string;
  error?: string;
  host?: SessionHost;
  collabUrl?: string;
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

function SessionRow({ title, subtitle, time }: { title: string; subtitle: string; time: string }) {
  return (
    <div className="session-row active">
      <div className="session-icon"><Circle size={13} strokeWidth={1.6} /></div>
      <div className="session-copy">
        <div className="session-title-line"><strong>{title}</strong><span>{time}</span></div>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [collabUrl, setCollabUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const authToken = useMemo(() => new URLSearchParams(window.location.search).get("token") ?? "", []);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    async function refresh() {
      controller?.abort();
      const ac = new AbortController();
      controller = ac;
      try {
        const response = await fetch(`/api/session?token=${encodeURIComponent(authToken)}`, { signal: ac.signal });
        if (!response.ok) throw new Error(`Session request failed (${response.status})`);
        const data = (await response.json()) as SessionResponse;
        if (active) {
          const { collabUrl: secret, ...rest } = data;
          setSession(rest);
          setCollabUrl(data.connected && secret ? secret : null);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (active) {
          setSession({ connected: false, error: error instanceof Error ? error.message : String(error) });
          setCollabUrl(null);
        }
      } finally {
        if (active && controller === ac) setLoading(false);
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); };
  }, [authToken]);

  const connected = Boolean(session?.connected);
  const collab = useCollabSession(collabUrl);
  const host = session?.host;
  const currentTitle = host?.sessionName || "Current OMP session";
  const currentWorkspace = workspaceName(host?.cwd);
  const currentModel = displayModel(host?.model);
  const currentSubtitle = connected
    ? host?.cwd || "Connected to running OMP process"
    : session?.error || session?.reason || "Waiting for collab host";
  const hasAgents = collab.agents.length > 0;
  const isStreaming = collab.state?.isStreaming === true;
  const queuedMessages = collab.state?.queuedMessageCount ?? 0;

  return (
    <div className="app-shell">
      <aside className="utility-rail">
        <div className="rail-top"><OmpMark /><div className="rail-button active" aria-label="Collaboration session"><Terminal size={18} /></div></div>
      </aside>

      <aside className="session-sidebar">
        <div className="workspace-switcher"><span className="section-label">Live workspace</span><strong>{currentWorkspace}</strong></div>
        <div className="session-list">
          <span className="session-group-label">Current session</span>
          <SessionRow title={currentTitle} subtitle={currentSubtitle} time={loading ? "…" : connected ? "Now" : "Offline"} />
        </div>
        {connected && isStreaming && <div className="subagent-note">Streaming · {queuedMessages} queued message{queuedMessages === 1 ? "" : "s"}</div>}
        <div className="session-sidebar-footer"><span className={`connection-dot${connected ? " connected" : ""}`} /><span>{connected ? "OMP connected" : "Waiting for OMP"}</span></div>
      </aside>

      <main className="main-column">
        <header className="topbar"><div className="breadcrumbs"><span>{currentWorkspace}</span><strong>{currentTitle}</strong></div><span className="model-button">{currentModel}</span></header>
        <section className="conversation">
          <Slot name="chat.before" />
          {connected ? <><CollabControls status={collab.status} readOnly={collab.readOnly} error={collab.error} onReconnect={collab.reconnect} onDisconnect={collab.disconnect} /><CollabTranscript entries={collab.entries} events={collab.events} status={collab.status} /></> : <div className="transport-state"><OmpMark /><div className="transport-copy"><span className="transport-kicker">{loading ? "DISCOVERING SESSION" : "WAITING FOR OMP"}</span><h1>{loading ? "Finding your OMP session..." : "No active OMP session"}</h1><p>{loading ? currentSubtitle : <>Run <code>/collab</code> in OMP to publish your session.</>}</p></div></div>}
          <Slot name="chat.after" />
          <CollabComposer disabled={!connected || !collab.ready || collab.readOnly || collab.status !== "live"} placeholder={connected ? "Message OMP..." : "Connect an OMP session to start chatting"} isStreaming={isStreaming} onSend={collab.sendPrompt} onAbort={collab.sendAbort} />
        </section>
      </main>

      <aside className="subagents-panel">
        <div className="subagents-header"><div><h2>Agents</h2><p>{hasAgents ? `${collab.agents.length} active agent${collab.agents.length === 1 ? "" : "s"}` : "No active agents"}</p></div></div>
        {hasAgents ? <div className="agents-list">{collab.agents.map((agent) => <div key={agent.id} className="agent-card"><div className="agent-main"><div className="agent-heading"><strong>{agent.displayName}</strong>{agent.kind === "sub" && <span className="agent-parent">subagent</span>}</div><div className={`agent-status${agent.status === "running" ? " live" : ""}`}><i aria-hidden="true" />{agent.status}</div></div><div className="agent-meta">{agent.lastActivity && <small>Last activity {new Date(agent.lastActivity).toLocaleTimeString()}</small>}{agent.hasSessionFile && <small>Session file available</small>}</div></div>)}</div> : <div className="subagent-empty"><Users size={19} /><strong>No agents yet</strong><p>OMP subagents appear here while they run.</p></div>}
        <Slot name="agent.panel" />
      </aside>
    </div>
  );
}
