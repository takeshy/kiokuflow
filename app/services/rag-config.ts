import type { RagSetting } from "~/types/settings";

export const RAG_EMBEDDING_MODEL = "gemini-embedding-2";
export const EMBEDDING_MODELS = {
  gemini: ["gemini-embedding-2", "gemini-embedding-001"],
  openai: ["text-embedding-3-small", "text-embedding-3-large"],
} as const;
export type EmbeddingProvider = keyof typeof EMBEDDING_MODELS;
export function embeddingConfig(setting: Pick<RagSetting, "embeddingModel" | "embeddingProvider">) {
  const provider: EmbeddingProvider = setting.embeddingProvider === "openai" ? "openai" : "gemini";
  const requested = setting.embeddingModel?.replace(/^models\//, "");
  const model = requested && (EMBEDDING_MODELS[provider] as readonly string[]).includes(requested) ? requested : EMBEDDING_MODELS[provider][0];
  return { provider, model };
}
