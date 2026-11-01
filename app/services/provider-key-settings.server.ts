import { encryptPrivateKey, decryptPrivateKey } from "./crypto-core";

// Shared steps of the password-protected provider key routes (OpenAI, Jev,
// OpenRouter / OpenCode Go). Failures are thrown as JSON Responses.

export const PROVIDER_KEY_HEADERS = { "Cache-Control": "no-store" };

export interface SavedProviderKey { encryptedApiKey?: string; salt?: string }

/** Decrypt the saved key with the request password ("" when none is saved). */
export async function decryptSavedProviderKey(saved: SavedProviderKey | undefined, password: string, label: string, headers: HeadersInit = PROVIDER_KEY_HEADERS): Promise<string> {
  if (!saved?.encryptedApiKey || !saved.salt) return "";
  try {
    return await decryptPrivateKey(saved.encryptedApiKey, saved.salt, password);
  } catch {
    throw Response.json({ error: `Incorrect ${label} encryption password.` }, { status: 401, headers });
  }
}

/** The new key from the request body, falling back to the previously saved key. */
export function requestedProviderKey(apiKey: unknown, fallback: string): string {
  return typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : fallback;
}

/** Validate a key and its encryption password, then encrypt it for settings.json. */
export async function encryptProviderKey(key: string, body: { password?: unknown; newPassword?: unknown }, headers: HeadersInit = PROVIDER_KEY_HEADERS): Promise<Required<SavedProviderKey>> {
  const password = typeof body.newPassword === "string" && body.newPassword ? body.newPassword : typeof body.password === "string" ? body.password : "";
  if (!key || key.length > 1024 || /[\r\n]/.test(key) || password.length < 8) {
    throw Response.json({ error: "Enter an API key and an encryption password of at least 8 characters." }, { status: 400, headers });
  }
  const encrypted = await encryptPrivateKey(key, password);
  return { encryptedApiKey: encrypted.encryptedPrivateKey, salt: encrypted.salt };
}
