import {
  DEFAULT_RAG_SETTING,
  DEFAULT_RAG_STORE_KEY,
  type RagSetting,
  type UserSettings,
} from "~/types/settings";
import { embeddingConfig } from "./rag-config";
import { resolveRagTopK, resolveRerankProvider } from "./rag-search-options";

const cleanLines = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some((line) => typeof line !== "string"))
    throw new Error("Invalid folder or exclusion list.");
  return value.map((line) => line.trim()).filter(Boolean);
};

/** Apply one index's editable options to the latest saved settings. */
export function prepareRagIndexSave(
  current: UserSettings,
  originalName: string,
  name: string,
  input: RagSetting,
) {
  name = name.trim();
  if (!name || name.length > 200 || Object.hasOwn(Object.prototype, name)) throw new Error("Enter a valid index name.");
  const existing = originalName ? current.ragSettings[originalName] : undefined;
  if (originalName && !Object.hasOwn(current.ragSettings, originalName))
    throw new Error("RAG index not found. Reload settings.");
  if (originalName === DEFAULT_RAG_STORE_KEY && name !== originalName)
    throw new Error("The automatic index cannot be renamed.");
  if (name !== originalName && Object.hasOwn(current.ragSettings, name))
    throw new Error("An index with this name already exists.");
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid RAG setting.");
  const targetFolders = cleanLines(input.targetFolders);
  const excludePatterns = cleanLines(input.excludePatterns);
  for (const pattern of excludePatterns) {
    try {
      new RegExp(pattern);
    } catch {
      throw new Error(`Invalid exclusion pattern: ${pattern}`);
    }
  }
  const config = embeddingConfig(input);
  const chunkSize = Math.max(
    100,
    Math.min(5000, Math.trunc(Number(input.chunkSize) || 1500)),
  );
  const setting: RagSetting = {
    ...(existing ?? DEFAULT_RAG_SETTING),
    // Keep store handles, registered files and sync progress from the server.
    topK: resolveRagTopK(input, current.ragTopK),
    rerankProvider: resolveRerankProvider(input),
    hybridSearch: input.hybridSearch !== false,
    jevRagFilterEnabled: input.jevRagFilterEnabled !== false,
    searchUntilMatch: input.searchUntilMatch === true,
    embeddingProvider: config.provider,
    embeddingModel: config.model,
    chunkSize,
    chunkOverlap: Math.max(
      0,
      Math.min(
        chunkSize - 1,
        Math.trunc(Number(input.chunkOverlap ?? 150) || 0),
      ),
    ),
    targetFolders,
    excludePatterns,
    isExternal: false,
    storeIds: [],
  };
  const ragSettings = Object.fromEntries([
    ...Object.entries(current.ragSettings).filter(
      ([key]) => key !== originalName,
    ),
    [name, setting],
  ]);
  return {
    setting,
    name,
    settings: {
      ...current,
      ragSettings,
      selectedRagSetting:
        !current.selectedRagSetting ||
        current.selectedRagSetting === originalName
          ? name
          : current.selectedRagSetting,
      ragRegistrationOnPush:
        name === DEFAULT_RAG_STORE_KEY ? true : current.ragRegistrationOnPush,
    } satisfies UserSettings,
  };
}

export function prepareRagIndexDeletion(current: UserSettings, name: string) {
  if (!Object.hasOwn(current.ragSettings, name))
    throw new Error("RAG index not found. Reload settings.");
  const removed = current.ragSettings[name];
  const ragSettings = Object.fromEntries(
    Object.entries(current.ragSettings).filter(([key]) => key !== name),
  );
  const handles = (setting: RagSetting) =>
    [
      setting.storeName,
      setting.storeId,
      ...(setting.retiredIndexes ?? []),
    ].filter((value): value is string => !!value);
  const referenced = new Set(Object.values(ragSettings).flatMap(handles));
  return {
    removedIndexes: [...new Set(handles(removed))].filter(
      (handle) => !referenced.has(handle),
    ),
    settings: {
      ...current,
      ragSettings,
      selectedRagSetting:
        current.selectedRagSetting === name
          ? (Object.keys(ragSettings)[0] ?? null)
          : current.selectedRagSetting,
      ragRegistrationOnPush:
        name === DEFAULT_RAG_STORE_KEY ? false : current.ragRegistrationOnPush,
    } satisfies UserSettings,
  };
}

export function prepareOkfSettingsSave(
  current: UserSettings,
  root: string,
): UserSettings {
  const okfRoot = root.trim().replace(/^\/+|\/+$/g, "") || "Knowledge";
  if (okfRoot.split("/").some((part) => part === "." || part === ".."))
    throw new Error("Invalid OKF folder.");
  return { ...current, okfRoot };
}
