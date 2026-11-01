import { decryptStoredApiKey } from "./api-key-crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { action as chat } from "~/routes/api.ai-providers.$provider.chat";
import { action as configure } from "~/routes/api.ai-providers.$provider.settings";
import { getTokens, setTokens, commitSession, type SessionTokens } from "./session.server";
import { clearSettingsCache } from "./user-settings.server";
import { discoverCompatibleModels } from "./compatible-provider.server";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "~/types/settings";
import { SETTINGS_FILE_NAME } from "./sync-diff";

const baseTokens: SessionTokens = { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiryTime: Date.now() + 3600_000, rootFolderId: "compatible-tests", compatibleApiKeys: { openrouter: "synthetic-router", opencodego: "synthetic-go" } };
async function request(body: unknown, overrides: Partial<SessionTokens> = {}, origin = "https://gemihub.example") {
  const session = await setTokens(new Request("https://gemihub.example"), { ...baseTokens, ...overrides });
  return new Request("https://gemihub.example/api/ai-providers/test", { method: "POST", headers: { Origin: origin, Cookie: (await commitSession(session)).split(";")[0], "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function args(request: Request, provider = "openrouter") { return { request, params: { provider }, context: {} } as never; }
const body = { model: "vendor/model", messages: [{ role: "user", content: "hello" }], sessionId: "conversation-one" };

test("proxy authenticates with the selected provider, fixes its destination and preserves streaming", async t => {
  clearSettingsCache();
  const settings = { ...DEFAULT_USER_SETTINGS, compatibleProviders: { openrouter: { encryptedApiKey: "cipher", salt: "salt", availableModels: [], enabledModels: ["vendor/model"] } } };
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "settings", name: SETTINGS_FILE_NAME }] });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/settings")) return Response.json(settings);
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-router");
    const sent = JSON.parse(String(init?.body));
    assert.equal(sent.apiKey, undefined); assert.equal(sent.baseUrl, undefined); assert.equal(sent.sessionId, undefined);
    assert.equal(sent.stream, true); assert.deepEqual(sent.plugins, [{ id: "web" }]);
    return new Response("data: synthetic-event\n\n");
  });
  const response = await chat(args(await request({ ...body, baseUrl: "https://attacker.invalid", apiKey: "attacker", webSearch: true })));
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(await response.text(), "data: synthetic-event\n\n");
  const disabled = await chat(args(await request({ ...body, model: "disabled/model" })));
  assert.equal(disabled.status, 400);
});

test("provider endpoints reject locked keys, org mounts, unknown providers and cross-origin requests", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Rejected request reached network"));
  for (const [overrides, origin, provider, status] of [
    [{ compatibleApiKeys: {} }, "https://gemihub.example", "openrouter", 401],
    [{ currentProjectId: "project" }, "https://gemihub.example", "openrouter", 403],
    [{}, "https://attacker.invalid", "openrouter", 403],
    [{}, "https://gemihub.example", "custom", 404],
  ] as const) {
    await assert.rejects(chat(args(await request(body, overrides, origin), provider)), (error: unknown) => error instanceof Response && error.status === status);
  }
});

test("a public Go catalog cannot validate a rejected API key; routing headers identify GemiHub", async t => {
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-opencode-session"), "test-conversation");
    assert.equal(headers.get("User-Agent"), "gemihub/1.0");
    if (String(input).endsWith("/models")) return Response.json({ data: [{ id: "glm-5.3" }] });
    assert.equal(String(input), "https://opencode.ai/zen/go/v1/chat/completions");
    return Response.json({ error: { message: "bad key" } }, { status: 403 });
  });
  await assert.rejects(discoverCompatibleModels("opencodego", "synthetic-invalid", "test-conversation"), (error: unknown) => error instanceof Response && error.status === 403);
});

test("credentials are encrypted at rest, isolated per provider, and lock/unlock without losing saved models", async t => {
  clearSettingsCache();
  let settings: UserSettings = { ...DEFAULT_USER_SETTINGS, systemPrompt: "preserve-me" };
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "credentials", name: SETTINGS_FILE_NAME }] });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/credentials")) return Response.json(settings);
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files/credentials")) { settings = JSON.parse(String(init?.body)); return Response.json({ id: "credentials", name: SETTINGS_FILE_NAME }); }
    if (url === "https://openrouter.ai/api/v1/models") return Response.json({ data: [{ id: "vendor/model", name: "Model" }] });
    if (url === "https://openrouter.ai/api/v1/key") return Response.json({ data: {} });
    assert.fail(`Unexpected request: ${url}`);
  });
  const saved = await configure(args(await request({ action: "save", apiKey: "new-router-key", password: "provider-password", enabledModels: ["vendor/model"] })));
  assert.equal(saved.status, 200);
  assert.equal(settings.systemPrompt, "preserve-me");
  const config = settings.compatibleProviders!.openrouter!;
  assert.notEqual(config.encryptedApiKey, "new-router-key");
  assert.equal(await decryptStoredApiKey(config, "provider-password", settings.encryption), "new-router-key");
  assert.deepEqual(config.enabledModels, ["vendor/model"]);
  const cookie = saved.headers.get("Set-Cookie")!.split(";")[0];
  const savedTokens = await getTokens(new Request("https://gemihub.example", { headers: { Cookie: cookie } }));
  assert.equal(savedTokens?.compatibleApiKeys?.openrouter, "new-router-key");
  assert.equal(savedTokens?.compatibleApiKeys?.opencodego, "synthetic-go");
  assert.equal(JSON.stringify(await saved.json()).includes("new-router-key"), false);
  const passwordless = await configure(args(await request({ action: "save", apiKey: "replaced-with-public-key", enabledModels: ["vendor/model"] }, { compatibleApiKeys: {} })));
  assert.equal(passwordless.status, 200);
  assert.equal(await decryptStoredApiKey(settings.compatibleProviders!.openrouter, "provider-password", settings.encryption), "replaced-with-public-key");
  const cipherBeforeModelSave = settings.compatibleProviders!.openrouter!.encryptedApiKey;
  const modelOnly = await configure(args(await request({ action: "save", enabledModels: ["vendor/model"] })));
  assert.equal(modelOnly.status, 200);
  assert.equal(settings.compatibleProviders!.openrouter!.encryptedApiKey, cipherBeforeModelSave);
  const locked = await configure(args(await request({ action: "lock" }, { compatibleApiKeys: savedTokens!.compatibleApiKeys })));
  const lockedTokens = await getTokens(new Request("https://gemihub.example", { headers: { Cookie: locked.headers.get("Set-Cookie")!.split(";")[0] } }));
  assert.equal(lockedTokens?.compatibleApiKeys?.openrouter, undefined);
  assert.equal(lockedTokens?.compatibleApiKeys?.opencodego, "synthetic-go");
  const wrong = await configure(args(await request({ action: "unlock", password: "wrong" }, { compatibleApiKeys: {} })));
  assert.equal(wrong.status, 401);
  const unlocked = await configure(args(await request({ action: "unlock", password: "provider-password" }, { compatibleApiKeys: {} })));
  assert.equal(unlocked.status, 200);
  const changedRoot = await setTokens(new Request("https://gemihub.example", { headers: { Cookie: cookie } }), { ...baseTokens, rootFolderId: "different-root", compatibleApiKeys: savedTokens!.compatibleApiKeys });
  const rootTokens = await getTokens(new Request("https://gemihub.example", { headers: { Cookie: (await commitSession(changedRoot)).split(";")[0] } }));
  assert.equal(rootTokens?.compatibleApiKeys?.openrouter, undefined);
});
