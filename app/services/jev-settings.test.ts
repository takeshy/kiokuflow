import { decryptStoredApiKey } from "./api-key-crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { action as configure } from "~/routes/api.jev.settings";
import { action as configurePassword } from "~/routes/api.settings.api-key-password";
import { getTokens, setTokens, commitSession, type SessionTokens } from "./session.server";
import { clearSettingsCache } from "./user-settings.server";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "~/types/settings";
import { SETTINGS_FILE_NAME } from "./sync-diff";

const baseTokens: SessionTokens = { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiryTime: Date.now() + 3600_000, rootFolderId: "jev-tests", compatibleApiKeys: { openrouter: "synthetic-router" } };
async function request(body: unknown, overrides: Partial<SessionTokens> = {}, origin = "https://gemihub.example") {
  const session = await setTokens(new Request("https://gemihub.example"), { ...baseTokens, ...overrides });
  return new Request("https://gemihub.example/api/jev/settings", { method: "POST", headers: { Origin: origin, Cookie: (await commitSession(session)).split(";")[0], "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function args(request: Request) { return { request, params: {}, context: {} } as never; }
async function responseTokens(response: Response) { return getTokens(new Request("https://gemihub.example", { headers: { Cookie: response.headers.get("Set-Cookie")!.split(";")[0] } })); }

test("Jev key is encrypted, rotates passwords, locks independently, and is isolated per Drive root", async t => {
  clearSettingsCache();
  let settings: UserSettings = { ...DEFAULT_USER_SETTINGS, systemPrompt: "preserve" };
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "credentials", name: SETTINGS_FILE_NAME }] });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/credentials")) return Response.json(settings);
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files/credentials")) { settings = JSON.parse(String(init?.body)); return Response.json({ id: "credentials", name: SETTINGS_FILE_NAME }); }
    if (url === "https://api.typesafe.ai/v1/systemone") return Response.json({ answers: { check: { choice: "keep" } } });
    assert.fail(`Unexpected request ${url}`);
  });
  const saved = await configure(args(await request({ action: "save", apiKey: "synthetic-jev", password: "jev-password" })));
  assert.equal(saved.status, 200); assert.equal(settings.systemPrompt, "preserve");
  assert.notEqual(settings.jev!.encryptedApiKey, "synthetic-jev");
  assert.equal(await decryptStoredApiKey(settings.jev, "jev-password", settings.encryption), "synthetic-jev");
  assert.equal(JSON.stringify(await saved.json()).includes("synthetic-jev"), false);
  const savedTokens = (await responseTokens(saved))!;
  assert.equal(savedTokens.jevApiKey, "synthetic-jev"); assert.equal(savedTokens.compatibleApiKeys?.openrouter, "synthetic-router");
  const locked = await configure(args(await request({ action: "lock" }, { jevApiKey: savedTokens.jevApiKey })));
  const lockedTokens = (await responseTokens(locked))!;
  assert.equal(lockedTokens.jevApiKey, undefined); assert.equal(lockedTokens.compatibleApiKeys?.openrouter, "synthetic-router");
  assert.equal((await configure(args(await request({ action: "unlock", password: "wrong" })))).status, 401);
  const rejected = await configure(args(await request({ action: "save", password: "jev-password", newPassword: "new-password" })));
  assert.equal(rejected.status, 400);
  const passwordless = await configure(args(await request({ action: "save", apiKey: "synthetic-jev" }, { jevApiKey: "" })));
  assert.equal(passwordless.status, 200);
  assert.equal(await decryptStoredApiKey(settings.jev, "jev-password", settings.encryption), "synthetic-jev");
  const rotated = await configurePassword(args(await request({ action: "change", password: "jev-password", newPassword: "new-password", confirmPassword: "new-password" })));
  assert.equal(rotated.status, 200);
  assert.equal(await decryptStoredApiKey(settings.jev, "new-password", settings.encryption), "synthetic-jev");
  assert.equal((await configure(args(await request({ action: "unlock", password: "jev-password" })))).status, 401);
  const changed = await setTokens(new Request("https://gemihub.example", { headers: { Cookie: saved.headers.get("Set-Cookie")!.split(";")[0] } }), { ...savedTokens, rootFolderId: "other-root" });
  const changedTokens = await getTokens(new Request("https://gemihub.example", { headers: { Cookie: (await commitSession(changed)).split(";")[0] } }));
  assert.equal(changedTokens?.jevApiKey, undefined);
});

test("Jev direct verification sends entered or unlocked keys only to the official TypeSafe API", async t => {
  clearSettingsCache();
  const keys: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "credentials", name: SETTINGS_FILE_NAME }] });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/credentials")) return Response.json(DEFAULT_USER_SETTINGS);
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(init?.method, "POST");
    keys.push(new Headers(init?.headers).get("Authorization")!);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "jev-latest");
    assert.equal(body.questions.check.type, "choice");
    return Response.json({ answers: { check: { choice: "keep" } } });
  });
  assert.equal((await configure(args(await request({ action: "verify", apiKey: " synthetic-entered " })))).status, 200);
  assert.equal((await configure(args(await request({ action: "verify" }, { jevApiKey: "synthetic-unlocked" })))).status, 200);
  assert.equal((await configure(args(await request({ action: "verify" })))).status, 401);
  assert.deepEqual(keys, ["Bearer synthetic-entered", "Bearer synthetic-unlocked"]);
});

