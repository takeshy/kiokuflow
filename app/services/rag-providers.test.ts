import assert from "node:assert/strict";
import test from "node:test";
import { loader, action } from "~/routes/api.rag.providers";
import { setTokens, commitSession, type SessionTokens } from "./session.server";
import { clearSettingsCache } from "./user-settings.server";
import { describeRagConnections } from "./rag-providers.server";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "~/types/settings";
import { SETTINGS_FILE_NAME } from "./sync-diff";

const baseTokens: SessionTokens = { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiryTime: Date.now() + 3600_000, rootFolderId: "rag-providers", geminiApiKey: "synthetic-gemini", openaiApiKey: "synthetic-openai", jevApiKey: "synthetic-jev", compatibleApiKeys: { openrouter: "synthetic-router" } };
async function request(body?: unknown, overrides: Partial<SessionTokens> = {}) {
  const session = await setTokens(new Request("https://kiokuflow.example"), { ...baseTokens, ...overrides });
  return new Request("https://kiokuflow.example/api/rag/providers", { method: body ? "POST" : "GET", headers: { Origin: "https://kiokuflow.example", Cookie: (await commitSession(session)).split(";")[0], "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const args = (request: Request) => ({ request, params: {}, context: {} }) as never;
const settings: UserSettings = { ...DEFAULT_USER_SETTINGS, encryptedApiKey: "gemini-cipher", openai: { encryptedApiKey: "openai-cipher", salt: "salt", enabledModels: [] }, jev: { encryptedApiKey: "jev-cipher", salt: "salt" }, compatibleProviders: { openrouter: { encryptedApiKey: "router-cipher", salt: "salt", availableModels: [], enabledModels: [] } } };
function settingsResponse(input: unknown, value = settings) {
  const url = String(input);
  if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "settings", name: SETTINGS_FILE_NAME }] });
  if (url.startsWith("https://www.googleapis.com/drive/v3/files/settings")) return Response.json(value);
}

test("connection status separates missing and locked keys, fingerprints changes and exposes no credentials", async t => {
  clearSettingsCache();
  t.mock.method(globalThis, "fetch", async input => settingsResponse(input) ?? assert.fail("Status check contacted a provider"));
  const response = await loader(args(await request(undefined, { geminiApiKey: undefined, jevApiKey: undefined })));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const text = await response.text();
  assert.doesNotMatch(text, /synthetic|cipher/);
  const status = JSON.parse(text);
  assert.equal(status.reranking.gemini.state, "locked");
  assert.equal(status.reranking.gemini.settingsHref, "/settings?tab=general");
  assert.equal(status.embedding.openai.state, "ready");
  assert.equal(status.reranking.jev.state, "locked");
  const missing = describeRagConnections(DEFAULT_USER_SETTINGS, { rootFolderId: "root" });
  assert.equal(missing.reranking.jev.state, "missing");
  assert.equal(missing.reranking.gemini.settingsHref, "/settings?tab=ai&provider=apikey");
  assert.notEqual(describeRagConnections(settings, baseTokens).reranking.gemini.id, describeRagConnections(settings, { ...baseTokens, geminiApiKey: "different-key" }).reranking.gemini.id);
});

test("verification uses the actual selected Gemini, direct Jev or Router scoring connection", async t => {
  for (const provider of ["gemini", "jev", "router"] as const) {
    clearSettingsCache();
    const value = { ...settings, jev: { ...settings.jev, useOpenRouter: provider === "router" } };
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
      const saved = settingsResponse(input, value); if (saved) return saved;
      calls++;
      assert.equal(String(input), provider === "gemini" ? "https://generativelanguage.googleapis.com/v1beta/decisions" : provider === "router" ? "https://openrouter.ai/api/alpha/decisions" : "https://api.typesafe.ai/v1/systemone");
      const headers = new Headers(init?.headers);
      assert.equal(provider === "gemini" ? headers.get("x-goog-api-key") : headers.get("Authorization"), provider === "gemini" ? "synthetic-gemini" : `Bearer synthetic-${provider}`);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.questions.result_0.type, "score");
      return Response.json({ answers: { result_0: { type: "score", score: 3 } } });
    });
    const selected = provider === "gemini" ? "gemini" : "jev";
    const connectionId = describeRagConnections(value, baseTokens).reranking[selected].id;
    const result = await action(args(await request({ action: "verify", provider: selected, connectionId, apiKey: "must-not-use-client-key" })));
    assert.equal(result.status, 200); assert.equal(calls, 1);
    assert.deepEqual(await result.json(), { ok: true, connectionId });
    mock.mock.restore();
  }
});

test("stale, locked and malformed requests do not call scoring APIs; invalid scores fail verification", async t => {
  clearSettingsCache();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async input => { const saved = settingsResponse(input); if (saved) return saved; calls++; return Response.json({ answers: {} }); });
  assert.equal((await action(args(await request({ action: "verify", provider: "gemini", connectionId: "0".repeat(64) })))).status, 409);
  assert.equal((await action(args(await request({ action: "verify", provider: "gemini" }, { geminiApiKey: undefined })))).status, 401);
  for (const body of [{ action: "verify", provider: "openai" }, { action: "embedding-models", provider: "jev" }, { action: "verify", provider: "other" }]) assert.equal((await action(args(await request(body)))).status, 400);
  assert.equal(calls, 0);
  assert.equal((await action(args(await request({ action: "verify", provider: "gemini" })))).status, 502);
  assert.equal(calls, 1);
});

test("embedding catalogues paginate Gemini, keep unsupported models disabled, and never enable chat models", async t => {
  clearSettingsCache();
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const saved = settingsResponse(input); if (saved) return saved;
    const url = new URL(String(input)); urls.push(url.href);
    if (url.hostname === "generativelanguage.googleapis.com") {
      assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "synthetic-gemini");
      return Response.json(url.searchParams.has("pageToken")
        ? { models: [{ name: "models/future-embedding", supportedGenerationMethods: ["embedContent"] }] }
        : { models: [{ name: "models/gemini-embedding-2", supportedGenerationMethods: ["embedContent"] }, { name: "models/chat", supportedGenerationMethods: ["generateContent"] }], nextPageToken: "page-two" });
    }
    assert.equal(url.href, "https://api.openai.com/v1/models");
    return Response.json({ data: [{ id: "gpt-example" }, { id: "text-embedding-3-small" }, { id: "text-embedding-future" }] });
  });
  for (const provider of ["gemini", "openai"] as const) {
    const result = await action(args(await request({ action: "embedding-models", provider })));
    assert.equal(result.status, 200);
    const { models } = await result.json();
    assert.equal(models.length, 2);
    assert.equal(models.filter((model: { supported: boolean }) => model.supported).length, 1);
    assert.ok(models.every((model: { id: string }) => !/chat|gpt/.test(model.id)));
  }
  assert.equal(urls.length, 3);
  assert.deepEqual(settings.openai?.enabledModels, []);
});
