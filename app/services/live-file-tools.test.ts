import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { createLiveFileToolRunner, isLivePrivatePath, type LiveFileContext } from "./live-file-tools";
import { LiveToolDispatcher, liveToolDefinitions } from "./live-tool-definitions";
import { setCachedFile, setCachedRemoteMeta } from "./indexeddb-cache";
import { DEFAULT_RAG_SETTING } from "~/types/settings";

async function fixture() {
  const files = [
    { id: "draft", name: "draft.md", path: "notes/draft.md" },
    { id: "memo", name: "memo.md", path: "notes/memo.md" },
    { id: "remote", name: "remote.md", path: "notes/remote.md" },
    { id: "private", name: "secret.encrypted", path: "Secrets/secret.encrypted" },
    { id: "settings", name: "settings.json", path: "settings.json" },
    { id: "office", name: "plan.docx", path: "notes/plan.docx" },
    { id: "pdf", name: "plan.pdf", path: "notes/plan.pdf" },
  ];
  const context: LiveFileContext = { rootFolderId: "live-files-root", files, currentFile: { id: "draft", name: "notes/draft.md", content: "Unsaved launch plan: Friday" } };
  await setCachedRemoteMeta({ id: "current", rootFolderId: context.rootFolderId, lastUpdatedAt: "", cachedAt: 1, files: Object.fromEntries(files.map(file => [file.id, { name: file.path, md5Checksum: "", modifiedTime: "", mimeType: "text/plain" }])) });
  for (const [fileId, content] of [["draft", "Old saved plan"], ["memo", "Meeting launch notes"], ["foreign", "Meeting launch from another tree"], ["private", "Meeting launch secret"]]) await setCachedFile({ fileId, content, md5Checksum: "", modifiedTime: "", cachedAt: 1 });
  const run = createLiveFileToolRunner(() => context);
  const call = (name: string, args: Record<string, unknown> = {}) => run({ id: "id", name, args }, new AbortController().signal);
  return { context, call };
}

test("Live reads unsaved editor text, lists public workspace files and restricts name/content searches to the tree", async () => {
  const f = await fixture();
  assert.match(JSON.stringify(await f.call("read_current_file")), /Unsaved launch plan/);
  const listed = JSON.stringify(await f.call("list_drive_files")); assert.ok(listed.includes("memo")); assert.ok(!listed.includes("settings.json")); assert.ok(!listed.includes("Secrets"));
  const content = JSON.stringify(await f.call("search_drive_files", { query: "Meeting launch", searchContent: true }));
  assert.match(content, /notes\/memo.md/); assert.ok(!content.includes("foreign")); assert.ok(!content.includes("secret"));
  assert.match(JSON.stringify(await f.call("search_drive_files", { query: "remote" })), /notes\/remote.md/);
});

test("Live refuses private paths, invented file IDs and write tools", async () => {
  const f = await fixture();
  for (const fileId of ["foreign", "private", "settings"]) assert.match(JSON.stringify(await f.call("read_drive_file", { fileId })), /error/);
  assert.match(JSON.stringify(await f.call("create_drive_file", { name: "overwrite.md" })), /only supports/);
  assert.equal(isLivePrivatePath("Secrets/key.md"), true);
  for (const path of ["custom/key.md", "notes/.hidden", "notes/../settings.json", "test.encrypted", "settings.json"]) assert.equal(isLivePrivatePath(path, "custom"), true, path);
});

test("remote Live reads use the abort signal and never cache the fetched text", async t => {
  const f = await fixture(); const signal = new AbortController().signal;
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => { assert.equal(String(input), "/api/drive/files?action=read&fileId=remote"); assert.equal(init?.signal, signal); return Response.json({ content: "Remote document contents" }); });
  const run = createLiveFileToolRunner(() => f.context);
  assert.match(JSON.stringify(await run({ id: "read", name: "read_drive_file", args: { fileId: "remote" } }, signal)), /Remote document contents/);
});

test("Live reads DOCX text and rejects oversized PDF ranges before downloading", async () => {
  const f = await fixture();
  await setCachedFile({ fileId: "office", content: Buffer.from(zipSync({ "word/document.xml": strToU8("<w:document><w:p><w:t>Launch Friday</w:t></w:p></w:document>") })).toString("base64"), encoding: "base64", md5Checksum: "", modifiedTime: "", cachedAt: 1 });
  assert.match(JSON.stringify(await f.call("read_drive_file", { fileId: "office" })), /Launch Friday/);
  await assert.rejects(f.call("read_drive_file", { fileId: "pdf", startPage: 1, endPage: 20 }), /16 pages/);
});

test("Live RAG uses the selected index and its Top K and filters private excerpts", async t => {
  const f = await fixture();
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    assert.equal(input, "/api/rag/context"); assert.deepEqual(JSON.parse(String(init?.body)), { query: "launch date", storeIds: ["selected-store"], topK: 7, jevFilter: false, searchUntilMatch: true });
    return Response.json({ contexts: [{ source: "notes/memo.md", text: "Friday" }, { source: "Secrets/key.md", text: "secret" }] });
  });
  const run = createLiveFileToolRunner(() => f.context, { name: "Work", setting: { ...DEFAULT_RAG_SETTING, storeId: "selected-store", jevRagFilterEnabled: false, searchUntilMatch: true }, topK: 7 });
  assert.deepEqual(await run({ id: "rag", name: "search_rag", args: { query: "launch date" } }, new AbortController().signal), { index: "Work", contexts: [{ source: "notes/memo.md", text: "Friday" }], scope: "server-indexed content only" });
});

test("Live deduplicates reads, blocks writes and rejects results after the workspace changes", async t => {
  const f = await fixture(); let executions = 0;
  const dispatcher = new LiveToolDispatcher({ fileAccess: true }, async () => { executions++; return { content: "ok" }; });
  const call = { id: "same", name: "read_current_file", args: {} };
  await Promise.all([dispatcher.run(call), dispatcher.run(call)]); assert.equal(executions, 1);
  assert.match(JSON.stringify(await dispatcher.run({ ...call, id: "write", name: "update_drive_file" })), /unavailable/);
  assert.ok(liveToolDefinitions({ fileAccess: true }).every(tool => !tool.name.includes("update") && !tool.name.includes("create")));
  t.mock.method(globalThis, "fetch", async () => { f.context.rootFolderId = "other-root"; return Response.json({ content: "foreign text" }); });
  await assert.rejects(f.call("read_drive_file", { fileId: "remote" }), /Workspace changed/);
});

test("Live tool timeout returns an error for the model instead of leaving a blocking call unanswered", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const dispatcher = new LiveToolDispatcher({ fileAccess: true }, async () => new Promise(() => {}));
  const pending = dispatcher.run({ id: "slow", name: "read_current_file", args: {} });
  t.mock.timers.tick(30_000);
  assert.match(JSON.stringify(await pending), /timed out/); assert.equal(dispatcher.isCancelled("slow"), false);
});
