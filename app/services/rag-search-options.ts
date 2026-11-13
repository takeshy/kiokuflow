import type { RagSetting, UserSettings } from "~/types/settings";

export const MAX_RAG_TOP_K = 20;
export const MAX_RAG_CANDIDATES = 1000;
export interface RagSearchOverrides { topK?: number; jevFilter?: boolean; rerankProvider?: "off" | "gemini" | "jev"; hybridSearch?: boolean; searchUntilMatch?: boolean; signal?: AbortSignal }

export function resolveRerankProvider(setting?: Partial<RagSetting>): "off" | "gemini" | "jev" {
  return setting?.rerankProvider === "gemini" || setting?.rerankProvider === "jev" ? setting.rerankProvider : "off";
}

export function resolveRagTopK(setting?: Partial<RagSetting>, fallback = 5): number {
  const value = setting?.topK ?? fallback;
  return Number.isFinite(value) ? Math.min(MAX_RAG_TOP_K, Math.max(1, Math.trunc(value))) : 5;
}

export function normalizeRagSettings(settings: Record<string, RagSetting>, fallback = 5): Record<string, RagSetting> {
  return Object.fromEntries(Object.entries(settings).map(([name, setting]) => [name, { ...setting, topK: resolveRagTopK(setting, fallback), rerankProvider: resolveRerankProvider(setting), hybridSearch: setting.hybridSearch !== false, jevRagFilterEnabled: setting.jevRagFilterEnabled ?? true, searchUntilMatch: setting.searchUntilMatch ?? false }]));
}

export function hasJevConfiguration(settings: Pick<UserSettings, "jev" | "compatibleProviders">): boolean {
  return settings.jev?.useOpenRouter ? !!settings.compatibleProviders?.openrouter?.encryptedApiKey : !!settings.jev?.encryptedApiKey;
}
