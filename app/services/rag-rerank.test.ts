import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_USER_SETTINGS } from "~/types/settings";
import { resolveRerankConfig, searchAndRerankRag, type RerankConfig } from "./rag-rerank.server";
import { normalizeRagSettings, resolveRerankProvider } from "./rag-search-options";
import { DEFAULT_RAG_SETTING } from "~/types/settings";
import { createRagKeywordIndex, fuseRagRanks, rankRagKeywords, tokenizeRagText } from "./rag-hybrid";

const candidate = (id: number, text = `Evidence ${id}`) => ({ chunkId: String(id), docPath: `Notes/${id}.md`, text });
const config: RerankConfig = { provider: "gemini", apiKey: "gemini-only" };
const options = { query: "query", topK: 3, untilMatch: false, provider: "gemini" as const, config };
const answers = (init: RequestInit | undefined, score: (key: string) => number) => Response.json({ answers: Object.fromEntries(Object.keys(JSON.parse(String(init?.body)).questions).map(key => [key, { type: "score", score: score(key) }])) });

test("unselected and invalid providers are OFF even with stored keys; hybrid defaults ON", async t => {
  assert.equal(resolveRerankProvider(), "off");
  assert.equal(resolveRerankProvider({ rerankProvider: "obsolete" as never }), "off");
  assert.equal(normalizeRagSettings({ old: { ...DEFAULT_RAG_SETTING, rerankProvider: undefined, hybridSearch: undefined } }).old.rerankProvider, "off");
  assert.equal(normalizeRagSettings({ old: DEFAULT_RAG_SETTING }).old.hybridSearch, true);
  t.mock.method(globalThis, "fetch", () => assert.fail("OFF must not call a decision API"));
  const result = await searchAndRerankRag({ ...options, provider: "off", untilMatch: true, search: async limit => { assert.equal(limit, 3); return [candidate(0)]; } });
  assert.equal(result.reranked, false); assert.deepEqual(result.warnings, []);
  const tokens = { jevApiKey: "jev-only", geminiApiKey: "gemini-only", compatibleApiKeys: { openrouter: "router-only" } };
  assert.equal(resolveRerankConfig("off", DEFAULT_USER_SETTINGS, tokens), null);
  assert.equal(resolveRerankConfig("gemini", DEFAULT_USER_SETTINGS, { jevApiKey: "jev-only" }), null);
  assert.equal(resolveRerankConfig("gemini", DEFAULT_USER_SETTINGS, tokens)?.apiKey, "gemini-only");
});

test("Gemini, direct Jev and OpenRouter use their own endpoints, credentials and score contracts", async t => {
  for (const provider of ["gemini", "jev", "router"] as const) {
    const selected: RerankConfig = { provider: provider === "gemini" ? "gemini" : "jev", apiKey: `${provider}-key`, useOpenRouter: provider === "router" };
    const mock = t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
      assert.equal(String(url), provider === "gemini" ? "https://generativelanguage.googleapis.com/v1beta/decisions" : provider === "router" ? "https://openrouter.ai/api/alpha/decisions" : "https://api.typesafe.ai/v1/systemone");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-goog-api-key"), provider === "gemini" ? "gemini-key" : null);
      assert.equal(headers.get("Authorization"), provider === "gemini" ? null : `Bearer ${provider}-key`);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, provider === "gemini" ? "gemini-decision-1" : provider === "router" ? "~typesafe/jev-latest" : "jev-latest");
      assert.equal(body.questions.result_0.type, "score"); assert.equal(body.questions.result_0.criteria.length, 4);
      return answers(init, key => key === "result_1" ? 2.8 : 0.5);
    });
    const result = await searchAndRerankRag({ ...options, provider: selected.provider, config: selected, search: async () => [candidate(0), candidate(1)] });
    assert.deepEqual(result.results.map(hit => hit.chunkId), ["1", "0"]);
    assert.equal(result.results[0].rerankScore, 2.8); assert.equal(result.reranked, true);
    mock.mock.restore();
  }
});

test("unscorable media stays at its original rank and only returned media is marked unchecked", async t => {
  t.mock.method(globalThis, "fetch", async (_: unknown, init?: RequestInit) => answers(init, key => key === "result_2" ? 3 : 0));
  const result = await searchAndRerankRag({ ...options, search: async () => [candidate(0), candidate(1, "[Audio: voice.mp3]"), candidate(2), candidate(3, "[Video: clip.mp4]")] });
  assert.deepEqual(result.results.map(hit => hit.chunkId), ["2", "1", "0"]);
  assert.deepEqual(result.uncheckedIds, ["1"]); assert.equal(result.results[1].rerankScore, undefined);
  assert.equal(result.warnings.length, 1);
});

test("partial/invalid scores and missing selected key return original ranking with a warning", async t => {
  const candidates = [candidate(0), candidate(1)];
  t.mock.method(globalThis, "fetch", async () => Response.json({ answers: { result_0: { type: "score", score: 3 } } }));
  for (const selected of [config, null]) {
    const result = await searchAndRerankRag({ ...options, config: selected, search: async () => candidates });
    assert.deepEqual(result.results, candidates); assert.equal(result.reranked, false);
    assert.equal(result.warnings.length, 1); assert.equal(result.results[0].rerankScore, undefined);
  }
});

