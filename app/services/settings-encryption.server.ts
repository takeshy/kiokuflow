import type { UserSettings } from "~/types/settings";
import { encryptPrivateKey } from "./crypto-core";
import { configureCommonPassword } from "./api-key-password.server";
import { hasEncryptionPassword } from "./api-key-password";

/** General settings and the Gemini key share the common encryption password. */
export async function updateSettingsEncryption(settings: UserSettings, fields: {
  geminiApiKey: string; password: string; confirmPassword: string;
  currentPassword: string; newPassword: string;
}) {
  const { geminiApiKey, password, confirmPassword, currentPassword, newPassword } = fields;
  let updated = settings;
  let effectiveApiKey = "";
  const configured = hasEncryptionPassword(settings);
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
  if (initial || changingPassword || geminiApiKey) {
    try {
      const common = await configureCommonPassword(settings, initial ? password : currentPassword, initial ? password : changingPassword ? newPassword : currentPassword);
      updated = common.settings;
      if (changingPassword) effectiveApiKey = common.keys.geminiApiKey || "";
    } catch (error) {
      if (configured) throw new Error("Current password is incorrect. " + (error instanceof Error ? error.message : ""));
      throw error;
    }
  }
  if (geminiApiKey) {
    effectiveApiKey = geminiApiKey;
    const encrypted = await encryptPrivateKey(geminiApiKey, initial ? password : changingPassword ? newPassword : currentPassword);
    updated = { ...updated, encryptedApiKey: encrypted.encryptedPrivateKey, apiKeySalt: encrypted.salt };
  }
  return { encryptedApiKey: updated.encryptedApiKey, apiKeySalt: updated.apiKeySalt, encryption: { ...updated.encryption }, openai: updated.openai, jev: updated.jev, compatibleProviders: updated.compatibleProviders, effectiveApiKey };
}
