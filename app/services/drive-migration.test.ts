import assert from "node:assert/strict";
import test from "node:test";
import { assertMigrationOwner, assertMigrationFileUnchanged, migrateDriveSettings,
  remapMigrationReferences, completedUploadBytes, planMigrationTargets, MIGRATION_FOLDER_MIME, type MigrationEntry, type MigrationFile } from "./drive-migration";
import { assertMigrationUploadUrl, assertCopiedMigrationFile, migrationCopyChunk, migrationTrashOldSettings,
  migratedTarget, migrationBeginUpload, migrationCreateFolderOrEmpty } from "./drive-migration-drive.server";

test("migration requires the same Google identity and preserves ciphertext and the RSA identity", () => {
  assertMigrationOwner(" OWNER@EXAMPLE.COM ", "owner@example.com");
  assert.throws(() => assertMigrationOwner("other@example.com", "owner@example.com"));
  assert.throws(() => assertMigrationOwner(undefined, "owner@example.com"));
  const original = { encryption: { publicKey: "old-id", encryptedPrivateKey: "old-id", salt: "salt" },
    encryptedApiKey: "old-id", openai: { encryptedApiKey: "old-id", enabledModels: ["model"] },
    activeFile: "old-id", ragSettings: { main: { topK: 8, targetFolders: ["Notes"], storeName: "old-root-index", files: { file: {} } } } };
  const migrated = JSON.parse(migrateDriveSettings(JSON.stringify(original), new Map([["old-id", "new-id"]])));
  assert.deepEqual(migrated.encryption, original.encryption);
  assert.deepEqual(migrated.openai, original.openai);
  assert.equal(migrated.encryptedApiKey, original.encryptedApiKey);
  assert.equal(migrated.activeFile, "new-id");
  assert.equal(migrated.ragSettings.main.storeName, null);
  assert.deepEqual(migrated.ragSettings.main.files, {});
  assert.equal(migrated.ragSettings.main.topK, 8);
  assert.deepEqual(migrated.ragSettings.main.targetFolders, ["Notes"]);
});

test("history metadata remaps dictionary keys and exact file references, leaving note text unchanged", () => {
  assert.deepEqual(remapMigrationReferences({ items: { old: { fileId: "old", title: "old notes" } } }, new Map([["old", "new"]])),
    { items: { new: { fileId: "new", title: "old notes" } } });
  assert.throws(() => migrateDriveSettings("[]", new Map()));
});

const source: MigrationFile = { id: "old-file", name: "note.md", mimeType: "text/plain", size: "6", md5Checksum: "md5", modifiedTime: "original" };

test("planning merges existing history and nested folders and overwrites matching files by ID", async () => {
  const history = { id: "old-history", name: "history", mimeType: MIGRATION_FOLDER_MIME };
  const nested = { id: "old-nested", name: "nested", mimeType: MIGRATION_FOLDER_MIME };
  const newFolder = { id: "old-new", name: "new", mimeType: MIGRATION_FOLDER_MIME };
  const existingHistory = { ...history, id: "existing-history" };
  const existingNested = { ...nested, id: "existing-nested" };
  const existingFile = { ...source, id: "existing-note", md5Checksum: "destination-content" };
  const entry = (file: MigrationFile, parent: string, path: string, depth: number) => ({ source: file, parent, path, depth, done: false });
  const listings = new Map([
    ["new-root", [existingHistory, { ...source, id: "unrelated", name: "keep.md" }]],
    ["existing-history", [existingNested]], ["existing-nested", [existingFile]],
  ]);
  const listed: string[] = [];
  const planned = await planMigrationTargets([
    entry(history, "old-root", "history", 0), entry(newFolder, "old-root", "new", 0),
    entry(nested, history.id, "history/nested", 1), entry({ ...source, id: "new-note" }, newFolder.id, "new/note.md", 1),
    entry(source, nested.id, "history/nested/note.md", 2),
  ], "old-root", "new-root", async parent => { listed.push(parent); return listings.get(parent) ?? []; }, async count => {
    assert.equal(count, 2);
    return ["allocated-folder", "allocated-note"];
  });
  assert.deepEqual(planned.map(item => item.targetId), ["existing-history", "allocated-folder", "existing-nested", "allocated-note", "existing-note"]);
  assert.deepEqual(planned[4].overwrite, existingFile);
  assert.equal(planned[3].overwrite, undefined);
  assert.deepEqual(listed, ["new-root", "existing-history", "existing-nested"]);
  assert.ok(!planned.some(item => item.targetId === "unrelated"));
});

