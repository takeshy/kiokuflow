import { createHash } from "node:crypto";
import type { UserSettings } from "~/types/settings";
import type { SessionTokens } from "./session.server";
import type { RagConnections, RagConnectionProvider, RagConnectionStatus, RagEmbeddingModel } from "./rag-connections";
import { EMBEDDING_MODELS, type EmbeddingProvider } from "./rag-config";

export function describeRagConnections(settings: UserSettings, tokens: Pick<SessionTokens, "geminiApiKey" | "openaiApiKey" | "jevApiKey" | "compatibleApiKeys" | "rootFolderId">): RagConnections {
  const connection = (provider: RagConnectionProvider, encrypted: string | undefined, key: string | undefined, requireSaved = false): RagConnectionStatus => {
    const state = key && (!requireSaved || encrypted) ? "ready" : encrypted ? "locked" : "missing";
    return {
      provider, state,
      // Only a fingerprint is sent to clients; neither API keys nor ciphertext leave this helper.
      id: createHash("sha256").update(JSON.stringify([tokens.rootFolderId, provider, encrypted, key])).digest("hex"),
      settingsHref: state === "locked" ? "/settings?tab=general" : `/settings?tab=ai&provider=${provider === "gemini" ? "apikey" : provider}`,
    };
  };
  const gemini = connection("gemini", settings.encryptedApiKey, tokens.geminiApiKey);
  const openai = connection("openai", settings.openai?.encryptedApiKey, tokens.openaiApiKey);
  const jev = settings.jev?.useOpenRouter
    ? connection("openrouter", settings.compatibleProviders?.openrouter?.encryptedApiKey, tokens.compatibleApiKeys?.openrouter, true)
    : connection("jev", settings.jev?.encryptedApiKey, tokens.jevApiKey, true);
  return { reranking: { gemini, jev }, embedding: { gemini, openai } };
}

/** Fetch catalogues without generating text or enabling any chat models. */
export async function discoverRagEmbeddingModels(provider: EmbeddingProvider, apiKey: string, signal?: AbortSignal): Promise<RagEmbeddingModel[]> {
  const ids = new Set<string>();
  const seen = new Set<string>();
  let pageToken = "";
  do {
    const url = new URL(provider === "gemini" ? "https://generativelanguage.googleapis.com/v1beta/models" : "https://api.openai.com/v1/models");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { signal, redirect: "error", headers: provider === "gemini" ? { "x-goog-api-key": apiKey } : { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) throw new Error(`Model catalogue request failed: HTTP ${response.status}`);
    const payload = await response.json() as { models?: { name?: string; supportedGenerationMethods?: string[] }[]; data?: { id?: string }[]; nextPageToken?: string };
    if (provider === "gemini") {
      if (!Array.isArray(payload.models)) throw new Error("Invalid Gemini model catalogue");
      for (const model of payload.models) {
        if (typeof model.name === "string" && model.supportedGenerationMethods?.some(method => /embed/i.test(method))) ids.add(model.name.replace(/^models\//, ""));
      }
    } else {
      if (!Array.isArray(payload.data)) throw new Error("Invalid OpenAI model catalogue");
      for (const model of payload.data) if (typeof model.id === "string" && /^text-embedding-/i.test(model.id)) ids.add(model.id);
    }
    pageToken = provider === "gemini" ? payload.nextPageToken || "" : "";
    if (pageToken && (seen.has(pageToken) || seen.size >= 20)) throw new Error("Invalid model catalogue pagination");
    if (pageToken) seen.add(pageToken);
  } while (pageToken);
  return [...ids].sort().map(id => ({ id, supported: (EMBEDDING_MODELS[provider] as readonly string[]).includes(id) }));
}
