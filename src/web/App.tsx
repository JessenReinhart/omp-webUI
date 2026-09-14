import { Bot, Boxes, CircleDot, PlugZap, TerminalSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Slot } from "./plugin-system";

interface SessionResponse {
  connected: boolean;
  reason?: string;
  error?: string;
  access?: "view" | "control";
  host?: {
    pid?: number;
    sessionName?: string;
    cwd?: string;
    participants?: number;
    model?: unknown;
    [key: string]: unknown;
  };
}

function token() {
  return new URLSearchParams(window.location.search).get("token") ?? "";
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

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">π</div>
          <div>
            <strong>omp-webUI</strong>
            <span>local workspace</span>
          </div>
        </div>

        <Slot name="sidebar.top" />

        <nav>
          <button className="nav-item active"><Bot size={16} /> Session</button>
          <button className="nav-item"><Boxes size={16} /> Agents</button>
          <button className="nav-item"><TerminalSquare size={16} /> Tools</button>
          <button className="nav-item"><PlugZap size={16} /> Plugins</button>
        </nav>

        <div className="sidebar-spacer" />
        <Slot name="sidebar.bottom" />
        <div className="status-row">
          <CircleDot size={14} />
          {loading ? "discovering OMP…" : session?.connected ? "OMP discovered" : "waiting for collab"}
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">CURRENT SESSION</span>
            <h1>{session?.host?.sessionName || "OMP session"}</h1>
          </div>
          <Slot name="session.toolbar" />
        </header>

        <div className="content-grid">
          <section className="chat-panel">
            <Slot name="chat.before" />
            <div className="empty-state">
              <div className="orb">π</div>
              <h2>{session?.connected ? "Found the running OMP session." : "Waiting for OMP collab."}</h2>
              <p>
                {session?.connected
                  ? "Bootstrap milestone complete: the plugin can identify this exact OMP process and obtain its live collab endpoint. The next step is binding pi-wire directly into this workspace."
                  : session?.error || session?.reason || "Run /collab in OMP, or enable collab.autoStart=control."}
              </p>
            </div>
            <Slot name="chat.after" />
            <div className="composer">
              <textarea disabled placeholder="Chat transport lands in the next slice…" />
              <button disabled>Send</button>
            </div>
          </section>

          <aside className="inspector">
            <div className="panel-title">Session</div>
            <dl>
              <div><dt>Status</dt><dd>{session?.connected ? "Ready" : "Offline"}</dd></div>
              <div><dt>Access</dt><dd>{session?.access ?? "—"}</dd></div>
              <div><dt>PID</dt><dd>{session?.host?.pid ?? "—"}</dd></div>
              <div><dt>Guests</dt><dd>{session?.host?.participants ?? "—"}</dd></div>
              <div><dt>Workspace</dt><dd className="truncate">{session?.host?.cwd ?? "—"}</dd></div>
            </dl>
            <Slot name="agent.panel" fallback={<div className="panel-placeholder">Agent Hub will live here.</div>} />
          </aside>
        </div>

        <footer>
          <span>OMP owns execution. omp-webUI owns interaction.</span>
          <Slot name="statusBar" />
        </footer>
      </section>
    </main>
  );
}
