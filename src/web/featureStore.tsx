import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AgentEvent, AgentSnapshot, SessionEntry } from "./collabTypes";
import { deriveAdvisorNotes, deriveSubagentRecords, getLatestTodoPhasesFromEntries } from "./featureModel";
import type { AdvisorNote, SubagentRecord, TodoPhase } from "./featureTypes";

export interface FeatureSelection {
  todoPhases: TodoPhase[] | null;
  advisorNotes: AdvisorNote[];
  subagents: SubagentRecord[];
  /** Whether the agents drawer is currently visible. Panels gate fetches on it. */
  agentsPanelOpen: boolean;
}

/** Derived slice of the selection: everything computed from the session stream. */
export type DerivedFeatures = Omit<FeatureSelection, "agentsPanelOpen">;

const EMPTY_SELECTION: FeatureSelection = {
  todoPhases: null,
  advisorNotes: [],
  subagents: [],
  agentsPanelOpen: false,
};

const FeatureContext = createContext<FeatureSelection>(EMPTY_SELECTION);

/** Derives the to-do/advisor/subagent slices from the session stream. Cheap enough to memoize on identity. */
export function useFeatureSelection(
  entries: SessionEntry[],
  events: AgentEvent[],
  agents: AgentSnapshot[],
): DerivedFeatures {
  return useMemo(
    () => ({
      todoPhases: getLatestTodoPhasesFromEntries(entries, events),
      advisorNotes: deriveAdvisorNotes(entries, events),
      subagents: deriveSubagentRecords(entries, events, agents),
    }),
    [entries, events, agents],
  );
}

export function FeatureProvider({
  selection,
  agentsPanelOpen,
  children,
}: {
  selection: DerivedFeatures;
  agentsPanelOpen: boolean;
  children: ReactNode;
}) {
  const value = useMemo<FeatureSelection>(
    () => ({ ...selection, agentsPanelOpen }),
    [selection, agentsPanelOpen],
  );
  return <FeatureContext.Provider value={value}>{children}</FeatureContext.Provider>;
}

/** Slot-registered feature panels read derived state through the provider App installs. */
export function useFeatures(): FeatureSelection {
  return useContext(FeatureContext);
}
