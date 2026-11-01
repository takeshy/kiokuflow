import type { UserSettings } from "~/types/settings";
import { decryptStoredApiKey, encryptApiKeyWithPublicKey } from "./api-key-crypto";

// Shared steps of the password-protected provider key routes (OpenAI, Jev,
// OpenRouter / OpenCode Go). Failures are thrown as JSON Responses.

export const PROVIDER_KEY_HEADERS = { "Cache-Control": "no-store" };

export interface SavedProviderKey { encryptedApiKey?: string; salt?: string }

/** Decrypt the saved key with the request password ("" when none is saved). */
export async function decryptSavedProviderKey(saved: SavedProviderKey | undefined, password: string, label: string, headers: HeadersInit = PROVIDER_KEY_HEADERS, encryption?: UserSettings["encryption"]): Promise<string> {
  if (!saved?.encryptedApiKey || !saved.salt) return "";
  try {
    return await decryptStoredApiKey(saved, password, encryption);
  } catch {
    throw Response.json({ error: `Incorrect ${label} encryption password.` }, { status: 401, headers });
  }
}

/** The new key from the request body, falling back to the previously saved key. */
export function requestedProviderKey(apiKey: unknown, fallback: string): string {
  return typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : fallback;
}

/** Encrypt a newly entered key using only the configured public key. */
export async function encryptProviderKey(key: string, settings: Pick<UserSettings, "encryption">, headers: HeadersInit = PROVIDER_KEY_HEADERS): Promise<Required<SavedProviderKey>> {
  if (!key || key.length > 1024 || /[\r\n]/.test(key)) throw Response.json({ error: "Enter a valid API key." }, { status: 400, headers });
  if (!settings.encryption.publicKey) throw Response.json({ error: "Set up encryption in Settings > General first." }, { status: 400, headers });
  return encryptApiKeyWithPublicKey(key, settings.encryption.publicKey);
}

/** Provider tabs may save keys, while common password changes belong to General. */
export async function prepareCommonKeySettings(settings: UserSettings, body: { password?: unknown; newPassword?: unknown }, headers: HeadersInit = PROVIDER_KEY_HEADERS) {
  const password = typeof body.password === "string" ? body.password : "";
  if (body.newPassword && body.newPassword !== password) throw Response.json({ error: "Change the common encryption password in Settings > General." }, { status: 400, headers });
  if (settings.encryption.publicKey && settings.encryption.encryptedPrivateKey) return settings;
  try {
    const { configureCommonPassword } = await import("./api-key-password.server");
    return (await configureCommonPassword(settings, password)).settings;
  } catch (error) {
    throw Response.json({ error: error instanceof Error ? error.message : "Incorrect common encryption password." }, { status: 401, headers });
  }
}
