import { Bot, Loader2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { useFeatures } from "./featureStore";
import type { SubagentRecord } from "./featureTypes";
import { FullTranscriptViewer } from "./FullTranscriptViewer";
import { useAgentTranscript } from "./useAgentTranscript";

const STATUS_LABEL: Record<SubagentRecord["status"], string> = {
  running: "running",
  completed: "completed",
  failed: "failed",
  idle: "idle",
  ready: "ready",
};

/** Registry agent id behind a run, when identity resolution found one. */
function agentIdOf(run: SubagentRecord): string | null {
  return run.agentId ?? run.agentIds?.[0] ?? null;
}

function entryCountLabel(count: number): string {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

export function SubagentPanel() {
  const { subagents, agentsPanelOpen } = useFeatures();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const selectedRun = useMemo(
    () => (expandedId ? subagents.find((run) => run.id === expandedId) ?? null : null),
    [expandedId, subagents],
  );
  const selectedAgentId = selectedRun ? agentIdOf(selectedRun) : null;

  // Fetch the transcript only while the agents drawer is open and a registry
  // agent is actually selected. useAgentTranscript aborts/supersedes in-flight
  // requests when the selection or visibility changes.
  const transcriptState = useAgentTranscript(selectedAgentId, agentsPanelOpen);

  // Guard against a frame where the hook still holds a previous agent's data
  // for the new selection.
  const transcript =
    transcriptState.transcript?.agentId === selectedAgentId ? transcriptState.transcript : null;
  const transcriptError =
    transcriptState.error?.agentId === selectedAgentId ? transcriptState.error.message : null;
  const transcriptLoading = !transcript && !transcriptError;

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
          const runAgentId = agentIdOf(run);
          // Prefer the resolved registry display name when identity resolution
          // found a live agent; fall back to the delegating run description.
          const displayName =
            run.agentName && runAgentId ? run.agentName : run.description;
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
                <span className="subagent-run-name" title={run.description}>
                  {displayName}
                </span>
                {/* run.status already carries the live agent status from the
                    registry merge in featureModel.mergeInto. */}
                <span className={"subagent-run-status is-" + run.status}>
                  {STATUS_LABEL[run.status]}
                </span>
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
                  {runAgentId ? (
                    <section className="subagent-run-section subagent-run-transcript-section">
                      <h5>Conversation</h5>
                      {transcriptLoading ? (
                        <div className="subagent-run-state" role="status" aria-busy="true">
                          <Loader2 size={13} className="is-spinning" aria-hidden="true" />
                          <span>Loading agent transcript…</span>
                        </div>
                      ) : transcriptError ? (
                        <div className="subagent-run-state is-error" role="alert">
                          <p className="feature-empty">{transcriptError}</p>
                          <button
                            type="button"
                            className="subagent-run-retry"
                            onClick={transcriptState.reload}
                          >
                            <RefreshCw size={12} aria-hidden="true" />
                            Try again
                          </button>
                        </div>
                      ) : transcript ? (
                        <div className="subagent-run-transcript">
                          <p className="subagent-run-transcript-meta">
                            {[
                              transcript.kind,
                              transcript.status,
                              transcript.hasSessionFile
                                ? "session file available"
                                : "no session file",
                              entryCountLabel(transcript.entries.length),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          <FullTranscriptViewer entries={transcript.entries} />
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                  {!run.prompt && !run.result ? (
                    <section className="subagent-run-section">
                      <h5>Live agent metadata</h5>
                      <p className="feature-empty">
                        {[
                          run.createdAt
                            ? `Created: ${new Date(run.createdAt).toLocaleString()}`
                            : null,
                          run.parentId ? `Parent: ${run.parentId}` : null,
                          run.hasSessionFile === true ? "Session file available" : null,
                          runAgentId ? null : "No live agent linked · transcript unavailable",
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No captured content for this run."}
                      </p>
                    </section>
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
