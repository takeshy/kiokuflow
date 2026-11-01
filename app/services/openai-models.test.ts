import assert from "node:assert/strict";
import test from "node:test";
import { discoverOpenAIModels } from "./openai.server";
import { action as configure } from "~/routes/api.openai.settings";
import { getAvailableModels, getConfiguredOpenAIModels, DEFAULT_USER_SETTINGS, type UserSettings } from "~/types/settings";
import { availableChatModels } from "~/hooks/chat-dispatch";
import { getTokens, setTokens, commitSession, type SessionTokens } from "./session.server";
import { clearSettingsCache } from "./user-settings.server";
import { SETTINGS_FILE_NAME } from "./sync-diff";

const catalogue = { data: [
  { id: "gpt-6.1-sol", created: 1700000000, owned_by: "openai" }, { id: "gpt-6.1-terra", created: 1700000001, owned_by: "openai" },
  { id: "gpt-6.1-terra" }, { id: "gpt-6-future-chat" }, { id: "gpt-realtime-2.1" }, { id: "gpt-audio-1.5" },
  { id: "text-embedding-3-small" }, { id: "gpt-image-2" }, { id: "o3-deep-research" },
  { id: "gpt-5-retired", shutdown_date: "2020-01-01" }, { id: "ft:gpt-6.1-sol:organization:custom:id", owned_by: "organization" },
] };
const baseTokens: SessionTokens = { rootFolderId: "openai-model-tests", accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiryTime: Date.now() + 3600_000, openaiApiKey: "synthetic-openai" };
async function request(body: unknown, overrides: Partial<SessionTokens> = {}, origin = "https://gemihub.example") {
  const session = await setTokens(new Request("https://gemihub.example"), { ...baseTokens, ...overrides });
  return new Request("https://gemihub.example/api/openai/settings", { method: "POST", headers: { Origin: origin, Cookie: (await commitSession(session)).split(";")[0], "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function args(request: Request) { return { request, params: {}, context: {} } as never; }

test("OpenAI model discovery uses the fixed authenticated list endpoint, filters specialized/retired models, and keeps basic information", async t => {
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => { assert.equal(String(input), "https://api.openai.com/v1/models"); assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-openai"); assert.equal(init?.method, undefined); return Response.json(catalogue); });
  const models = await discoverOpenAIModels("synthetic-openai");
  assert.deepEqual(models.map(model => model.id), ["ft:gpt-6.1-sol:organization:custom:id", "gpt-6-future-chat", "gpt-6.1-sol", "gpt-6.1-terra"]);
  assert.equal(models.find(model => model.id === "gpt-6.1-sol")?.ownedBy, "openai"); assert.equal(models.find(model => model.id === "gpt-6.1-sol")?.created, 1700000000);
});

test("enabled OpenAI selections control chat and workflow catalogues, including fetched model IDs and legacy settings", () => {
  const settings: UserSettings = { ...DEFAULT_USER_SETTINGS, openai: { encryptedApiKey: "cipher", salt: "salt", enabledModels: ["gpt-6.1-terra", "gpt-6-future-chat"], availableModels: [] } };
  assert.deepEqual(getConfiguredOpenAIModels(settings.openai).map(model => model.name), ["gpt-6.1-terra", "gpt-6-future-chat"]);
  const choices = availableChatModels(null, settings.apiPlan, settings).map(model => model.name);
  assert.ok(choices.includes("gpt-6.1-terra")); assert.ok(choices.includes("gpt-6-future-chat")); assert.ok(!choices.includes("gpt-6.1-sol"));
  assert.deepEqual(getAvailableModels("paid", true, undefined, { ...settings.openai!, enabledModels: [] }).filter(model => model.name.startsWith("gpt-")), []);
  assert.ok(getConfiguredOpenAIModels({ encryptedApiKey: "legacy", salt: "salt" }).some(model => model.name === "gpt-6.1-sol"));
});

test("model-only saving needs no encryption password and preserves saved ciphertext while retaining multiple models", async t => {
  clearSettingsCache();
  let settings: UserSettings = { ...DEFAULT_USER_SETTINGS, selectedModel: "gpt-6.1-sol", providerDefaultModels: { openai: "gpt-6.1-sol" }, openai: { encryptedApiKey: "unchanged-cipher", salt: "unchanged-salt" } };
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "settings", name: SETTINGS_FILE_NAME }] });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/settings")) return Response.json(settings);
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files/settings")) { writes++; settings = JSON.parse(String(init?.body)); return Response.json({ id: "settings" }); }
    assert.equal(url, "https://api.openai.com/v1/models"); return Response.json(catalogue);
  });
  const verified = await configure(args(await request({ action: "verify" })));
  assert.equal(verified.status, 200); assert.equal(verified.headers.get("Cache-Control"), "no-store"); assert.equal(writes, 0);
  assert.equal(JSON.stringify(await verified.json()).includes("synthetic-openai"), false);
  const saved = await configure(args(await request({ action: "saveModels", enabledModels: ["gpt-6.1-terra", "gpt-6-future-chat"] })));
  assert.equal(saved.status, 200); assert.equal(writes, 1);
  assert.equal(settings.openai?.encryptedApiKey, "unchanged-cipher"); assert.equal(settings.openai?.salt, "unchanged-salt");
  assert.deepEqual(settings.openai?.enabledModels, ["gpt-6.1-terra", "gpt-6-future-chat"]);
  assert.equal(settings.selectedModel, "gpt-6.1-terra"); assert.equal(settings.providerDefaultModels?.openai, "gpt-6.1-terra");
  for (const enabledModels of [[], ["gpt-nonexistent"], ["text-embedding-3-small"], [null]]) assert.equal((await configure(args(await request({ action: "saveModels", enabledModels })))).status, 400);
  assert.equal(writes, 1);
  const locked = await configure(args(await request({ action: "saveModels", enabledModels: ["gpt-6.1-sol"] }, { openaiApiKey: "" })));
  assert.equal(locked.status, 401);
  assert.equal((await configure(args(await request({ action: "verify", apiKey: "synthetic-entered" }, { openaiApiKey: "" })))).status, 200);
  const session = await setTokens(new Request("https://gemihub.example"), baseTokens);
  const tokens = await getTokens(new Request("https://gemihub.example", { headers: { Cookie: (await commitSession(session)).split(";")[0] } }));
  assert.equal(tokens?.openaiApiKey, "synthetic-openai");
});

