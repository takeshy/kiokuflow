// Pure sync diff types and computation — shared between server and client.
// The implementation lives in kiokuflow-sync-core so every kiokuflow client
// (web, obsidian-gemihub, gemihub-gdrive) applies the same protocol rules.

export {
  SYNC_META_FILE_NAME,
  SETTINGS_FILE_NAME,
  ENCRYPTED_AUTH_FILE_NAME,
  computeSyncDiff,
  type FileSyncMeta,
  type SyncMeta,
  type SyncDiff,
} from "kiokuflow-sync-core/protocol";
