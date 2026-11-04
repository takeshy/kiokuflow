import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { awaitPendingMigrations, pendingFileTargetName } from "./pending-file-migration";
import { deleteCachedFile, getCachedFile, getPendingNewFiles, setCachedFile } from "./indexeddb-cache-drive";

test("pending migration follows a renamed cache filename", () => {
  assert.equal(
    pendingFileTargetName({ fileId: "new:old/path.md", fileName: "new/path.md" }),
    "new/path.md",
  );
});

test("pending migration falls back to the new: id path", () => {
  assert.equal(pendingFileTargetName({ fileId: "new:notes/a.md" }), "notes/a.md");
});

test("pending lookup reads only new: records instead of cloning the entire cache", async (t) => {
  await setCachedFile({ fileId: "existing", content: "cached attachment", md5Checksum: "", modifiedTime: "", cachedAt: 1 });
  await setCachedFile({ fileId: "new:draft.md", content: "local draft", md5Checksum: "", modifiedTime: "", cachedAt: 1 });
  t.after(() => deleteCachedFile("new:draft.md"));
  const original = IDBObjectStore.prototype.getAll;
  t.mock.method(IDBObjectStore.prototype, "getAll", function (this: IDBObjectStore, query?: IDBValidKey | IDBKeyRange | null, count?: number) {
    assert.ok(query instanceof IDBKeyRange, "must not read all cached contents");
    assert.equal(query.includes("new:draft.md"), true);
    assert.equal(query.includes("existing"), false);
    assert.equal(query.includes("new;other"), false);
    return original.call(this, query, count);
  });
  assert.deepEqual((await getPendingNewFiles()).map((file) => file.fileId), ["new:draft.md"]);
});

test("failed migration ends Push waiting and keeps the draft for a later retry", async (t) => {
  t.mock.getter(globalThis, "navigator", () => ({ onLine: true }) as Navigator);
  const fileId = "new:failed.md";
  await setCachedFile({ fileId, fileName: "failed.md", content: "unsent edit", md5Checksum: "", modifiedTime: "", cachedAt: 1 });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response("Unavailable", { status: 503 });
  });
  const waiting = awaitPendingMigrations();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await assert.rejects(Promise.race([
      waiting,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("wait did not settle")), 500); }),
    ]), /Could not save new files to Drive/);
    assert.equal(requests, 1);
    assert.equal((await getCachedFile(fileId))?.content, "unsent edit");
  } finally {
    clearTimeout(timer);
    await deleteCachedFile(fileId);
    await waiting.catch(() => {});
  }
});

test("an offline phone ends Push waiting without retrying or deleting the draft", async (t) => {
  t.mock.getter(globalThis, "navigator", () => ({ onLine: false }) as Navigator);
  const fileId = "new:offline.md";
  await setCachedFile({ fileId, content: "offline edit", md5Checksum: "", modifiedTime: "", cachedAt: 1 });
  t.after(() => deleteCachedFile(fileId));
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not send while offline"); });
  await assert.rejects(awaitPendingMigrations(), /Could not save new files to Drive/);
  assert.equal((await getCachedFile(fileId))?.content, "offline edit");
});

test("existing-file Push does not make migration requests", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("No new files to create"); });
  await awaitPendingMigrations();
});
