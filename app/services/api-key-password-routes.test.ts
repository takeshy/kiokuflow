import assert from "node:assert/strict";
import test from "node:test";
import { action } from "~/routes/api.settings.api-key-password";
import { configureCommonPassword } from "./api-key-password.server";
import { encryptPrivateKey, decryptPrivateKey } from "./crypto-core";
import { getTokens, setTokens, commitSession, type SessionTokens } from "./session.server";
import { clearSettingsCache } from "./user-settings.server";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "~/types/settings";
import { SETTINGS_FILE_NAME } from "./sync-diff";

const baseTokens: SessionTokens = { rootFolderId: "common-password-tests", accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiryTime: Date.now() + 3600_000 };
async function request(body: unknown, tokens = baseTokens, origin = "https://gemihub.example") {
  const session = await setTokens(new Request("https://gemihub.example"), tokens);
  return new Request("https://gemihub.example/api/settings/api-key-password", { method: "POST", headers: { Origin: origin, Cookie: (await commitSession(session)).split(";")[0], "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function args(request: Request) { return { request, params: {}, context: {} } as never; }
async function tokenResponse(response: Response) { return getTokens(new Request("https://gemihub.example", { headers: { Cookie: response.headers.get("Set-Cookie")!.split(";")[0] } })); }
async function protect(key: string) { const encrypted = await encryptPrivateKey(key, "common-password"); return { encryptedApiKey: encrypted.encryptedPrivateKey, salt: encrypted.salt }; }

test("one General unlock/rotation/lock handles every provider without exposing keys or partial writes", async t => {
  clearSettingsCache();
  const first = await configureCommonPassword(DEFAULT_USER_SETTINGS, "common-password"); const gemini = await protect("synthetic-gemini");
  let settings: UserSettings = { ...first.settings, encryptedApiKey: gemini.encryptedApiKey, apiKeySalt: gemini.salt, openai: await protect("synthetic-openai"), jev: { ...await protect("synthetic-jev"), useOpenRouter: false }, compatibleProviders: { openrouter: { ...await protect("synthetic-router"), enabledModels: ["vendor/model"], availableModels: [] }, opencodego: { ...await protect("synthetic-go"), enabledModels: ["go/model"], availableModels: [] } } };
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "credentials", name: SETTINGS_FILE_NAME }] });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/credentials")) return Response.json(settings);
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files/credentials")) { writes++; settings = JSON.parse(String(init?.body)); return Response.json({ id: "credentials" }); }
    assert.fail(`Unexpected network ${url}`);
  });
  const unlocked = await action(args(await request({ action: "unlock", password: "common-password" })));
  assert.equal(unlocked.status, 200); assert.equal(unlocked.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await unlocked.json(), { ok: true, unlocked: true });
  const tokens = (await tokenResponse(unlocked))!;
  assert.equal(tokens.geminiApiKey, "synthetic-gemini"); assert.equal(tokens.openaiApiKey, "synthetic-openai"); assert.equal(tokens.jevApiKey, "synthetic-jev");
  assert.deepEqual(tokens.compatibleApiKeys, { openrouter: "synthetic-router", opencodego: "synthetic-go" }); assert.equal(writes, 0);
  const before = JSON.stringify(settings);
  const wrong = await action(args(await request({ action: "change", password: "incorrect", newPassword: "next-password", confirmPassword: "next-password" }, tokens)));
  assert.equal(wrong.status, 400); assert.equal(JSON.stringify(settings), before); assert.equal(writes, 0);
  const changed = await action(args(await request({ action: "change", password: "common-password", newPassword: "next-password", confirmPassword: "next-password" }, tokens)));
  assert.equal(changed.status, 200); assert.equal(writes, 1); assert.equal(settings.encryption.publicKey, first.settings.encryption.publicKey);
  assert.equal(await decryptPrivateKey(settings.openai!.encryptedApiKey!, settings.openai!.salt!, "next-password"), "synthetic-openai");
  assert.deepEqual(settings.compatibleProviders?.openrouter?.enabledModels, ["vendor/model"]);
  const locked = await action(args(await request({ action: "lock" }, tokens)));
  const lockedTokens = (await tokenResponse(locked))!;
  assert.equal(lockedTokens.geminiApiKey, undefined); assert.equal(lockedTokens.openaiApiKey, undefined); assert.equal(lockedTokens.jevApiKey, undefined); assert.deepEqual(lockedTokens.compatibleApiKeys, {});
});

test("common password setup rejects mismatches, short passwords, org mounts and cross-origin requests", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Rejected request reached storage"));
  for (const body of [{ action: "setup", password: "short", confirmPassword: "short" }, { action: "setup", password: "common-password", confirmPassword: "different" }, { action: "unknown" }, null]) assert.equal((await action(args(await request(body)))).status, 400);
  assert.equal((await action(args(await request({ action: "lock" }, { ...baseTokens, currentProjectId: "project" })))).status, 403);
  await assert.rejects(action(args(await request({ action: "lock" }, baseTokens, "https://attacker.invalid"))), e => e instanceof Response && e.status === 403);
});
