import type { UserSettings } from "~/types/settings";

export function hasEncryptionPassword(settings: UserSettings): boolean {
  return !!(settings.encryption.encryptedPrivateKey || settings.encryptedApiKey || settings.openai?.encryptedApiKey || settings.jev?.encryptedApiKey || settings.compatibleProviders?.openrouter?.encryptedApiKey || settings.compatibleProviders?.opencodego?.encryptedApiKey);
}
