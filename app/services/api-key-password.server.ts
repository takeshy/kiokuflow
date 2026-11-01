import type { UserSettings } from "~/types/settings";
import type { SessionTokens } from "./session.server";
import { decryptStoredApiKey, encryptApiKeyWithPublicKey } from "./api-key-crypto";
import { decryptPrivateKey, encryptPrivateKey, generateKeyPair } from "./crypto-core";

type UnlockedKeys = Pick<SessionTokens, "geminiApiKey" | "openaiApiKey" | "jevApiKey" | "compatibleApiKeys">;

/** All decryption succeeds before any settings/session mutation is returned. */
export async function unlockSettingsKeys(settings: UserSettings, password: string) {
  let privateKey = "";
  const decrypt = async (cipher: string | undefined, salt: string | undefined, label: string) => {
    if (!cipher) return "";
    try {
      if (!salt || !password) throw new Error("Missing password or salt");
      return await decryptStoredApiKey({ encryptedApiKey: cipher, salt }, password, settings.encryption, privateKey);
    } catch { throw new Error(`${label}: 共通パスワードで解除できません。現在の暗号化パスワードを確認してください。 / Cannot unlock with the common password. Check the current encryption password.`); }
  };
  if (settings.encryption.encryptedPrivateKey) {
    try { privateKey = await decryptPrivateKey(settings.encryption.encryptedPrivateKey, settings.encryption.salt, password); }
    catch { throw new Error("ファイル暗号化 / File encryption: 共通パスワードで解除できません。 / Cannot unlock with the common password."); }
  }
  const keys: UnlockedKeys = {
    geminiApiKey: await decrypt(settings.encryptedApiKey, settings.apiKeySalt, "Gemini"),
    openaiApiKey: await decrypt(settings.openai?.encryptedApiKey, settings.openai?.salt, "OpenAI"),
    jevApiKey: await decrypt(settings.jev?.encryptedApiKey, settings.jev?.salt, "Jev"),
    compatibleApiKeys: {},
  };
  for (const provider of ["openrouter", "opencodego"] as const) {
    const config = settings.compatibleProviders?.[provider];
    const key = await decrypt(config?.encryptedApiKey, config?.salt, provider === "openrouter" ? "OpenRouter" : "OpenCode Go");
    if (key) keys.compatibleApiKeys![provider] = key;
  }
  return { keys, privateKey };
}

/** One password protects all provider keys and the existing RSA private key. */
export async function configureCommonPassword(settings: UserSettings, currentPassword: string, password = currentPassword) {
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  const { keys, privateKey } = await unlockSettingsKeys(settings, currentPassword);
  const rotating = password !== currentPassword;
  let encryption = { ...settings.encryption };
  if (!privateKey || rotating) {
    const pair = privateKey ? { privateKey, publicKey: settings.encryption.publicKey } : await generateKeyPair();
    const encrypted = await encryptPrivateKey(pair.privateKey, password);
    encryption = { ...encryption, enabled: true, publicKey: pair.publicKey, encryptedPrivateKey: encrypted.encryptedPrivateKey, salt: encrypted.salt };
  }
  const updated: UserSettings = { ...settings, encryption };
  if (rotating) {
    const protect = async (key: string) => {
      return encryptApiKeyWithPublicKey(key, encryption.publicKey);
    };
    if (keys.geminiApiKey) { const encrypted = await protect(keys.geminiApiKey); updated.encryptedApiKey = encrypted.encryptedApiKey; updated.apiKeySalt = encrypted.salt; }
    if (keys.openaiApiKey) updated.openai = { ...settings.openai, ...await protect(keys.openaiApiKey) };
    if (keys.jevApiKey) updated.jev = { ...settings.jev!, ...await protect(keys.jevApiKey) };
    updated.compatibleProviders = { ...settings.compatibleProviders };
    for (const provider of ["openrouter", "opencodego"] as const) {
      const key = keys.compatibleApiKeys?.[provider];
      if (key) updated.compatibleProviders[provider] = { ...settings.compatibleProviders![provider]!, ...await protect(key) };
    }
  }
  return { settings: updated, keys };
}
