export type SettingsTabId = "ai" | "general" | "enterprise" | "sync" | "integrations" | "kakeratta" | "bluesky" | "mcp" | "rag" | "commands" | "shortcuts" | "plugins" | "hubwork";

/** Keep existing deep links while showing grouped navigation. */
export function settingsTabGroup(tab: SettingsTabId): SettingsTabId {
  if (tab === "kakeratta" || tab === "bluesky") return "integrations";
  if (tab === "shortcuts") return "commands";
  return tab;
}

export function isSettingsTabId(value: string | null): value is SettingsTabId {
  return value !== null && ["ai", "general", "enterprise", "sync", "integrations", "kakeratta", "bluesky", "mcp", "rag", "commands", "shortcuts", "plugins", "hubwork"].includes(value);
}