test("new OpenAI keys can be saved with only the public key, without unlocking the previous key or sending a password", async t => {
  clearSettingsCache();
  const { configureCommonPassword } = await import("./api-key-password.server");
  const { decryptStoredApiKey } = await import("./api-key-crypto");
  const initial = await configureCommonPassword(DEFAULT_USER_SETTINGS, "unlock-password");
  let settings: UserSettings = { ...initial.settings, openai: { encryptedApiKey: "locked-previous-cipher", salt: "previous-salt" } };
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "settings", name: SETTINGS_FILE_NAME }] });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/settings")) return Response.json(settings);
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files/settings")) { settings = JSON.parse(String(init?.body)); return Response.json({ id: "settings" }); }
    assert.equal(url, "https://api.openai.com/v1/models"); assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer newly-entered-key"); return Response.json(catalogue);
  });
  const saved = await configure(args(await request({ action: "save", apiKey: "newly-entered-key", enabledModels: ["gpt-6.1-sol", "gpt-6.1-terra"] }, { openaiApiKey: "" })));
  assert.equal(saved.status, 200);
  assert.equal(await decryptStoredApiKey(settings.openai, "unlock-password", settings.encryption), "newly-entered-key");
  assert.ok(settings.openai?.encryptedApiKey.startsWith("rsa-v1:"));
  assert.deepEqual(settings.openai?.enabledModels, ["gpt-6.1-sol", "gpt-6.1-terra"]);
});
