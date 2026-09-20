import { Lightbulb, ShieldAlert, ShieldX } from "lucide-react";
import { useFeatures } from "./featureStore";
import type { AdvisorNote } from "./featureTypes";

function severityIcon(severity: AdvisorNote["severity"]) {
  if (severity === "blocker") return ShieldX;
  if (severity === "concern") return ShieldAlert;
  return Lightbulb;
}

export function AdvisorSidebar() {
  const { advisorNotes } = useFeatures();

  if (advisorNotes.length === 0) {
    // Stay invisible until the advisor actually has something to say.
    return null;
  }

  const latest = advisorNotes.slice(-8).reverse();

  return (
    <section className="feature-panel advisor-panel" aria-label="Advisor notes">
      <header className="feature-panel-header">
        <h3>Advisor</h3>
        <span className="feature-panel-hint">
          {advisorNotes.length + " note" + (advisorNotes.length === 1 ? "" : "s")}
        </span>
      </header>
      <ul className="advisor-note-list">
        {latest.map((note) => {
          const Icon = severityIcon(note.severity);
          const severity = note.severity ?? "info";
          return (
            <li className={"advisor-note is-" + severity} key={note.id}>
              <Icon size={13} className="advisor-note-icon" aria-hidden="true" />
              <span className="advisor-note-message">{note.message}</span>
              <time className="advisor-note-time" dateTime={new Date(note.timestamp).toISOString()}>
                {new Date(note.timestamp).toLocaleTimeString()}
              </time>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default AdvisorSidebar;