test("repeat retrieves once, scores batches of 40 and stops at the first score >= 2", async t => {
  let searches = 0, requests = 0;
  t.mock.method(globalThis, "fetch", async (_: unknown, init?: RequestInit) => { requests++; return answers(init, key => requests === 2 && key === "result_1" ? 2 : 1.9); });
  const result = await searchAndRerankRag({ ...options, untilMatch: true, search: async limit => { searches++; assert.equal(limit, 1000); return Array.from({ length: 100 }, (_, i) => candidate(i)); } });
  assert.equal(searches, 1); assert.equal(requests, 2); assert.equal(result.judgedCount, 80);
  assert.deepEqual(result.results.map(hit => hit.chunkId), ["41"]);
});

test("repeat never treats unscorable media as a miss, and later failure restores first retrieval results", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_: unknown, init?: RequestInit) => { calls++; return calls === 2 ? new Response(null, { status: 400 }) : answers(init, () => 0); });
  const candidates = Array.from({ length: 80 }, (_, i) => candidate(i));
  const result = await searchAndRerankRag({ ...options, untilMatch: true, search: async () => candidates });
  assert.deepEqual(result.results, candidates.slice(0, 3)); assert.match(result.warnings.join(" "), /Returning original/);
  const media = await searchAndRerankRag({ ...options, untilMatch: true, search: async () => [candidate(0, "[Image: scan.png]")] });
  assert.equal(media.results.length, 1); assert.equal(media.reranked, false); assert.match(media.warnings.join(" "), /Stopped/);
  assert.match(media.results[0].rerankSkippedReason!, /Content unavailable/);
  assert.deepEqual(media.uncheckedIds, ["0"]);
});

test("repeat fallback keeps retrieval order and skipped metadata without retaining partial scores", async t => {
  t.mock.method(globalThis, "fetch", async (_: unknown, init?: RequestInit) => answers(init, key => key === "result_2" ? 3 : 0));
  const candidates = [candidate(0), candidate(1, "[Image: scan.png]"), candidate(2), candidate(3, "[Audio: voice.mp3]")];
  const result = await searchAndRerankRag({ ...options, untilMatch: true, search: async () => candidates });
  assert.deepEqual(result.results.map(hit => hit.chunkId), ["0", "1", "2"]);
  assert.deepEqual(result.uncheckedIds, ["1"]);
  assert.match(result.results[1].rerankSkippedReason!, /Content unavailable/);
  assert.ok(result.results.every(hit => hit.rerankScore === undefined));
  assert.equal(result.reranked, false);
});

test("reusable BM25 frequencies tokenize accepted documents once and reapply path permissions", () => {
  let reads = 0;
  const visible = { chunkId: "visible", get text() { reads++; return "E02 保存方法"; } };
  const hidden = { chunkId: "hidden", get text(): string { assert.fail("Private text was tokenized"); } };
  const index = createRagKeywordIndex([visible, hidden]);
  for (const query of ["E02", "保存"]) assert.equal(index.rank(query, 5, hit => hit.chunkId === "visible")[0].candidate, visible);
  assert.equal(reads, 1);
  assert.deepEqual(index.rank("E02", 5, () => false), []);
});

test("private content is excluded before scoring and cancellation propagates", async t => {
  t.mock.method(globalThis, "fetch", async (_: unknown, init?: RequestInit) => { assert.doesNotMatch(String(init?.body), /PRIVATE/); return answers(init, () => 2); });
  const result = await searchAndRerankRag({ ...options, search: async () => [candidate(0, "PRIVATE"), candidate(1)], accept: hit => hit.chunkId !== "0" });
  assert.deepEqual(result.results.map(hit => hit.chunkId), ["1"]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(searchAndRerankRag({ ...options, signal: controller.signal, search: async () => assert.fail("aborted search") }));
});

test("BM25 recovers exact identifiers and Japanese terms outside the vector pool; RRF deduplicates chunks", () => {
  assert.ok(tokenizeRagText("ＰＲＪ-１２３ 保存方法").includes("prj-123"));
  const corpus = [candidate(0, "unrelated semantic hit"), candidate(1, "E02 保存方法"), candidate(2, "another note")];
  assert.equal(rankRagKeywords("E02", corpus, 5)[0].candidate.chunkId, "1");
  assert.equal(rankRagKeywords("保存", corpus, 5)[0].candidate.chunkId, "1");
  const hits = fuseRagRanks([corpus[0], corpus[2], corpus[2]], [corpus[1], corpus[2]], 5);
  assert.equal(hits[0].chunkId, "2"); assert.equal(hits[0].retrievalSource, "both"); assert.equal(hits.length, 3);
  assert.equal(hits.find(hit => hit.chunkId === "1")?.retrievalSource, "bm25");
});

for (const provider of ["gemini", "jev"] as const) {
  const apiKey = process.env[provider === "gemini" ? "KIOKUFLOW_TEST_GEMINI_KEY" : "KIOKUFLOW_TEST_JEV_KEY"];
  test(`${provider} API integration scores and finds the relevant passage`, { skip: !apiKey }, async () => {
    for (const untilMatch of [false, true]) {
      const result = await searchAndRerankRag({ ...options, query: "What is the capital of Japan?", provider, config: { provider, apiKey: apiKey! }, untilMatch, search: async () => [candidate(0, "Bananas are yellow fruit."), candidate(1, "Tokyo is the capital of Japan.")] });
      assert.deepEqual(result.warnings, []);
      assert.equal(result.results[0].chunkId, "1"); assert.ok(result.results[0].rerankScore! >= 2);
      if (untilMatch) assert.equal(result.results.length, 1);
    }
  });
}
