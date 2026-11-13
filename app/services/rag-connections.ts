export type RagConnectionProvider = "gemini" | "openai" | "jev" | "openrouter";
export interface RagConnectionStatus {
  provider: RagConnectionProvider;
  state: "ready" | "locked" | "missing";
  id: string;
  settingsHref: string;
}
export interface RagConnections {
  reranking: { gemini: RagConnectionStatus; jev: RagConnectionStatus };
  embedding: { gemini: RagConnectionStatus; openai: RagConnectionStatus };
}
export interface RagEmbeddingModel { id: string; supported: boolean }

export function ragConnectionLabel(connection: RagConnectionStatus, ja: boolean): string {
  const name = { gemini: "Gemini", openai: "OpenAI", jev: "Jev", openrouter: "OpenRouter" }[connection.provider];
  const state = ja ? { ready: "利用可能（未確認）", locked: "保存済み・ロック中", missing: "APIキー未設定" }
    : { ready: "Available (not verified)", locked: "Saved, locked", missing: "API key not configured" };
  return `${name}: ${state[connection.state]}`;
}
