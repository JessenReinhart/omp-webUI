import { isRecord } from "./collabTypes";

export type CommandSource = "core" | "skill" | "prompt" | "model" | "thinking";

export interface CommandOption {
  name: string;
  description: string;
  source: CommandSource;
  argumentHint?: string;
  value?: string;
  active?: boolean;
}

export interface CommandCatalog {
  commands: CommandOption[];
  models: Array<{ id: string; name: string; provider: string; active: boolean }>;
  thinkingLevels: string[];
  currentModel?: string;
  currentThinking?: string;
}

export const DEFAULT_COMMANDS: CommandOption[] = [
  { name: "model", description: "Switch the active model", source: "core", argumentHint: "provider/model" },
  { name: "thinking", description: "Change the reasoning effort", source: "core", argumentHint: "off | low | medium | high…" },
  { name: "compact", description: "Compact the current context", source: "core", argumentHint: "optional instructions" },
  { name: "new", description: "Start a fresh OMP session", source: "core" },
  { name: "name", description: "Rename the current session", source: "core", argumentHint: "session name" },
  { name: "reload", description: "Reload extensions, skills, and settings", source: "core" },
  { name: "abort", description: "Stop the current response", source: "core" },
];

function isCommandOption(value: unknown): value is CommandOption {
  if (!isRecord(value)) return false;
  return typeof value.name === "string"
    && typeof value.description === "string"
    && (value.source === "core" || value.source === "skill" || value.source === "prompt");
}

export function parseCommandCatalog(value: unknown): CommandCatalog | null {
  if (!isRecord(value) || !Array.isArray(value.commands) || !value.commands.every(isCommandOption)) return null;
  const rawModels = Array.isArray(value.models) ? value.models : [];
  const models = rawModels.flatMap((model) => {
    if (!isRecord(model)
      || typeof model.id !== "string"
      || typeof model.name !== "string"
      || typeof model.provider !== "string") return [];
    return [{ id: model.id, name: model.name, provider: model.provider, active: model.active === true }];
  });
  const thinkingLevels = Array.isArray(value.thinkingLevels)
    ? value.thinkingLevels.filter((level): level is string => typeof level === "string")
    : [];
  return {
    commands: value.commands,
    models,
    thinkingLevels,
    currentModel: typeof value.currentModel === "string" ? value.currentModel : undefined,
    currentThinking: typeof value.currentThinking === "string" ? value.currentThinking : undefined,
  };
}
