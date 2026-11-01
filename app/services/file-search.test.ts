import assert from "node:assert/strict";
import test from "node:test";
import { isSentenceSearch, searchFileNames, searchFileContents, mergeFileSearchResults, resolveRagResults } from "./file-search";
import type { CachedFile } from "./indexeddb-cache";

const files = [
  { id: "notes", name: "meeting.md", path: "Notes/meeting.md" },
  { id: "plan", name: "project-plan.md", path: "Plans/project-plan.md" },
  { id: "image", name: "image.png", path: "Images/image.png" },
  { id: "encrypted", name: "private.md", path: "Secrets/private.md" },
];
function cached(fileId: string, content: string, overrides: Partial<CachedFile> = {}): CachedFile {
  return { fileId, content, md5Checksum: "", modifiedTime: "", cachedAt: 0, ...overrides };
}

test("intent keeps short words inexpensive and routes Japanese and English sentences to RAG", () => {
  for (const query of ["東京", "四半期計画", "Gemini API", "OpenRouter", "project notes"]) assert.equal(isSentenceSearch(query), false, query);
  for (const query of ["何を決めた？", "先週の会議について教えて", "軽くて飲みやすかったワイン", "Where did we discuss the roadmap?", "the quarterly plan with the new goals", "会議\n議事録"]) assert.equal(isSentenceSearch(query), true, query);
});

test("file search uses names and paths even for files that have never been cached", () => {
  assert.deepEqual(searchFileNames(files, "Plans project").map(hit => hit.id), ["plan"]);
  assert.deepEqual(searchFileNames(files, "image").map(hit => hit.id), ["image"]);
  assert.equal(searchFileNames(files, "roadmap").length, 0);
  assert.equal(searchFileNames(files, "project-plam").length, 0);
  assert.deepEqual(searchFileNames(files, "project-plam", true).map(hit => hit.id), ["plan"]);
});

test("content search is separate from file names, uses AND matching, and respects the current tree", () => {
  const cache = [cached("notes", "We agreed on the roadmap and a launch in April."), cached("plan", "Budget approved."), cached("stale", "Roadmap for a deleted or different-root document")];
  assert.deepEqual(searchFileContents(files, cache, "roadmap April").map(hit => hit.id), ["notes"]);
  assert.equal(searchFileContents(files, cache, "meeting").length, 0, "A file-name hit is not a content hit");
  assert.equal(searchFileContents(files, cache, "roadmap May").length, 0);
  assert.equal(searchFileContents([], cache, "roadmap").length, 0);
  assert.match(searchFileContents(files, cache, "roadmap")[0].snippet!, /roadmap/);
});

test("simple search normalizes Unicode and kana; optional fuzzy matching adds typo hits", () => {
  const cache = [cached("notes", "ＡＰＩのｶﾞｲﾄﾞとカレンダー。"), cached("plan", "The quarterly roadmap is ready.")];
  assert.deepEqual(searchFileContents(files, cache, "api がいど").map(hit => hit.id), ["notes"]);
  assert.match(searchFileContents(files, cache, "がいど")[0].snippet!, /ｶﾞｲﾄﾞ/);
  assert.equal(searchFileContents(files, cache, "roadmop").length, 0);
  assert.deepEqual(searchFileContents(files, cache, "roadmop", true).map(hit => hit.id), ["plan"]);
  assert.equal(searchFileContents(files, cache, "xx", true).length, 0, "Short tokens must not expand into arbitrary matches");
});

test("content search never treats binary data or encrypted envelopes as searchable text", () => {
  const cache = [cached("image", "secret", { encoding: "base64" }), cached("encrypted", "---\nencrypted: true\n---\nsecret"), cached("notes", "secret\0binary")];
  assert.equal(searchFileContents(files, cache, "secret", true).length, 0);
});

test("RAG resolution uses full paths and refuses to guess between duplicate basenames", () => {
  const duplicates = [...files, { id: "second", name: "meeting.md", path: "Archive/meeting.md" }];
  const hits = resolveRagResults([{ title: "Archive/meeting.md", snippet: "excerpt" }, { title: "meeting.md" }, { title: "missing.md" }], duplicates);
  assert.equal(hits[0].id, "second");
  assert.equal(hits[1].id, undefined);
  assert.equal(hits[2].id, undefined);
  const combined = mergeFileSearchResults([{ id: "second", name: "meeting.md", match: "keyword" }], hits);
  assert.equal(combined.filter(hit => hit.id === "second").length, 1);
  assert.equal(combined[0].match, "keyword", "Expansion preserves exact matches");
});
