import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "~/types/settings";
import { encryptPrivateKey, decryptPrivateKey } from "./crypto-core";
import { configureCommonPassword, unlockSettingsKeys } from "./api-key-password.server";
import { prepareCommonKeySettings } from "./provider-key-settings.server";
import { updateSettingsEncryption } from "./settings-encryption.server";

const password = " common-password ";
async function savedKey(key: string, secret = password) { const encrypted = await encryptPrivateKey(key, secret); return { encryptedApiKey: encrypted.encryptedPrivateKey, salt: encrypted.salt }; }
async function allProviders(): Promise<UserSettings> {
  const initial = await configureCommonPassword(DEFAULT_USER_SETTINGS, password);
  const gemini = await savedKey("synthetic-gemini");
  return { ...initial.settings, encryptedApiKey: gemini.encryptedApiKey, apiKeySalt: gemini.salt,
    openai: await savedKey("synthetic-openai"), jev: { ...await savedKey("synthetic-jev"), useOpenRouter: true },
    compatibleProviders: { openrouter: { ...await savedKey("synthetic-router"), enabledModels: ["vendor/model"], availableModels: [{ id: "vendor/model", name: "Model" }] }, opencodego: { ...await savedKey("synthetic-go"), enabledModels: ["go/model"], availableModels: [] } },
  };
}

test("one common password unlocks every provider and preserves surrounding whitespace", async () => {
  const settings = await allProviders();
  const unlocked = await unlockSettingsKeys(settings, password);
  assert.equal(unlocked.keys.geminiApiKey, "synthetic-gemini"); assert.equal(unlocked.keys.openaiApiKey, "synthetic-openai"); assert.equal(unlocked.keys.jevApiKey, "synthetic-jev");
  assert.deepEqual(unlocked.keys.compatibleApiKeys, { openrouter: "synthetic-router", opencodego: "synthetic-go" });
  await assert.rejects(unlockSettingsKeys(settings, password.trim()), /Cannot unlock/);
});

test("common rotation re-encrypts all API keys while retaining the RSA identity, Jev mode and enabled models", async () => {
  const settings = await allProviders(); const before = await unlockSettingsKeys(settings, password);
  const result = await configureCommonPassword(settings, password, "replacement-password");
  const after = await unlockSettingsKeys(result.settings, "replacement-password");
  assert.deepEqual(after, before);
  assert.equal(result.settings.encryption.publicKey, settings.encryption.publicKey);
  assert.equal(result.settings.jev?.useOpenRouter, true);
  assert.deepEqual(result.settings.compatibleProviders?.openrouter?.enabledModels, ["vendor/model"]);
  for (const cipher of [result.settings.openai, result.settings.jev, result.settings.compatibleProviders?.openrouter, result.settings.compatibleProviders?.opencodego]) {
    assert.ok(cipher); await assert.rejects(decryptPrivateKey(cipher!.encryptedApiKey!, cipher!.salt!, password));
  }
  assert.equal(await decryptPrivateKey(settings.openai!.encryptedApiKey!, settings.openai!.salt!, password), "synthetic-openai");
});

test("a legacy key-only configuration gains a common RSA envelope without replacing its key", async () => {
  const openai = await savedKey("synthetic-openai");
  const result = await configureCommonPassword({ ...DEFAULT_USER_SETTINGS, openai }, password);
  assert.equal(result.settings.openai!.encryptedApiKey, openai.encryptedApiKey);
  assert.ok(result.settings.encryption.publicKey); assert.ok(result.settings.encryption.encryptedPrivateKey);
});

test("mismatched legacy passwords fail before changing any stored ciphertext", async () => {
  const settings = await allProviders(); settings.jev = { ...await savedKey("jev-with-other-password", "different-password"), useOpenRouter: false };
  const before = JSON.stringify(settings);
  await assert.rejects(configureCommonPassword(settings, password, "next-password"), /Jev.*Cannot unlock/);
  assert.equal(JSON.stringify(settings), before);
});

test("provider tabs cannot save keys under a second password or rotate just one provider", async () => {
  const settings = await allProviders();
  await assert.rejects(prepareCommonKeySettings(settings, { password: "other-password" }), e => e instanceof Response && e.status === 401);
  await assert.rejects(prepareCommonKeySettings(settings, { password, newPassword: "other-password" }), e => e instanceof Response && e.status === 400);
  assert.equal((await prepareCommonKeySettings(settings, { password })).encryption.publicKey, settings.encryption.publicKey);
});

test("the legacy General form also rotates every provider with its common password change", async () => {
  const settings = await allProviders();
  const result = await updateSettingsEncryption(settings, { geminiApiKey: "", password: "", currentPassword: password, newPassword: "next-password", confirmPassword: "next-password" });
  const after = await unlockSettingsKeys({ ...settings, ...result }, "next-password");
  assert.equal(after.keys.openaiApiKey, "synthetic-openai"); assert.equal(after.keys.compatibleApiKeys?.opencodego, "synthetic-go");
});
