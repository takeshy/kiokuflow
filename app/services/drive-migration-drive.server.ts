import { createHash, randomUUID } from "node:crypto";
import { MIGRATION_CHUNK_SIZE, MIGRATION_FOLDER_MIME, completedUploadBytes, assertMigrationFileUnchanged,
  type MigrationEntry, type MigrationFile } from "./drive-migration";
import { MigrationRequestError } from "./drive-migration-batch";

export const MIGRATION_SMALL_FILE_LIMIT = 4 * 1024 * 1024;

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FIELDS = "id,name,mimeType,parents,md5Checksum,size,modifiedTime,appProperties,trashed";

async function request(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(60_000);
  const response = await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${token}` } });
  if (!response.ok && response.status !== 308) {
    await response.body?.cancel();
    throw new MigrationRequestError(`Google Driveへのアクセスに失敗しました (${response.status})。再認証または再試行してください。`, response.status === 429 || response.status >= 500);
  }
  return response;
}

export async function migrationDriveEmail(token: string): Promise<string | undefined> {
  return (await (await request(token, `${API}/about?fields=user(emailAddress)`)).json()).user?.emailAddress;
}

export async function migrationMetadata(token: string, id: string, signal?: AbortSignal): Promise<MigrationFile> {
  return (await request(token, `${API}/files/${encodeURIComponent(id)}?fields=${FIELDS}`, { signal })).json();
}

export async function migrationList(token: string, parent: string): Promise<MigrationFile[]> {
  if (!/^[\w-]+$/.test(parent)) throw new Error("DriveフォルダIDが不正です。");
  const files: MigrationFile[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ q: `'${parent}' in parents and trashed = false`, pageSize: "1000",
      fields: `nextPageToken,incompleteSearch,files(${FIELDS})`, ...(pageToken ? { pageToken } : {}) });
    const data = await (await request(token, `${API}/files?${params}`)).json();
    if (data.incompleteSearch) throw new Error("移行元のファイル一覧を完全に取得できませんでした。再試行してください。");
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return files;
}

export async function migrationGenerateIds(token: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  while (ids.length < count) {
    const data = await (await request(token, `${API}/files/generateIds?count=${Math.min(1000, count - ids.length)}&space=drive&type=files`)).json();
    if (!data.ids?.length) throw new Error("移行先のファイルIDを取得できませんでした。");
    ids.push(...data.ids);
  }
  return ids;
}

async function limitedBytes(response: Response, max: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Driveファイルの内容を取得できませんでした。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > max) throw new Error("移行用データが許容サイズを超えました。");
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function migrationReadText(token: string, id: string): Promise<string> {
  return new TextDecoder().decode(await limitedBytes(await request(token, `${API}/files/${encodeURIComponent(id)}?alt=media`), 4 * 1024 * 1024));
}

export function assertMigrationUploadUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "www.googleapis.com" || !url.pathname.startsWith("/upload/drive/")) {
    throw new Error("DriveアップロードURLが不正です。");
  }
  return value;
}

export function migrationMarker(sourceRoot: string): string {
  return createHash("sha256").update(sourceRoot).digest("hex").slice(0, 32);
}

/** Detect a successful earlier request before retrying: the target ID never changes. */
export async function migratedTarget(token: string, entry: MigrationEntry, parent: string, marker: string, signal?: AbortSignal): Promise<MigrationFile | null> {
  const response = await fetch(`${API}/files/${encodeURIComponent(entry.targetId)}?fields=${FIELDS}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) { await response.body?.cancel(); return null; }
  if (!response.ok) { await response.body?.cancel(); throw new MigrationRequestError(`移行先の状態確認に失敗しました (${response.status})。`, response.status === 429 || response.status >= 500); }
  const file = await response.json() as MigrationFile;
  const marked = file.appProperties?.kiokuflowMigration === marker && file.appProperties?.migrationSource === entry.source.id;
  const matches = !file.trashed && file.parents?.includes(parent) && file.name === (entry.targetName ?? entry.source.name) && file.mimeType === entry.source.mimeType;
  if (marked && matches && (!entry.overwrite || entry.done || entry.source.mimeType === MIGRATION_FOLDER_MIME
    || (file.md5Checksum === entry.source.md5Checksum && Number(file.size) === Number(entry.source.size)))) return file;
  if (entry.overwrite && !file.trashed && file.parents?.includes(parent)) {
    try {
      assertMigrationFileUnchanged(entry.overwrite, file);
      return null; // The original destination still exists; replace it on this step.
    } catch { /* Report a destination error rather than a source change. */ }
  }
  throw new Error("移行先のファイルが変更されています。上書きを停止しました。");
}

