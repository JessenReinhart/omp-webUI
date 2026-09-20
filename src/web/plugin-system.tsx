import { useSyncExternalStore, type ComponentType, type ReactNode } from "react";

export type UiSlot =
  | "sidebar.top"
  | "sidebar.bottom"
  | "session.header"
  | "session.toolbar"
  | "chat.before"
  | "chat.after"
  | "agent.panel"
  | "agent.actions"
  | "rightPanel"
  | "bottomPanel"
  | "statusBar"
  | "advisor.panel"
  | "todo.panel";

export interface UiContribution {
  id: string;
  slot: UiSlot;
  order?: number;
  component: ComponentType;
}

type Listener = () => void;
const EMPTY_CONTRIBUTIONS: UiContribution[] = [];

class PluginRegistry {
  #ui = new Map<UiSlot, UiContribution[]>();
  #listeners = new Set<Listener>();

  registerUi(contribution: UiContribution) {
    const list = this.#ui.get(contribution.slot) ?? EMPTY_CONTRIBUTIONS;
    if (list.some((item) => item.id === contribution.id)) {
      throw new Error(`Duplicate UI contribution: ${contribution.id}`);
    }

    this.#ui.set(
      contribution.slot,
      [...list, contribution].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    );
    this.#emit();

    return () => {
      const next = (this.#ui.get(contribution.slot) ?? EMPTY_CONTRIBUTIONS).filter(
        (item) => item.id !== contribution.id,
      );
      this.#ui.set(contribution.slot, next);
      this.#emit();
    };
  }

  getUi(slot: UiSlot) {
    return this.#ui.get(slot) ?? EMPTY_CONTRIBUTIONS;
  }

  subscribe(listener: Listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit() {
    for (const listener of this.#listeners) listener();
  }
}

export const plugins = new PluginRegistry();

export function Slot({ name, fallback }: { name: UiSlot; fallback?: ReactNode }) {
  const contributions = useSyncExternalStore(
    (listener) => plugins.subscribe(listener),
    () => plugins.getUi(name),
    () => plugins.getUi(name),
  );

  if (contributions.length === 0) return fallback ?? null;

  return (
    <>
      {contributions.map(({ id, component: Component }) => (
        <Component key={id} />
      ))}
    </>
  );
}
