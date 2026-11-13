import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Firestore } from "@google-cloud/firestore";
import { replaceLocalRagDocument, deleteLocalRagDocument, getLocalRagRevision, listLocalRagTextChunks, searchLocalRagChunks, listLocalRagFiles, type LocalRagScope } from "./rag-local-store.server";
import { retrieveHybridRagChunks } from "./rag-hybrid.server";
import { registerSingleFile, ragIndexId, isCurrentRagIndex, deleteStore, retrievePersonalRag, smartSync, calculateChecksum } from "./rag-index.server";
import { assertRagAccess } from "./rag-access.server";
import { clearSettingsCache } from "./user-settings.server";
import { DEFAULT_RAG_SETTING, DEFAULT_USER_SETTINGS } from "~/types/settings";
import type { RagChunk } from "./rag-store.server";

const scope: LocalRagScope = { orgId: "personal-rag-v1", projectId: "owner", settingName: "notes" };
const chunk = (id: string, vector: number[], path = "a.md", text = id): RagChunk => ({ ...scope, chunkId: id, docPath: path, chunkIndex: 0, text, embedding: vector, metadata: { fileName: path, contentType: "text", md5Checksum: id }, updatedAt: 123 });
async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "kiokuflow-rag-local-"));
  const oldDir = process.env.LOCAL_RAG_DIR, oldMode = process.env.KIOKUFLOW_RUNTIME;
  process.env.LOCAL_RAG_DIR = dir; process.env.KIOKUFLOW_RUNTIME = "local";
  t.mock.method(Firestore.prototype, "collection", () => assert.fail("Local RAG touched Firestore"));
  t.after(async () => { clearSettingsCache(); if (oldDir === undefined) delete process.env.LOCAL_RAG_DIR; else process.env.LOCAL_RAG_DIR = oldDir; if (oldMode === undefined) delete process.env.KIOKUFLOW_RUNTIME; else process.env.KIOKUFLOW_RUNTIME = oldMode; await rm(dir, { recursive: true, force: true }); });
  return dir;
}

test("local RAG stores JSON metadata and Float32 vectors and reloads after restart", async t => {
  const dir = await fixture(t);
  await replaceLocalRagDocument(scope, "a.md", [chunk("best", [2, 0]), { ...chunk("other", [0, 3]), chunkIndex: 1 }]);
  const [folder] = await readdir(dir);
  const files = await readdir(join(dir, folder));
  const binary = files.find(name => name.endsWith(".bin"))!;
  assert.equal((await readFile(join(dir, folder, binary))).length, 16);
  const metadata = JSON.parse(await readFile(join(dir, folder, files.find(name => name.startsWith("meta-"))!), "utf8"));
  assert.equal(metadata[0].embedding, undefined);
  assert.deepEqual((await searchLocalRagChunks(scope, [5, 0], 1)).map(hit => hit.chunk.chunkId), ["best"]);
  const module = new URL("./rag-local-store.server.ts", import.meta.url).href;
  const restarted = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `import { searchLocalRagChunks } from ${JSON.stringify(module)}; console.log(JSON.stringify((await searchLocalRagChunks(${JSON.stringify(scope)}, [5,0], 1)).map(hit=>hit.chunk.chunkId)));`], { env: { ...process.env, LOCAL_RAG_DIR: dir, KIOKUFLOW_RUNTIME: "local" }, encoding: "utf8" });
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout), ["best"]);
});

test("replacing and deleting documents invalidates caches and preserves other files and scopes", async t => {
  await fixture(t);
  await replaceLocalRagDocument(scope, "a.md", [chunk("old", [1, 0])]);
  await replaceLocalRagDocument(scope, "b.md", [chunk("b", [0, 1], "b.md")]);
  const previous = await getLocalRagRevision(scope);
  const other = { ...scope, projectId: "other-owner" };
  await replaceLocalRagDocument(other, "a.md", [{ ...chunk("private", [1, 0]), ...other }]);
  await replaceLocalRagDocument(scope, "a.md", [chunk("new", [1, 0])]);
  assert.notEqual(await getLocalRagRevision(scope), previous);
  assert.deepEqual((await listLocalRagTextChunks(scope)).map(row => row.chunkId).sort(), ["b", "new"]);
  assert.deepEqual((await searchLocalRagChunks(other, [1, 0], 5)).map(hit => hit.chunk.chunkId), ["private"]);
  assert.equal(await deleteLocalRagDocument(scope, "a.md"), 1);
  assert.deepEqual((await listLocalRagFiles(scope)).map(row => row.docPath), ["b.md"]);
  assert.equal(await deleteLocalRagDocument(scope), 1);
  assert.deepEqual(await searchLocalRagChunks(scope, [1, 0], 5), []);
  assert.equal((await listLocalRagFiles(other)).length, 1);
});

