import "fake-indexeddb/auto";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { awaitPendingMigrations } from "./pending-file-migration";
import { getCachedFile, setCachedFile, deleteCachedFile, setCachedRemoteMeta, getEditHistoryForFile, applyTimelineSnapshotCAS } from "./indexeddb-cache-drive";
import { parseTimeline } from "./timeline-format";
import { buildEntryBlock, serializeMemoFile } from "../dashboard/memo/memoTimeline";

const name = "Dashboards/Timeline/Timeline/2026-11-08.md";
const placeholder = `new:${name}`;
const post = (id: string, body = id) => buildEntryBlock({ id, body, createdAt: "2026-11-08T00:00:00.000Z" });
const text = (...posts: string[]) => serializeMemoFile("timeline:Timeline", posts);

async function setup(t: TestContext) {
  t.mock.getter(globalThis, "navigator", () => ({ onLine: true }) as Navigator);
  await deleteCachedFile(placeholder); await deleteCachedFile("canonical");
  await setCachedRemoteMeta({ id: "current", rootFolderId: "root", files: {}, lastUpdatedAt: "", cachedAt: 1 });
  await setCachedFile({ fileId: placeholder, fileName: name, content: text(post("local")), md5Checksum: "", modifiedTime: "", cachedAt: 1 });
  t.after(async () => { await deleteCachedFile(placeholder); await deleteCachedFile("canonical"); });
}

test("pending Timeline uses one merge request and adopts all returned posts and the canonical ID", async t => {
  await setup(t);
  let requests = 0;
  const merged = text(post("local"), post("remote"));
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    requests++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.action, "mergeTimeline");
    assert.equal(body.timelineRootFolderId, "root");
    assert.equal(body.content, text(post("local")));
    return Response.json({ file: { id: "canonical", name, md5Checksum: "merged", modifiedTime: "now" }, content: merged, rootFolderId: "root" });
  });
  await awaitPendingMigrations();
  assert.equal(requests, 1);
  assert.equal(await getCachedFile(placeholder), undefined);
  assert.deepEqual(parseTimeline((await getCachedFile("canonical"))!.content, name).map(entry => entry.id), ["local", "remote"]);
  assert.equal(await getEditHistoryForFile("canonical"), undefined);
});

test("a Timeline response arriving after another local edit retains the edit as dirty", async t => {
  await setup(t);
  const merged = text(post("local"), post("remote"));
  t.mock.method(globalThis, "fetch", async () => {
    await setCachedFile({ ...(await getCachedFile(placeholder))!, content: text(post("local", "edited during upload"), post("new")) });
    return Response.json({ file: { id: "canonical", name, md5Checksum: "merged", modifiedTime: "now" }, content: merged, rootFolderId: "root" });
  });
  await awaitPendingMigrations();
  const cached = (await getCachedFile("canonical"))!;
  assert.equal(parseTimeline(cached.content, name).find(entry => entry.id === "local")?.content, "edited during upload");
  assert.ok(parseTimeline(cached.content, name).some(entry => entry.id === "new"));
  assert.ok(parseTimeline(cached.content, name).some(entry => entry.id === "remote"));
  assert.ok((await getEditHistoryForFile("canonical"))?.diffs.length);
});

test("a response cannot replace a different account's Timeline cache", async t => {
  await setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ file: { id: "canonical", name }, content: text(post("remote")), rootFolderId: "other-root" }));
  await assert.rejects(awaitPendingMigrations(), /Local changes are kept/);
  assert.ok(await getCachedFile(placeholder));
  assert.equal(await getCachedFile("canonical"), undefined);
});

test("a deleted pending Timeline never deletes the shared daily file", async t => {
  await setup(t);
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    requests++;
    assert.equal(JSON.parse(String(init?.body)).action, "mergeTimeline");
    await deleteCachedFile(placeholder);
    return Response.json({ file: { id: "canonical", name }, content: text(post("local"), post("remote")), rootFolderId: "root" });
  });
  await awaitPendingMigrations();
  assert.equal(requests, 1);
  assert.equal(await getCachedFile(placeholder), undefined);
});

test("an existing canonical cache and a pending draft are merged without dropping either edit", async t => {
  await setup(t);
  await setCachedFile({ fileId: "canonical", fileName: name, content: text(post("cached-local")), md5Checksum: "old", modifiedTime: "", cachedAt: 1 });
  t.mock.method(globalThis, "fetch", async () => Response.json({ file: { id: "canonical", name, md5Checksum: "merged", modifiedTime: "now" }, content: text(post("local"), post("remote")), rootFolderId: "root" }));
  await awaitPendingMigrations();
  assert.deepEqual(parseTimeline((await getCachedFile("canonical"))!.content, name).map(entry => entry.id).sort(), ["cached-local", "local", "remote"]);
  assert.equal(await getCachedFile(placeholder), undefined);
});

test("a deleted canonical cache is not resurrected from an earlier migration read", async t => {
  await setup(t);
  const merged = text(post("local"), post("remote"));
  const applied = await applyTimelineSnapshotCAS({
    file: { fileId: "canonical", fileName: name, content: merged, md5Checksum: "merged", modifiedTime: "now", cachedAt: 1 },
    rootFolderId: "root", expectedFileId: placeholder, expectedContent: text(post("local")),
    expectedTargetContent: "a target which was deleted after reading", remoteContent: merged,
  });
  assert.equal(applied, false);
  assert.ok(await getCachedFile(placeholder));
  assert.equal(await getCachedFile("canonical"), undefined);
});
