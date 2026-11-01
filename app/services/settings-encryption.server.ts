import type { UserSettings } from "~/types/settings";
import { decryptPrivateKey, encryptPrivateKey, generateKeyPair } from "./crypto-core";

/** File encryption can be initialized before any AI provider is configured. */
export async function updateSettingsEncryption(settings: UserSettings, fields: {
  geminiApiKey: string; password: string; confirmPassword: string;
  currentPassword: string; newPassword: string;
}) {
  const { geminiApiKey, password, confirmPassword, currentPassword, newPassword } = fields;
  const result = {
    encryptedApiKey: settings.encryptedApiKey,
    apiKeySalt: settings.apiKeySalt,
    encryption: { ...settings.encryption },
    effectiveApiKey: "",
  };
  const configured = !!(settings.encryption.encryptedPrivateKey || settings.encryptedApiKey);
  const initial = !configured && !!password;
  const changingPassword = configured && !!newPassword;
  if (initial || changingPassword) {
    const nextPassword = initial ? password : newPassword;
    if (nextPassword !== confirmPassword) throw new Error("Passwords do not match.");
    if (nextPassword.length < 8) throw new Error("Password must be at least 8 characters.");
  }
  if (newPassword && !configured) throw new Error("passwordRequiredError");
  if ((changingPassword || geminiApiKey) && configured && !currentPassword) throw new Error("currentPasswordRequired");
  if (geminiApiKey && !configured && !initial) throw new Error("passwordRequiredError");

  let existingKey = "";
  let rsaPrivateKey = "";
  if (configured && (changingPassword || geminiApiKey)) {
    try {
      if (settings.encryptedApiKey) existingKey = await decryptPrivateKey(settings.encryptedApiKey, settings.apiKeySalt, currentPassword);
      if (settings.encryption.encryptedPrivateKey) rsaPrivateKey = await decryptPrivateKey(settings.encryption.encryptedPrivateKey, settings.encryption.salt, currentPassword);
    } catch {
      throw new Error("Current password is incorrect.");
    }
  }
  if (initial || changingPassword) {
    const nextPassword = initial ? password : newPassword;
    if (!rsaPrivateKey) {
      const pair = await generateKeyPair();
      rsaPrivateKey = pair.privateKey;
      result.encryption.publicKey = pair.publicKey;
    }
    const encrypted = await encryptPrivateKey(rsaPrivateKey, nextPassword);
    result.encryption = { ...result.encryption, enabled: true, encryptedPrivateKey: encrypted.encryptedPrivateKey, salt: encrypted.salt };
  }
  if (geminiApiKey || (changingPassword && existingKey)) {
    result.effectiveApiKey = geminiApiKey || existingKey;
    const encrypted = await encryptPrivateKey(result.effectiveApiKey, initial ? password : changingPassword ? newPassword : currentPassword);
    result.encryptedApiKey = encrypted.encryptedPrivateKey;
    result.apiKeySalt = encrypted.salt;
  }
  return result;
}