test("Jev OpenRouter mode reuses only the unlocked Router key and validates origin", async t => {
  clearSettingsCache(); let useOpenRouter = false;
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "credentials", name: SETTINGS_FILE_NAME }] });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/credentials")) return Response.json({ ...DEFAULT_USER_SETTINGS, jev: { useOpenRouter }, compatibleProviders: { openrouter: { encryptedApiKey: "cipher", salt: "salt" } } });
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files/credentials")) { useOpenRouter = JSON.parse(String(init?.body)).jev.useOpenRouter; return Response.json({ id: "credentials" }); }
    assert.equal(url, "https://openrouter.ai/api/alpha/decisions");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-router");
    return Response.json({ answers: { check: { choice: "keep" } } });
  });
  assert.equal((await configure(args(await request({ action: "setMode", useOpenRouter: true })))).status, 200);
  assert.equal(useOpenRouter, true);
  assert.equal((await configure(args(await request({ action: "verify", apiKey: "do-not-use" })))).status, 200);
  assert.equal((await configure(args(await request({ action: "verify" }, { compatibleApiKeys: {} })))).status, 401);
  await assert.rejects(configure(args(await request({ action: "save" }, {}, "https://attacker.invalid"))), e => e instanceof Response && e.status === 403);
  assert.equal((await configure(args(await request({ action: "save" }, { currentProjectId: "project" })))).status, 403);
});

test("connection verification can check an unsaved Router draft without persisting keys or mode", async t => {
  clearSettingsCache();
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "credentials", name: SETTINGS_FILE_NAME }] });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/credentials")) return Response.json(DEFAULT_USER_SETTINGS);
    assert.equal(url, "https://openrouter.ai/api/alpha/decisions");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer unsaved-router");
    return Response.json({ answers: { check: { choice: "keep" } } });
  });
  const result = await configure(args(await request({ action: "verify", useOpenRouter: true, openRouterApiKey: "unsaved-router" }, { compatibleApiKeys: {} })));
  assert.equal(result.status, 200); assert.equal(result.headers.get("Set-Cookie"), null);
});

test("verify-and-save preserves the saved key and mode on failed checks and writes only after success", async t => {
  clearSettingsCache();
  const { configureCommonPassword } = await import("./api-key-password.server");
  const { encryptApiKeyWithPublicKey } = await import("./api-key-crypto");
  const initial = await configureCommonPassword(DEFAULT_USER_SETTINGS, "private-key-password");
  let settings: UserSettings = { ...initial.settings, jev: { ...await encryptApiKeyWithPublicKey("previous-key", initial.settings.encryption.publicKey), useOpenRouter: false }, compatibleProviders: { openrouter: { encryptedApiKey: "router-cipher", salt: "salt", enabledModels: [], availableModels: [] } } };
  const initialSettings = JSON.stringify(settings); const events: string[] = [];
  let outcome: "http" | "invalid" | "exclude" | "success" = "http";
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "credentials", name: SETTINGS_FILE_NAME }] });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/credentials")) return Response.json(settings);
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files/credentials")) { events.push("save"); settings = JSON.parse(String(init?.body)); return Response.json({ id: "credentials" }); }
    assert.ok(url === "https://api.typesafe.ai/v1/systemone" || url === "https://openrouter.ai/api/alpha/decisions");
    events.push("verify");
    if (outcome === "http") return Response.json({ error: "Invalid key" }, { status: 401 });
    if (outcome === "invalid") return Response.json({ answers: {} });
    return Response.json({ answers: { check: { choice: outcome === "exclude" ? "exclude" : "keep" } } });
  });
  for (const failure of ["http", "invalid", "exclude"] as const) {
    outcome = failure;
    const failed = await configure(args(await request({ action: "save", apiKey: "candidate-key", useOpenRouter: false })));
    assert.equal(failed.status, 502); assert.equal(JSON.stringify(settings), initialSettings);
    assert.equal(failed.headers.get("Set-Cookie"), null); assert.ok(!events.includes("save"));
  }
  const failedMode = await configure(args(await request({ action: "setMode", useOpenRouter: true })));
  assert.equal(failedMode.status, 502); assert.equal(JSON.stringify(settings), initialSettings);
  events.length = 0; outcome = "success";
  const saved = await configure(args(await request({ action: "save", apiKey: "candidate-key", useOpenRouter: false })));
  assert.equal(saved.status, 200); assert.deepEqual(events, ["verify", "save"]);
  assert.equal(await decryptStoredApiKey(settings.jev, "private-key-password", settings.encryption), "candidate-key");
  assert.equal((await responseTokens(saved))?.jevApiKey, "candidate-key");
});