/** Small files need one read and one multipart write, with an immediate checksum check. */
export async function migrationCopySmallFile(sourceToken: string, targetToken: string, entry: MigrationEntry, parent: string, marker: string, signal?: AbortSignal): Promise<MigrationFile> {
  const size = Number(entry.source.size);
  if (!Number.isSafeInteger(size) || size < 1 || size > MIGRATION_SMALL_FILE_LIMIT) throw new Error("一括コピーのファイルサイズが不正です。");
  const bytes = await limitedBytes(await request(sourceToken, `${API}/files/${encodeURIComponent(entry.source.id)}?alt=media`, { signal }), size);
  if (bytes.length !== size || createHash("md5").update(bytes).digest("hex") !== entry.source.md5Checksum) {
    throw new Error("元ファイルの内容が変更されています。コピーを停止しました。");
  }
  const boundary = `migration-${randomUUID()}`;
  const prefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(targetMetadata(entry, parent, marker))}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const body = Buffer.concat([Buffer.from(prefix), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const suffix = entry.overwrite ? `/${encodeURIComponent(entry.targetId)}` : "";
  const response = await request(targetToken, `${UPLOAD}/files${suffix}?uploadType=multipart&fields=${FIELDS}`, {
    method: entry.overwrite ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body, signal,
  });
  const target = await response.json() as MigrationFile;
  if (target.id !== entry.targetId || target.name !== (entry.targetName ?? entry.source.name)
    || target.mimeType !== entry.source.mimeType || !target.parents?.includes(parent)
    || target.appProperties?.kiokuflowMigration !== marker || target.appProperties?.migrationSource !== entry.source.id) {
    throw new Error("コピー先のファイル情報が一致しません。移行完了にはしませんでした。");
  }
  assertCopiedMigrationFile(entry.source, target);
  return target;
}

function targetMetadata(entry: MigrationEntry, parent: string, marker: string) {
  return { name: entry.targetName ?? entry.source.name, mimeType: entry.source.mimeType,
    ...(!entry.overwrite ? { id: entry.targetId, parents: [parent] } : {}),
    appProperties: { kiokuflowMigration: marker, migrationSource: entry.source.id } };
}

export async function migrationCreateFolderOrEmpty(token: string, entry: MigrationEntry, parent: string, marker: string, signal?: AbortSignal): Promise<void> {
  const metadata = JSON.stringify(targetMetadata(entry, parent, marker));
  const suffix = entry.overwrite ? `/${encodeURIComponent(entry.targetId)}` : "";
  const method = entry.overwrite ? "PATCH" : "POST";
  let response: Response;
  if (entry.source.mimeType === MIGRATION_FOLDER_MIME) {
    response = await request(token, `${API}/files${suffix}?fields=id`, { method, headers: { "Content-Type": "application/json" }, body: metadata, signal });
  } else {
    // Explicitly upload a zero-byte binary body instead of creating a metadata-only file.
    const boundary = `migration-${randomUUID()}`;
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n\r\n--${boundary}--\r\n`;
    response = await request(token, `${UPLOAD}/files${suffix}?uploadType=multipart&fields=id`, {
      method, headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body, signal,
    });
  }
  await response.body?.cancel();
}

export async function migrationBeginUpload(token: string, entry: MigrationEntry, parent: string, marker: string, signal?: AbortSignal): Promise<string> {
  const suffix = entry.overwrite ? `/${encodeURIComponent(entry.targetId)}` : "";
  const response = await request(token, `${UPLOAD}/files${suffix}?uploadType=resumable&fields=${FIELDS}`, {
    method: entry.overwrite ? "PATCH" : "POST", headers: { "Content-Type": "application/json", "X-Upload-Content-Type": entry.source.mimeType,
      "X-Upload-Content-Length": entry.source.size ?? "0" },
    body: JSON.stringify(targetMetadata(entry, parent, marker)), signal,
  });
  const location = response.headers.get("Location");
  if (!location) throw new Error("アップロードを開始できませんでした。");
  return assertMigrationUploadUrl(location);
}

/** Copy one bounded chunk; Google is the authority on the acknowledged byte offset. */
export async function migrationCopyChunk(sourceToken: string, targetToken: string, entry: MigrationEntry, upload: string, signal?: AbortSignal): Promise<{ done: boolean; expired?: boolean }> {
  assertMigrationUploadUrl(upload);
  assertMigrationFileUnchanged(entry.source, await migrationMetadata(sourceToken, entry.source.id, signal));
  const total = Number(entry.source.size);
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error("ファイルサイズが不正です。");
  const status = await fetch(upload, { method: "PUT", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${targetToken}`, "Content-Length": "0", "Content-Range": `bytes */${total}` } });
  if ([404, 410].includes(status.status)) { await status.body?.cancel(); return { done: false, expired: true }; }
  if (status.ok) { await status.body?.cancel(); return { done: true }; }
  if (status.status !== 308) { await status.body?.cancel(); throw new MigrationRequestError(`アップロードの再開確認に失敗しました (${status.status})。`, status.status === 429 || status.status >= 500); }
  const offset = completedUploadBytes(status.headers.get("Range"));
  await status.body?.cancel();
  if (offset < 0 || offset >= total) throw new Error("アップロード進捗が不正です。");
  const end = Math.min(offset + MIGRATION_CHUNK_SIZE, total) - 1;
  const response = await request(sourceToken, `${API}/files/${encodeURIComponent(entry.source.id)}?alt=media`, {
    headers: { Range: `bytes=${offset}-${end}` }, signal,
  });
  const bytes = await limitedBytes(response, end - offset + 1);
  if (bytes.length !== end - offset + 1) throw new Error("元ファイルの取得が途中で終わりました。再試行してください。");
  const copied = await request(targetToken, upload, { method: "PUT", headers: {
    "Content-Type": entry.source.mimeType, "Content-Length": String(bytes.length), "Content-Range": `bytes ${offset}-${end}/${total}`,
  }, body: bytes as BodyInit, signal });
  const done = copied.ok;
  await copied.body?.cancel();
  return { done };
}