test("planning rejects ambiguous names and file/folder conflicts before overwriting anything", async () => {
  const entries = [{ source, parent: "old-root", path: "note.md", depth: 0, done: false }];
  const noIds = async () => { throw new Error("must reject before allocating IDs"); };
  await assert.rejects(planMigrationTargets(entries, "old-root", "new-root", async () => [source, { ...source, id: "duplicate" }], noIds), /同名/);
  await assert.rejects(planMigrationTargets(entries, "old-root", "new-root", async () => [{ ...source, mimeType: MIGRATION_FOLDER_MIME }], noIds), /形式/);
  await assert.rejects(planMigrationTargets(entries, "old-root", "new-root", async () => [{ ...source, mimeType: "application/vnd.google-apps.document" }], noIds), /形式/);
  await assert.rejects(planMigrationTargets([...entries, ...entries], "old-root", "new-root", async () => [], noIds), /移行元に同名/);
});

test("overwrites resume by checking the destination snapshot and completed source checksum", async t => {
  const overwrite = { ...source, id: "existing-file", parents: ["new-root"], md5Checksum: "old-content" };
  const entry: MigrationEntry = { source, path: "note.md", parent: "old-root", targetId: overwrite.id, depth: 0, done: false, overwrite };
  let actual = { ...overwrite };
  t.mock.method(globalThis, "fetch", async () => Response.json(actual));
  assert.equal(await migratedTarget("target", entry, "new-root", "marker"), null);
  actual = { ...actual, md5Checksum: "user-edited" };
  await assert.rejects(migratedTarget("target", entry, "new-root", "marker"), /移行先/);
  actual = { ...source, id: overwrite.id, parents: ["new-root"], modifiedTime: "copied", appProperties: { kiokuflowMigration: "marker", migrationSource: source.id } } as typeof actual;
  assert.equal((await migratedTarget("target", entry, "new-root", "marker"))?.id, overwrite.id);
  actual = { ...actual, parents: ["moved-elsewhere"] };
  await assert.rejects(migratedTarget("target", entry, "new-root", "marker"), /移行先/);
});

test("existing files use PATCH uploads and existing folders retain their IDs and children", async t => {
  const calls: { url: string; method: string; body: string; auth: string | null }[] = [];
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body), auth: new Headers(init?.headers).get("Authorization") });
    return Response.json({ id: "existing-file" }, { headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=test" } });
  });
  const entry: MigrationEntry = { source, path: "note.md", parent: "old-root", targetId: "existing-file", depth: 0, done: false,
    overwrite: { ...source, id: "existing-file" } };
  await migrationBeginUpload("target", entry, "new-root", "marker");
  await migrationCreateFolderOrEmpty("target", { ...entry, source: { ...source, size: "0" } }, "new-root", "marker");
  await migrationCreateFolderOrEmpty("target", { ...entry, source: { id: "old-history", name: "history", mimeType: MIGRATION_FOLDER_MIME }, targetId: "existing-history" }, "new-root", "marker");
  assert.deepEqual(calls.map(call => call.method), ["PATCH", "PATCH", "PATCH"]);
  assert.ok(calls.every(call => call.auth === "Bearer target"));
  assert.ok(calls[0].url.includes("/files/existing-file?uploadType=resumable"));
  assert.ok(calls[1].url.includes("/files/existing-file?uploadType=multipart"));
  assert.ok(calls[2].url.includes("/files/existing-history?fields=id"));
  assert.equal(JSON.parse(calls[0].body).id, undefined);
  assert.equal(JSON.parse(calls[0].body).parents, undefined);
  assert.deepEqual(JSON.parse(calls[2].body).appProperties, { kiokuflowMigration: "marker", migrationSource: "old-history" });
});

