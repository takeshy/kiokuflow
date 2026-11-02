import assert from "node:assert/strict";
import test from "node:test";
import { assertMigrationOwner, assertMigrationFileUnchanged, migrateDriveSettings,
  remapMigrationReferences, completedUploadBytes, type MigrationFile } from "./drive-migration";
import { assertMigrationUploadUrl, assertCopiedMigrationFile, migrationCopyChunk, migrationTrashOldSettings } from "./drive-migration-drive.server";

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
