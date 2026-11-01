import assert from "node:assert/strict";
import test from "node:test";
import { getJevConfig, jevDecide, judgeRagCandidates, searchAndJudgeRag } from "./jev-rag.server";
import { normalizeRagSettings, resolveRagTopK } from "./rag-search-options";
import { DEFAULT_RAG_SETTING, DEFAULT_USER_SETTINGS } from "~/types/settings";
import { ragIndexId } from "./rag-index.server";

const config = { apiKey: "synthetic-jev", useOpenRouter: false };
const candidate = (index: number, text = `Evidence ${index}`) => ({ chunkId: String(index), docPath: `Notes/${index}.md`, text });

test("Jev direct and OpenRouter use fixed decision endpoints, model aliases and strict answers", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    const router = calls++ === 1;
    assert.equal(String(url), router ? "https://openrouter.ai/api/alpha/decisions" : "https://api.typesafe.ai/v1/systemone");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-jev");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, router ? "~typesafe/jev-latest" : "jev-latest");
    assert.match(body.state, /query/);
    assert.match(body.questions.result_0.instructions, /Evidence 0/);
    return Response.json({ answers: { result_0: { choice: "keep" } } });
  });
  for (const useOpenRouter of [false, true]) assert.equal((await judgeRagCandidates("query", [candidate(0)], { ...config, useOpenRouter })).matches.length, 1);
  t.mock.method(globalThis, "fetch", async () => Response.json({ answers: {} }));
  await assert.rejects(jevDecide(config, "query", { missing: {} }), /incomplete/);
});

test("repeat mode searches once, judges each Top K batch once and stops at the first confirmed match", async t => {
  let searches = 0; const judged: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return Response.json({ answers: Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
      const text = (question as { instructions: string }).instructions;
      const id = /Evidence (\d+)/.exec(text)![1]; judged.push(id);
      return [key, { choice: id === "3" ? "keep" : "exclude" }];
    })) });
  });
  const result = await searchAndJudgeRag({ query: "query", topK: 2, untilMatch: true, config, search: async limit => { searches++; assert.equal(limit, 1000); return Array.from({ length: 7 }, (_, i) => candidate(i)); } });
  assert.equal(searches, 1); assert.deepEqual(judged, ["0", "1", "2", "3"]);
  assert.deepEqual(result.results.map(hit => hit.chunkId), ["3"]); assert.equal(result.judgedCount, 4);
});

test("one-batch mode may return no matches; exhausted repeat terminates and reports the vector limit", async t => {
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => Response.json({ answers: Object.fromEntries(Object.keys(JSON.parse(String(init?.body)).questions).map(key => [key, { choice: "exclude" }])) }));
  for (const [repeat, count] of [[false, 2], [true, 5], [true, 1000]] as const) {
    const result = await searchAndJudgeRag({ query: "query", topK: 2, untilMatch: repeat, config, search: async limit => { assert.equal(limit, repeat ? 1000 : 2); return Array.from({ length: count }, (_, i) => candidate(i)); } });
    assert.equal(result.results.length, 0); assert.equal(result.judgedCount, count); assert.equal(result.candidateLimitReached, count === 1000);
  }
});

test("unconfigured Jev uses ordinary Top K retrieval without decision requests", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Unexpected decision request"));
  const result = await searchAndJudgeRag({ query: "query", topK: 3, untilMatch: true, config: null, search: async limit => { assert.equal(limit, 3); return [candidate(0)]; } });
  assert.equal(result.jevFiltered, false); assert.equal(result.results.length, 1);
  assert.equal(getJevConfig(DEFAULT_USER_SETTINGS, {}), null);
  assert.equal(getJevConfig({ ...DEFAULT_USER_SETTINGS, jev: { encryptedApiKey: "cipher", useOpenRouter: false } }, {}), null);
});

test("unchecked media is retained separately and never stops repeat mode as a confirmed match", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ answers: { result_0: { choice: "keep" } } }); });
  const result = await searchAndJudgeRag({ query: "query", topK: 1, untilMatch: true, config, search: async () => [candidate(0, "[Pdf: scan.pdf pages 1-2]"), candidate(1)] });
  assert.equal(calls, 1); assert.deepEqual(result.results.map(hit => hit.chunkId), ["1"]); assert.deepEqual(result.uncheckedIds, []);
  const unchecked = await searchAndJudgeRag({ query: "query", topK: 1, untilMatch: true, config, search: async () => [candidate(0, "[Audio: voice.mp3]")] });
  assert.equal(unchecked.judgedCount, 0); assert.deepEqual(unchecked.uncheckedIds, ["0"]);
});

test("private candidates never reach Jev and abort prevents search and further batches", async t => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(searchAndJudgeRag({ query: "query", topK: 1, untilMatch: true, config, signal: controller.signal, search: async () => assert.fail("aborted search") }), /abort/i);
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => { assert.doesNotMatch(String(init?.body), /PRIVATE/); return Response.json({ answers: { result_0: { choice: "keep" } } }); });
  const result = await searchAndJudgeRag({ query: "query", topK: 1, untilMatch: true, config, search: async () => [candidate(0, "PRIVATE"), candidate(1)], accept: hit => hit.chunkId !== "0" });
  assert.equal(result.results[0].chunkId, "1");
});

test("image candidates use bounded assets and image headers rather than treating filenames as evidence", async t => {
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(new Headers(init?.headers).get("TypeSafe-Danger-Zone-Images"), "true");
    assert.deepEqual(body.assets.image_0, { type: "image", format: "png", data_base64: "AA==" });
    return Response.json({ answers: { result_0: { choice: "exclude" } } });
  });
  const result = await judgeRagCandidates("query", [candidate(0, "[Image: photo.png]")], config, async () => ({ text: "image evidence", images: [{ type: "image", format: "png", data_base64: "AA==" }] }));
  assert.equal(result.matches.length, 0); assert.equal(result.unchecked.length, 0);
});

test("old global Top K migrates to each RAG; search preferences never change the index identity", () => {
  const old = { ...DEFAULT_RAG_SETTING }; delete old.topK; delete old.searchUntilMatch; delete old.jevRagFilterEnabled;
  const migrated = normalizeRagSettings({ old, custom: { ...old, topK: 7, jevRagFilterEnabled: false } }, 11);
  assert.equal(migrated.old.topK, 11); assert.equal(migrated.custom.topK, 7);
  assert.equal(migrated.old.jevRagFilterEnabled, true); assert.equal(migrated.custom.jevRagFilterEnabled, false);
  assert.equal(migrated.old.searchUntilMatch, false);
  assert.equal(resolveRagTopK({ topK: 0 }), 1); assert.equal(resolveRagTopK({ topK: 30 }), 20);
  assert.equal(ragIndexId("root", "index", old), ragIndexId("root", "index", { ...old, topK: 15, searchUntilMatch: true, jevRagFilterEnabled: false }));
});

test("an invalid Jev decision fails retrieval instead of accepting unverified text", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ answers: { result_0: { choice: "unknown" } } }));
  await assert.rejects(searchAndJudgeRag({ query: "query", topK: 1, untilMatch: true, config, search: async () => [candidate(0)] }), /invalid or incomplete/);
});

test("cancelling a completed decision batch prevents the next batch", async t => {
  const controller = new AbortController(); let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; controller.abort(); return Response.json({ answers: { result_0: { choice: "exclude" } } }); });
  await assert.rejects(searchAndJudgeRag({ query: "query", topK: 1, untilMatch: true, config, signal: controller.signal, search: async () => [candidate(0), candidate(1)] }), /abort/i);
  assert.equal(calls, 1);
});
