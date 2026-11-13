import assert from "node:assert/strict";
import test from "node:test";
import { action } from "~/routes/settings";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "~/types/settings";
import { configureCommonPassword } from "./api-key-password.server";
import { decryptStoredApiKey } from "./api-key-crypto";
import { setTokens, commitSession, getTokens } from "./session.server";
import { clearSettingsCache } from "./user-settings.server";
import { SETTINGS_FILE_NAME } from "./sync-diff";
import { createProviderSettingsDrafts, serializeProviderSettingsDrafts } from "./provider-settings-drafts";
import { prepareProviderSettingsSave } from "./provider-settings-save.server";

async function request(drafts: unknown, extra: Record<string, string> = {}) {
  const session = await setTokens(new Request("https://kiokuflow.example"), { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiryTime: Date.now() + 3600_000, rootFolderId: "provider-form-test" });
  const form = new FormData();
  for (const [key, value] of Object.entries({ _action: "saveGeneral", settingsSection: "ai", apiPlan: "paid", providerDrafts: JSON.stringify(drafts), ...extra })) form.set(key, value);
  return new Request("https://kiokuflow.example/settings", { method: "POST", headers: { Origin: "https://kiokuflow.example", Cookie: (await commitSession(session)).split(";")[0] }, body: form });
}
const args = (request: Request) => ({ request, params: {}, context: {} }) as never;
const drafts = {
  openai: { apiKey: "new-openai", enabledModels: ["gpt-6.1-sol"] },
  openrouter: { apiKey: "new-router", enabledModels: ["vendor/model"] },
  opencodego: { apiKey: "new-go", enabledModels: ["go/model"] },
  jev: { apiKey: "new-jev", enabledModels: [], useOpenRouter: false },
};

for (const fail of [false, true]) test(`one form Save ${fail ? "keeps all provider settings unchanged on a late verification failure" : "encrypts and saves all four providers and activates newly enabled models"}`, async t => {
  clearSettingsCache();
  const initialized = await configureCommonPassword(DEFAULT_USER_SETTINGS, "encryption-password");
  let settings: UserSettings = { ...initialized.settings, apiPlan: "paid" };
  const original = JSON.stringify(settings); let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "settings", name: SETTINGS_FILE_NAME }] });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/settings")) return Response.json(settings);
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files/settings")) { writes++; settings = JSON.parse(String(init?.body)); return Response.json({ id: "settings" }); }
    if (url === "https://api.openai.com/v1/models") return Response.json({ data: [{ id: "gpt-6.1-sol" }, { id: "text-embedding-3-small" }] });
    if (url === "https://openrouter.ai/api/v1/models") return Response.json({ data: [{ id: "vendor/model", name: "Router model" }] });
    if (url === "https://openrouter.ai/api/v1/key") return Response.json({ data: {} });
    if (url === "https://opencode.ai/zen/go/v1/models") return Response.json({ data: [{ id: "go/model", name: "Go model" }] });
    if (url === "https://opencode.ai/zen/go/v1/chat/completions") return Response.json({ error: "Messages required" }, { status: 400 });
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer new-jev");
    return fail ? Response.json({ error: "Invalid key" }, { status: 401 }) : Response.json({ answers: { check: { choice: "keep" } } });
  });
  const response = await action(args(await request(drafts, { selectedModel: "opencodego:go/model", providerDefaultModels: JSON.stringify({ openai: "gpt-6.1-sol", openrouter: "openrouter:vendor/model", opencodego: "opencodego:go/model" }) })));
  const body = await response.json();
  assert.equal(body.success, !fail);
  if (fail) { assert.equal(writes, 0); assert.equal(JSON.stringify(settings), original); return; }
  assert.equal(writes, 1); assert.equal(settings.selectedModel, "opencodego:go/model");
  assert.equal(settings.providerDefaultModels?.openai, "gpt-6.1-sol");
  for (const [saved, key] of [[settings.openai, "new-openai"], [settings.jev, "new-jev"], [settings.compatibleProviders?.openrouter, "new-router"], [settings.compatibleProviders?.opencodego, "new-go"]] as const) assert.equal(await decryptStoredApiKey(saved, "encryption-password", settings.encryption), key);
  const tokens = await getTokens(new Request("https://kiokuflow.example", { headers: { Cookie: response.headers.get("Set-Cookie")!.split(";")[0] } }));
  assert.equal(tokens?.openaiApiKey, "new-openai"); assert.equal(tokens?.jevApiKey, "new-jev");
  assert.equal(tokens?.compatibleApiKeys?.openrouter, "new-router"); assert.equal(tokens?.compatibleApiKeys?.opencodego, "new-go");
  assert.doesNotMatch(JSON.stringify(body), /new-openai|new-jev|new-router|new-go|encryptedApiKey/);
  assert.ok(Object.values(body.providerDrafts).every((draft: unknown) => (draft as { apiKey: string; dirty: boolean }).apiKey === "" && !(draft as { dirty: boolean }).dirty));
});

test("only dirty provider drafts are submitted and shared Save supports embedding-only selections", async t => {
  const draft = createProviderSettingsDrafts(DEFAULT_USER_SETTINGS);
  assert.deepEqual(JSON.parse(serializeProviderSettingsDrafts(draft)), {});
  draft.openai = { ...draft.openai, apiKey: "embedding-key", dirty: true };
  assert.deepEqual(JSON.parse(serializeProviderSettingsDrafts(draft)), { openai: { apiKey: "embedding-key", enabledModels: [] } });
  clearSettingsCache();
  const initialized = await configureCommonPassword(DEFAULT_USER_SETTINGS, "encryption-password");
  let settings = initialized.settings;
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "settings", name: SETTINGS_FILE_NAME }] });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/settings")) return Response.json(settings);
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files/settings")) { settings = JSON.parse(String(init?.body)); return Response.json({ id: "settings" }); }
    assert.equal(url, "https://api.openai.com/v1/models"); return Response.json({ data: [{ id: "text-embedding-3-small" }] });
  });
  const response = await action(args(await request(JSON.parse(serializeProviderSettingsDrafts(draft)), { providerDefaultModels: JSON.stringify({ openai: "" }) })));
  assert.equal((await response.json()).success, true);
  assert.deepEqual(settings.openai?.enabledModels, []);
  assert.equal(settings.providerDefaultModels?.openai, "");
});

test("Jev can use an OpenRouter key configured in the same Save without enabling chat", async t => {
  const initialized = await configureCommonPassword(DEFAULT_USER_SETTINGS, "encryption-password");
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer new-router");
    if (url.endsWith("/models")) return Response.json({ data: [{ id: "vendor/model", name: "Model" }] });
    if (url.endsWith("/key")) return Response.json({});
    assert.equal(url, "https://openrouter.ai/api/alpha/decisions");
    return Response.json({ answers: { check: { choice: "keep" } } });
  });
  const result = await prepareProviderSettingsSave(initialized.settings, { accessToken: "", refreshToken: "", expiryTime: 0, rootFolderId: "root" }, JSON.stringify({ openrouter: { apiKey: "new-router", enabledModels: [] }, jev: { apiKey: "", enabledModels: [], useOpenRouter: true } }));
  assert.equal(result.settings.jev?.useOpenRouter, true);
  assert.deepEqual(result.settings.compatibleProviders?.openrouter?.enabledModels, []);
  assert.equal(result.keys.compatibleApiKeys.openrouter, "new-router");
  assert.equal(initialized.settings.compatibleProviders?.openrouter, undefined);
});
