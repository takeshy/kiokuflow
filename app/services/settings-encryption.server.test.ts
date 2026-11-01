import { decryptStoredApiKey } from "./api-key-crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_USER_SETTINGS } from "~/types/settings";
import { decryptPrivateKey } from "./crypto-core";
import { updateSettingsEncryption } from "./settings-encryption.server";

const emptyFields = { geminiApiKey: "", password: "", confirmPassword: "", currentPassword: "", newPassword: "" };

test("file encryption can be initialized without an AI key and later protect a Gemini key", async () => {
  const initial = await updateSettingsEncryption(DEFAULT_USER_SETTINGS, { ...emptyFields, password: "first-password", confirmPassword: "first-password" });
  assert.equal(initial.encryption.enabled, true);
  assert.ok(initial.encryption.publicKey);
  assert.ok(initial.encryption.encryptedPrivateKey);
  assert.equal(initial.effectiveApiKey, "");
  assert.equal(initial.encryptedApiKey, DEFAULT_USER_SETTINGS.encryptedApiKey);
  const settings = { ...DEFAULT_USER_SETTINGS, ...initial };
  const privateKey = await decryptPrivateKey(initial.encryption.encryptedPrivateKey, initial.encryption.salt, "first-password");
  // Saving uses the public key even while the private key is locked.
  const passwordless = await updateSettingsEncryption(settings, { ...emptyFields, geminiApiKey: "synthetic-passwordless" });
  assert.equal(await decryptStoredApiKey({ encryptedApiKey: passwordless.encryptedApiKey, salt: passwordless.apiKeySalt }, "first-password", passwordless.encryption), "synthetic-passwordless");
  const withKey = await updateSettingsEncryption(settings, { ...emptyFields, geminiApiKey: "synthetic-gemini", currentPassword: "first-password" });
  assert.equal(await decryptStoredApiKey({ encryptedApiKey: withKey.encryptedApiKey, salt: withKey.apiKeySalt }, "first-password", withKey.encryption), "synthetic-gemini");
  assert.equal(withKey.encryption.publicKey, initial.encryption.publicKey);

  // General's password change keeps the RSA key and re-encrypts both secrets.
  const changed = await updateSettingsEncryption({ ...settings, ...withKey }, { ...emptyFields, currentPassword: "first-password", newPassword: "second-password", confirmPassword: "second-password" });
  assert.equal(await decryptPrivateKey(changed.encryption.encryptedPrivateKey, changed.encryption.salt, "second-password"), privateKey);
  assert.equal(await decryptStoredApiKey({ encryptedApiKey: changed.encryptedApiKey, salt: changed.apiKeySalt }, "second-password", changed.encryption), "synthetic-gemini");
  await assert.rejects(decryptStoredApiKey({ encryptedApiKey: changed.encryptedApiKey, salt: changed.apiKeySalt }, "first-password", changed.encryption));
});

test("password changes work for users without a Gemini API key", async () => {
  const first = await updateSettingsEncryption(DEFAULT_USER_SETTINGS, { ...emptyFields, password: "initial-password", confirmPassword: "initial-password" });
  const changed = await updateSettingsEncryption({ ...DEFAULT_USER_SETTINGS, ...first }, { ...emptyFields, currentPassword: "initial-password", newPassword: "changed-password", confirmPassword: "changed-password" });
  assert.equal(changed.effectiveApiKey, "");
  assert.equal(changed.encryption.publicKey, first.encryption.publicKey);
  assert.ok(await decryptPrivateKey(changed.encryption.encryptedPrivateKey, changed.encryption.salt, "changed-password"));
});

test("partial settings saves preserve encrypted secrets and reject incomplete password changes", async () => {
  const initial = await updateSettingsEncryption(DEFAULT_USER_SETTINGS, { ...emptyFields, geminiApiKey: "synthetic-key", password: "initial-password", confirmPassword: "initial-password" });
  const settings = { ...DEFAULT_USER_SETTINGS, ...initial };
  const unchanged = await updateSettingsEncryption(settings, emptyFields);
  assert.equal(unchanged.encryptedApiKey, initial.encryptedApiKey);
  assert.deepEqual(unchanged.encryption, initial.encryption);
  assert.equal(unchanged.effectiveApiKey, "");
  await assert.rejects(updateSettingsEncryption(settings, { ...emptyFields, newPassword: "changed-password", confirmPassword: "changed-password" }), /currentPasswordRequired/);
  await assert.rejects(updateSettingsEncryption(settings, { ...emptyFields, currentPassword: "initial-password", newPassword: "changed-password", confirmPassword: "different" }), /Passwords do not match/);
  await assert.rejects(updateSettingsEncryption(DEFAULT_USER_SETTINGS, { ...emptyFields, geminiApiKey: "synthetic-key" }), /passwordRequiredError/);
});