test("concurrent local document commits do not lose files and invalid replacements retain previous data", async t => {
  await fixture(t);
  await Promise.all(Array.from({ length: 12 }, (_, i) => replaceLocalRagDocument(scope, `${i}.md`, [chunk(String(i), [1, i], `${i}.md`)])));
  assert.equal((await listLocalRagFiles(scope)).length, 12);
  const revision = await getLocalRagRevision(scope);
  await assert.rejects(replaceLocalRagDocument(scope, "0.md", [chunk("invalid", [Number.NaN, 0], "0.md")]), /Invalid/);
  await assert.rejects(replaceLocalRagDocument(scope, "0.md", [chunk("underflow", [Number.MIN_VALUE, 0], "0.md")]), /Invalid/);
  await assert.rejects(replaceLocalRagDocument(scope, "0.md", [chunk("wrong-dimension", [1, 0, 0], "0.md")]), /dimensions/);
  await assert.rejects(replaceLocalRagDocument(scope, "0.md", [{ ...chunk("wrong-owner", [1, 0], "0.md"), projectId: "foreign" }]), /scope/);
  assert.equal(await getLocalRagRevision(scope), revision);
  assert.equal((await listLocalRagTextChunks(scope)).some(row => row.chunkId === "0"), true);
});

test("local sync rebuilds missing disk data even when Drive reports registered files", async t => {
  await fixture(t);
  const text = "Friday launch deadline", root = "new-machine-root";
  const checksum = await calculateChecksum(text);
  const setting = { ...DEFAULT_RAG_SETTING, files: { "a.md": { checksum, fileId: "registered-remotely", status: "registered" as const, uploadedAt: 123 } } };
  const id = ragIndexId(root, "notes", setting);
  const savedSetting = { ...setting, storeId: id, storeName: id };
  const vector = Array.from({ length: 2048 }, (_, i) => i === 0 ? 1 : 0);
  let embeddings = 0;
  t.mock.method(globalThis, "fetch", async (input: unknown) => {
    const url = new URL(String(input));
    if (url.hostname === "generativelanguage.googleapis.com") { embeddings++; return Response.json({ embeddings: [{ values: vector }] }); }
    assert.equal(url.hostname, "www.googleapis.com");
    if (url.pathname.endsWith("/meta-file")) return Response.json({ version: 1, lastUpdatedAt: "2026-11-13T00:00:00Z", files: { "source-file": { name: "a.md", mimeType: "text/markdown", modifiedTime: "2026-11-13T00:00:00Z", md5Checksum: "source-md5" } } });
    if (url.pathname.endsWith("/source-file")) return new Response(text);
    if (url.pathname.endsWith("/settings-file")) return Response.json({ ...DEFAULT_USER_SETTINGS, ragSettings: { notes: savedSetting } });
    if ((url.searchParams.get("q") || "").includes("_sync-meta.json")) return Response.json({ files: [{ id: "meta-file", name: "_sync-meta.json", mimeType: "application/json" }] });
    return Response.json({ files: [{ id: "settings-file", name: "settings.json", mimeType: "application/json" }] });
  });
  const first = await smartSync("synthetic", "synthetic", savedSetting, root);
  assert.deepEqual(first.errors, []);
  assert.deepEqual(first.uploaded, ["a.md"]);
  assert.equal(embeddings, 1);
  const second = await smartSync("synthetic", "synthetic", { ...savedSetting, files: first.newFiles }, root);
  assert.deepEqual(second.skipped, ["a.md"]);
  assert.equal(embeddings, 1);
  await deleteStore(id, root);
  const third = await smartSync("synthetic", "synthetic", { ...savedSetting, files: first.newFiles }, root);
  assert.deepEqual(third.uploaded, ["a.md"]);
  assert.equal(embeddings, 2);
});

