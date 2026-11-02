// Pure migration rules, shared by the server implementation and its tests.
export const MIGRATION_FOLDER_MIME = "application/vnd.google-apps.folder";
export const MIGRATION_CHUNK_SIZE = 8 * 1024 * 1024;
export interface DriveMigrationSummary {
  status: "ready" | "copying" | "complete";
  prepared: boolean;
  total: number;
  copied: number;
  currentFile: string | null;
}
export interface MigrationFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  md5Checksum?: string;
  size?: string;
  modifiedTime?: string;
  appProperties?: Record<string, string>;
  trashed?: boolean;
}
export interface MigrationEntry {
  source: MigrationFile;
  parent: string;
  path: string;
  depth: number;
  targetId: string;
  done: boolean;
  upload?: string;
  nextSourceId?: string | null;
}

export function migrationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class MigrationOwnerError extends Error {
  constructor() {
    super("移行元と移行先は同じGoogleアカウントで認証してください。");
    this.name = "MigrationOwnerError";
  }
}

export function assertMigrationOwner(actual: string | undefined, expected: string): void {
  if (!actual || migrationEmail(actual) !== migrationEmail(expected)) {
    throw new MigrationOwnerError();
  }
}

export function isMigrationSystemFile(path: string): boolean {
  return ["settings.json", "_sync-meta.json", "_encrypted-auth.json"].includes(path);
}

/** Only exact JSON references are changed; note bodies/ciphertext are not rewritten. */
export function remapMigrationReferences(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map(item => remapMigrationReferences(item, ids));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [ids.get(key) ?? key, remapMigrationReferences(item, ids)]));
  }
  return value;
}

/** Preserve the RSA identity and encrypted provider keys; rebuild workspace-owned RAG. */
export function migrateDriveSettings(content: string, ids: ReadonlyMap<string, string>): string {
  const source = JSON.parse(content);
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("旧設定ファイルの形式が不正です。");
  const result = remapMigrationReferences(source, ids) as Record<string, unknown>;
  // Credential ciphertext and encryption parameters must remain byte-for-byte identical.
  for (const key of ["encryption", "encryptedApiKey", "apiKeySalt", "openai", "jev", "compatibleProviders"]) {
    if (Object.hasOwn(source, key)) result[key] = source[key];
  }
  if (result.ragSettings && typeof result.ragSettings === "object") {
    result.ragSettings = Object.fromEntries(Object.entries(result.ragSettings).map(([name, setting]) => [name, {
      ...(setting as Record<string, unknown>), storeId: null, storeIds: [], storeName: null,
      files: {}, retiredIndexes: [], lastFullSync: null,
    }]));
  }
  return JSON.stringify(result, null, 2);
}

export function completedUploadBytes(range: string | null): number {
  if (range === null) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range);
  if (!match) throw new Error("Google Driveから不正なアップロード進捗が返されました。");
  const bytes = Number(match[1]) + 1;
  if (!Number.isSafeInteger(bytes)) throw new Error("アップロードサイズが不正です。");
  return bytes;
}

export function assertMigrationFileUnchanged(expected: MigrationFile, actual: MigrationFile): void {
  if (expected.id !== actual.id || expected.mimeType !== actual.mimeType || expected.name !== actual.name
    || expected.md5Checksum !== actual.md5Checksum || expected.size !== actual.size
    || expected.modifiedTime !== actual.modifiedTime) {
    throw new Error("移行元のファイルが変更されました。旧環境での編集を止めてから、移行対象を再確認してください。");
  }
}