export function assertCopiedMigrationFile(source: MigrationFile, target: MigrationFile): void {
  if (source.mimeType === MIGRATION_FOLDER_MIME) return;
  if (Number(source.size) === 0 && Number(target.size) === 0) return;
  if (!source.md5Checksum || source.md5Checksum !== target.md5Checksum || Number(source.size) !== Number(target.size)) {
    throw new Error("コピー先の内容が元ファイルと一致しません。移行完了にはしませんでした。");
  }
}

export async function migrationWriteJson(token: string, id: string, text: string): Promise<void> {
  const response = await request(token, `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: text,
  });
  await response.body?.cancel();
}

/** The only source mutation: after durable destination verification, trash settings only. */
export async function migrationTrashOldSettings(token: string, root: string, settings: MigrationFile): Promise<void> {
  const actual = await migrationMetadata(token, settings.id);
  if (settings.name !== "settings.json" || actual.name !== "settings.json" || actual.id !== settings.id) {
    throw new Error("旧設定の場所を確認できないため、削除を停止しました。");
  }
  if (actual.trashed) return; // A prior request may have succeeded before the response was lost.
  if (!actual.parents?.includes(root)) throw new Error("旧設定の場所を確認できないため、削除を停止しました。");
  assertMigrationFileUnchanged(settings, actual);
  const result = await request(token, `${API}/files/${encodeURIComponent(settings.id)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }),
  });
  await result.body?.cancel();
}