test("changing the RAG backend requires a sync and local cleanup never deletes hosted data", async t => {
  await fixture(t);
  process.env.KIOKUFLOW_RUNTIME = "hosted";
  const hosted = ragIndexId("root", "notes", DEFAULT_RAG_SETTING);
  process.env.KIOKUFLOW_RUNTIME = "local";
  const local = ragIndexId("root", "notes", DEFAULT_RAG_SETTING);
  assert.notEqual(hosted, local);
  assert.equal(isCurrentRagIndex({ ...DEFAULT_RAG_SETTING, storeName: hosted }, "root", "notes"), false);
  assert.equal(isCurrentRagIndex({ ...DEFAULT_RAG_SETTING, storeName: local }, "root", "notes"), true);
  await assert.doesNotReject(deleteStore(hosted, "root"));
  await assert.rejects(deleteStore(hosted, "foreign-root"), /different workspace/);
  await assert.rejects(assertRagAccess("root", "organization"), error => error instanceof Response && error.status === 503);
});

test("local hybrid retrieval and revision invalidation use the existing BM25/reranking interface", async t => {
  await fixture(t);
  await replaceLocalRagDocument(scope, "a.md", [chunk("semantic", [1, 0], "a.md", "semantic meaning")]);
  await replaceLocalRagDocument(scope, "b.md", [chunk("keyword", [0, 1], "b.md", "E02 保存方法")]);
  const hits = await retrieveHybridRagChunks(scope.orgId, scope.projectId, scope.settingName, "E02", [1, 0], 2, true);
  assert.equal(hits.length, 2);
  assert.equal(hits.some(hit => hit.chunkId === "keyword"), true);
  await deleteLocalRagDocument(scope, "b.md");
  assert.deepEqual((await retrieveHybridRagChunks(scope.orgId, scope.projectId, scope.settingName, "E02", [1, 0], 2, true)).map(hit => hit.chunkId), ["semantic"]);
});

test("local RAG registers and searches through real personal retrieval with no Firestore or subscription", async t => {
  await fixture(t);
  const setting = { ...DEFAULT_RAG_SETTING, files: {} };
  const id = ragIndexId("root", "notes", setting);
  assert.equal(isCurrentRagIndex({ ...setting, storeName: id }, "root", "notes"), true);
  await assert.doesNotReject(assertRagAccess("root"));
  const vector = Array.from({ length: 2048 }, (_, i) => i === 0 ? 1 : 0);
  let savedSetting = { ...setting, storeId: id, storeName: id };
  t.mock.method(globalThis, "fetch", async (input: unknown) => {
    const url = String(input);
    if (url.includes("generativelanguage.googleapis.com")) return Response.json({ embeddings: [{ values: vector }] });
    if (url.includes("/drive/v3/files/settings-file")) return Response.json({ ...DEFAULT_USER_SETTINGS, ragSettings: { notes: savedSetting } });
    if (url.includes("/drive/v3/files?")) return Response.json({ files: [{ id: "settings-file", name: "settings.json", mimeType: "application/json" }] });
    assert.fail(`Unexpected local retrieval request: ${url}`);
  });
  const registered = await registerSingleFile("synthetic", id, "a.md", "Launch deadline is Friday.", null, { rootFolderId: "root" });
  savedSetting = { ...savedSetting, files: { "a.md": { ...registered, uploadedAt: 123, status: "registered" } } };
  const result = await retrievePersonalRag({ rootFolderId: "root", accessToken: "synthetic", geminiApiKey: "synthetic" }, [id], "Launch deadline", 5);
  assert.deepEqual(result.sources, ["a.md"]);
  assert.match(result.contexts[0].text, /Friday/);
  await deleteStore(id, "root");
  await assert.rejects(retrievePersonalRag({ rootFolderId: "root", accessToken: "synthetic", geminiApiKey: "synthetic" }, [id], "Launch deadline", 5), /no local RAG data/);
});