test("file changes and checksum mismatches cannot be reported as successful migration", () => {
  assertMigrationFileUnchanged(source, { ...source });
  for (const changed of [{ size: "7" }, { md5Checksum: "other" }, { modifiedTime: "changed" }, { name: "renamed.md" }]) {
    assert.throws(() => assertMigrationFileUnchanged(source, { ...source, ...changed }));
  }
  assertCopiedMigrationFile(source, { ...source, id: "new-file" });
  assert.throws(() => assertCopiedMigrationFile(source, { ...source, md5Checksum: "corrupt" }));
  assert.throws(() => assertCopiedMigrationFile(source, { ...source, size: "7" }));
});

test("resumable uploads trust only Google endpoints and valid acknowledged byte ranges", () => {
  assert.equal(completedUploadBytes(null), 0);
  assert.equal(completedUploadBytes("bytes=0-2"), 3);
  assert.throws(() => completedUploadBytes("bytes=4-6"));
  assert.throws(() => assertMigrationUploadUrl("https://evil.example/upload/drive/v3/files"));
  assert.throws(() => assertMigrationUploadUrl("http://www.googleapis.com/upload/drive/v3/files"));
});

test("resuming uses Google's acknowledged offset and never writes with the source token", async t => {
  const calls: { url: string; method: string; auth: string | null; range: string | null; contentRange: string | null; bytes?: Uint8Array }[] = [];
  const upload = "https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic";
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), method: init?.method ?? "GET", auth: headers.get("Authorization"), range: headers.get("Range"), contentRange: headers.get("Content-Range"), bytes: init?.body instanceof Uint8Array ? init.body : undefined });
    if (String(url).includes("fields=")) return Response.json(source);
    if (headers.get("Content-Range") === "bytes */6") return new Response(null, { status: 308, headers: { Range: "bytes=0-2" } });
    if (String(url).includes("alt=media")) return new Response(new Uint8Array([4, 5, 6]), { status: 206 });
    return Response.json({ id: "new-file" });
  });
  assert.deepEqual(await migrationCopyChunk("source-token", "target-token", { source, path: "note.md", parent: "root", targetId: "new-file", depth: 0, done: false }, upload), { done: true });
  assert.equal(calls.find(call => call.range)?.range, "bytes=3-5");
  const put = calls.find(call => call.bytes);
  assert.equal(put?.contentRange, "bytes 3-5/6");
  assert.deepEqual(put?.bytes, new Uint8Array([4, 5, 6]));
  assert.ok(calls.filter(call => call.auth === "Bearer source-token").every(call => call.method === "GET"));
});

test("an expired upload is resumable and a complete prior upload does not copy twice", async t => {
  let mode = 410;
  t.mock.method(globalThis, "fetch", async (url: unknown) => String(url).includes("fields=") ? Response.json(source) : new Response(null, { status: mode }));
  const entry = { source, path: "note.md", parent: "root", targetId: "new-file", depth: 0, done: false };
  const url = "https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic";
  assert.deepEqual(await migrationCopyChunk("source", "target", entry, url), { done: false, expired: true });
  mode = 200;
  assert.deepEqual(await migrationCopyChunk("source", "target", entry, url), { done: true });
});

test("cleanup trashes only the unchanged settings file in the original root and can resume after a lost response", async t => {
  const settings = { ...source, id: "old-settings", name: "settings.json", parents: ["old-root"] };
  const writes: unknown[] = [];
  let actual = { ...settings, trashed: false };
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "PATCH") { writes.push(JSON.parse(String(init.body))); actual = { ...actual, trashed: true }; return Response.json(actual); }
    return Response.json(actual);
  });
  await assert.rejects(migrationTrashOldSettings("source", "other-root", settings));
  await assert.rejects(migrationTrashOldSettings("source", "old-root", { ...settings, name: "note.md" }));
  await assert.rejects(migrationTrashOldSettings("source", "old-root", { ...settings, md5Checksum: "modified" }));
  assert.equal(writes.length, 0);
  await migrationTrashOldSettings("source", "old-root", settings);
  await migrationTrashOldSettings("source", "old-root", settings);
  assert.deepEqual(writes, [{ trashed: true }]);
});
