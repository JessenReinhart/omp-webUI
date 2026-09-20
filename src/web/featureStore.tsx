import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AgentEvent, AgentSnapshot, SessionEntry } from "./collabTypes";
import { deriveAdvisorNotes, deriveSubagentRecords, getLatestTodoPhasesFromEntries } from "./featureModel";
import type { AdvisorNote, SubagentRecord, TodoPhase } from "./featureTypes";

export interface FeatureSelection {
  todoPhases: TodoPhase[] | null;
  advisorNotes: AdvisorNote[];
  subagents: SubagentRecord[];
}

const EMPTY_SELECTION: FeatureSelection = { todoPhases: null, advisorNotes: [], subagents: [] };

const FeatureContext = createContext<FeatureSelection>(EMPTY_SELECTION);

/** Derives the to-do/advisor/subagent slices from the session stream. Cheap enough to memoize on identity. */
export function useFeatureSelection(
  entries: SessionEntry[],
  events: AgentEvent[],
  agents: AgentSnapshot[],
): FeatureSelection {
  return useMemo(
    () => ({
      todoPhases: getLatestTodoPhasesFromEntries(entries, events),
      advisorNotes: deriveAdvisorNotes(entries, events),
      subagents: deriveSubagentRecords(entries, events),
    }),
    [entries, events, agents],
  );
}

export function FeatureProvider({ selection, children }: { selection: FeatureSelection; children: ReactNode }) {
  return <FeatureContext.Provider value={selection}>{children}</FeatureContext.Provider>;
}

/** Slot-registered feature panels read derived state through the provider App installs. */
export function useFeatures(): FeatureSelection {
  return useContext(FeatureContext);
}
