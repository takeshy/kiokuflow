import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_USER_SETTINGS } from "~/types/settings";
import { generateKeyPair, encryptPrivateKey, decryptPrivateKey } from "./crypto-core";
import { encryptApiKeyWithPublicKey, decryptStoredApiKey } from "./api-key-crypto";
import { configureCommonPassword, unlockSettingsKeys } from "./api-key-password.server";

test("an API key is saved with only the public key and needs the password only when unlocking the private key", async () => {
  const pair = await generateKeyPair(); const privateKey = await encryptPrivateKey(pair.privateKey, "private-key-password");
  const encryption = { encryptedPrivateKey: privateKey.encryptedPrivateKey, salt: privateKey.salt };
  const saved = await encryptApiKeyWithPublicKey("synthetic-key", pair.publicKey);
  assert.ok(saved.encryptedApiKey.startsWith("rsa-v1:")); assert.equal(saved.encryptedApiKey.includes("synthetic-key"), false);
  assert.equal(await decryptStoredApiKey(saved, "private-key-password", encryption), "synthetic-key");
  await assert.rejects(decryptStoredApiKey(saved, "", encryption)); await assert.rejects(decryptStoredApiKey(saved, "incorrect", encryption));
  await assert.rejects(decryptStoredApiKey(saved, "private-key-password"));
  assert.equal(await decryptStoredApiKey(saved, "", undefined, pair.privateKey), "synthetic-key");
});

test("the existing password-encrypted API key format remains readable", async () => {
  const legacy = await encryptPrivateKey("legacy-key", "legacy-password");
  assert.equal(await decryptStoredApiKey({ encryptedApiKey: legacy.encryptedPrivateKey, salt: legacy.salt }, "legacy-password"), "legacy-key");
});

test("changing the private-key password preserves RSA identity and all public-key encrypted API keys", async () => {
  const initial = await configureCommonPassword(DEFAULT_USER_SETTINGS, "first-password");
  const openai = await encryptApiKeyWithPublicKey("synthetic-openai", initial.settings.encryption.publicKey);
  const settings = { ...initial.settings, openai };
  const changed = await configureCommonPassword(settings, "first-password", "second-password");
  assert.equal(changed.settings.encryption.publicKey, settings.encryption.publicKey);
  assert.equal((await unlockSettingsKeys(changed.settings, "second-password")).keys.openaiApiKey, "synthetic-openai");
  const newPrivateKey = await decryptPrivateKey(changed.settings.encryption.encryptedPrivateKey, changed.settings.encryption.salt, "second-password");
  assert.equal(await decryptStoredApiKey(openai, "", undefined, newPrivateKey), "synthetic-openai");
});
