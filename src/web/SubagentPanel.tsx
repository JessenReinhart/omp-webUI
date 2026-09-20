import { Bot, Loader2 } from "lucide-react";
import { useState } from "react";
import { useFeatures } from "./featureStore";
import type { SubagentRecord } from "./featureTypes";

const STATUS_LABEL: Record<SubagentRecord["status"], string> = {
  running: "running",
  completed: "completed",
  failed: "failed",
  idle: "idle",
  ready: "ready",
};

export function SubagentPanel() {
  const { subagents } = useFeatures();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (subagents.length === 0) {
    return (
      <div className="subagent-derived">
        <p className="feature-empty">No delegated subagent runs in this session.</p>
      </div>
    );
  }

  const ordered = [...subagents].sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));

  return (
    <div className="subagent-derived">
      <header className="feature-panel-header">
        <h4>Delegated runs</h4>
        <span className="feature-panel-hint">
          {subagents.length + " run" + (subagents.length === 1 ? "" : "s")}
        </span>
      </header>
      <ul className="subagent-run-list">
        {ordered.map((run) => {
          const expanded = expandedId === run.id;
          return (
            <li className={"subagent-run is-" + run.status} key={run.id}>
              <button
                type="button"
                className="subagent-run-toggle"
                aria-expanded={expanded}
                onClick={() => setExpandedId(expanded ? null : run.id)}
              >
                {run.status === "running" ? (
                  <Loader2 size={13} className="is-spinning" aria-hidden="true" />
                ) : (
                  <Bot size={13} aria-hidden="true" />
                )}
                <span className="subagent-run-name" title={run.description}>{run.description}</span>
                <span className={"subagent-run-status is-" + run.status}>{STATUS_LABEL[run.status]}</span>
              </button>
              {expanded ? (
                <div className="subagent-run-body">
                  {run.prompt ? (
                    <section className="subagent-run-section">
                      <h5>Task</h5>
                      <pre className="transcript-pre subagent-run-pre">{run.prompt}</pre>
                    </section>
                  ) : null}
                  {run.result ? (
                    <section className="subagent-run-section">
                      <h5>Result</h5>
                      <pre className="transcript-pre subagent-run-pre">{run.result}</pre>
                    </section>
                  ) : null}
                  {!run.prompt && !run.result ? (
                    <p className="feature-empty">No captured content for this run.</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default SubagentPanel;
