import type { EncryptionSettings } from "~/types/settings";
import { decryptData, decryptPrivateKey, encryptData } from "./crypto-core";

const PUBLIC_KEY_FORMAT = "rsa-v1:";
export interface EncryptedApiKey { encryptedApiKey?: string; salt?: string }

/** Saving needs only the public key. The password protects the RSA private key. */
export async function encryptApiKeyWithPublicKey(key: string, publicKey: string): Promise<Required<EncryptedApiKey>> {
  if (!publicKey) throw new Error("Set up encryption in General first.");
  return { encryptedApiKey: PUBLIC_KEY_FORMAT + await encryptData(key, publicKey), salt: "rsa-v1" };
}

/** Accept the existing PBKDF2 format as well as public-key encrypted credentials. */
export async function decryptStoredApiKey(saved: EncryptedApiKey | undefined, password: string, encryption?: Pick<EncryptionSettings, "encryptedPrivateKey" | "salt">, unlockedPrivateKey?: string): Promise<string> {
  if (!saved?.encryptedApiKey) return "";
  if (!saved.encryptedApiKey.startsWith(PUBLIC_KEY_FORMAT)) {
    if (!saved.salt) throw new Error("Missing API-key salt");
    return decryptPrivateKey(saved.encryptedApiKey, saved.salt, password);
  }
  if (!unlockedPrivateKey && !encryption?.encryptedPrivateKey) throw new Error("Missing encrypted RSA private key");
  const privateKey = unlockedPrivateKey || await decryptPrivateKey(encryption!.encryptedPrivateKey, encryption!.salt, password);
  return decryptData(saved.encryptedApiKey.slice(PUBLIC_KEY_FORMAT.length), privateKey);
}
