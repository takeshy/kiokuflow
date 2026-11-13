import { normalizeRagSettings } from "./rag-search-options";
import { isLocalRuntime } from "./app-runtime.server";
// User settings CRUD via Google Drive (settings.json in root folder)

import { listFiles, readFile, createFile, updateFile } from "./google-drive.server";
import {
  DEFAULT_USER_SETTINGS,
  normalizeDeprecatedModelName,
  normalizeMcpServers,
  normalizeSelectedMcpServerIds,
  type UserSettings,
} from "~/types/settings";
import { SETTINGS_FILE_NAME } from "./sync-diff";

// In-memory cache keyed by rootFolderId (stable across token refreshes)
const settingsCache = new Map<string, { settings: UserSettings; fileId: string | null; cachedAt: number }>();
const SETTINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Find the settings.json file ID in the root folder
 */
async function getSettingsFileId(
  accessToken: string,
  rootFolderId: string
): Promise<string | null> {
  const files = await listFiles(accessToken, rootFolderId);
  const settingsFile = files.find((f) => f.name === SETTINGS_FILE_NAME);
  return settingsFile?.id ?? null;
}

/**
 * Load user settings from Drive. Returns defaults if not found.
 */
export async function getSettings(
  accessToken: string,
  rootFolderId: string,
  options: { fresh?: boolean } = {},
): Promise<UserSettings> {
  const cacheKey = rootFolderId;
  const cached = settingsCache.get(cacheKey);
  if (!options.fresh && cached && Date.now() - cached.cachedAt < SETTINGS_CACHE_TTL) {
    return { ...cached.settings, localMode: isLocalRuntime() };
  }

  try {
    const fileId = await getSettingsFileId(accessToken, rootFolderId);
    if (!fileId) {
      if (options.fresh) throw new Error("settings.json not found on Drive");
      settingsCache.set(cacheKey, { settings: DEFAULT_USER_SETTINGS, fileId: null, cachedAt: Date.now() });
      return { ...DEFAULT_USER_SETTINGS, localMode: isLocalRuntime() };
    }

    const content = await readFile(accessToken, fileId);
    const parsed = JSON.parse(content) as Partial<UserSettings>;
    const normalizedMcpServers = normalizeMcpServers(parsed.mcpServers || []);
    const normalizedSlashCommands = (parsed.slashCommands || []).map((cmd) => {
      const normalizedIds = normalizeSelectedMcpServerIds(
        cmd.enabledMcpServers,
        normalizedMcpServers
      );
      return {
        ...cmd,
        model: normalizeDeprecatedModelName(cmd.model),
        enabledMcpServers: normalizedIds.length > 0 ? normalizedIds : null,
      };
    });

    parsed.selectedModel = normalizeDeprecatedModelName(parsed.selectedModel) ?? null;

    // Merge with defaults to handle missing fields from older versions
    const settings: UserSettings = {
      ...DEFAULT_USER_SETTINGS,
      ...parsed,
      localMode: isLocalRuntime(),
      ragSettings: normalizeRagSettings(parsed.ragSettings || DEFAULT_USER_SETTINGS.ragSettings, parsed.ragTopK ?? DEFAULT_USER_SETTINGS.ragTopK),
      mcpServers: normalizedMcpServers,
      slashCommands: normalizedSlashCommands,
      encryption: { ...DEFAULT_USER_SETTINGS.encryption, ...parsed.encryption },
      editHistory: {
        ...DEFAULT_USER_SETTINGS.editHistory,
        ...parsed.editHistory,
        retention: {
          ...DEFAULT_USER_SETTINGS.editHistory.retention,
          ...parsed.editHistory?.retention,
        },
        diff: {
          ...DEFAULT_USER_SETTINGS.editHistory.diff,
          ...parsed.editHistory?.diff,
        },
      },
    };

    settingsCache.set(cacheKey, { settings, fileId, cachedAt: Date.now() });
    return settings;
  } catch (error) {
    // Scoped writes must not merge into a stale/default snapshot on read errors.
    if (options.fresh) throw error;
    // Prefer expired cache over defaults — preserves the user's saved
    // language/settings even when Drive is temporarily unreachable.
    const expired = settingsCache.get(cacheKey);
    if (expired) return { ...expired.settings, localMode: isLocalRuntime() };
    return { ...DEFAULT_USER_SETTINGS, localMode: isLocalRuntime() };
  }
}

/**
 * Ensure settings.json exists on Drive. Called once during login.
 */
export async function ensureSettingsFile(
  accessToken: string,
  rootFolderId: string
): Promise<void> {
  const fileId = await getSettingsFileId(accessToken, rootFolderId);
  if (fileId) return;
  await createFile(accessToken, SETTINGS_FILE_NAME, JSON.stringify(DEFAULT_USER_SETTINGS, null, 2), rootFolderId, "application/json");
}

/**
 * Save user settings to Drive (update only — settings.json must already exist)
 */
export async function saveSettings(
  accessToken: string,
  rootFolderId: string,
  settings: UserSettings
): Promise<void> {
  const normalizedMcpServers = normalizeMcpServers(settings.mcpServers || []);
  const normalizedSettings: UserSettings = {
    ...settings,
    mcpServers: normalizedMcpServers,
    slashCommands: (settings.slashCommands || []).map((cmd) => {
      const normalizedIds = normalizeSelectedMcpServerIds(
        cmd.enabledMcpServers,
        normalizedMcpServers
      );
      return {
        ...cmd,
        model: normalizeDeprecatedModelName(cmd.model),
        enabledMcpServers: normalizedIds.length > 0 ? normalizedIds : null,
      };
    }),
  };
  const persistedSettings = { ...normalizedSettings };
  delete persistedSettings.localMode;
  const content = JSON.stringify(persistedSettings, null, 2);

  const cacheKey = rootFolderId;
  const cached = settingsCache.get(cacheKey);
  const fileId = cached?.fileId ?? await getSettingsFileId(accessToken, rootFolderId);

  if (!fileId) {
    throw new Error("settings.json not found on Drive");
  }

  await updateFile(accessToken, fileId, content, "application/json");
  settingsCache.set(cacheKey, { settings: normalizedSettings, fileId, cachedAt: Date.now() });
}

/**
 * Clear settings cache (call at end of request if needed)
 */
export function clearSettingsCache(): void {
  settingsCache.clear();
}
