import { GoogleGenAI } from "@google/genai";
import type { RagEmbeddingInput } from "./rag-embeddings.server";
import type { EmbeddingProvider } from "./rag-config";

// Existing Firestore indexes use 2048 dimensions. Zero-padding OpenAI's
// small model output preserves cosine distance exactly, allowing the
// same vector index to serve both providers without mixing their namespaces.
export const VECTOR_DIMENSIONS = 2048;
// Text chunks are embedded in batches (both providers accept several inputs per
// request); media inputs go one per request.
const TEXT_BATCH_SIZE = 32;
export async function embedRagInputs(inputs: RagEmbeddingInput[], options: {
  apiKey: string; provider: EmbeddingProvider; model: string; query?: boolean; signal?: AbortSignal;
}): Promise<number[][]> {
  const result: number[][] = [];
  for (let offset = 0; offset < inputs.length;) {
    options.signal?.throwIfAborted();
    const group: RagEmbeddingInput[] = [inputs[offset++]];
    if (typeof group[0] === "string") {
      while (offset < inputs.length && group.length < TEXT_BATCH_SIZE && typeof inputs[offset] === "string") group.push(inputs[offset++]);
    }
    const vectors = await embedGroup(group, options);
    for (const vector of vectors) {
      if (!vector || vector.length !== VECTOR_DIMENSIONS || vector.some((value) => !Number.isFinite(value)) || !vector.some((value) => value !== 0)) throw new Error("Invalid embedding returned by provider");
      result.push(vector);
    }
  }
  return result;
}

async function embedGroup(group: RagEmbeddingInput[], options: {
  apiKey: string; provider: EmbeddingProvider; model: string; query?: boolean; signal?: AbortSignal;
}): Promise<(number[] | undefined)[]> {
  if (options.provider === "openai") {
    if (group.some((input) => typeof input !== "string")) throw new Error("OpenAI embedding models accept text. Choose Gemini for image RAG.");
    const dimensions = options.model === "text-embedding-3-large" ? 2048 : 1536;
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: options.model, input: group, dimensions, encoding_format: "float" }), signal: options.signal,
    });
    const data = await response.json() as { data?: { embedding: number[]; index?: number }[]; error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message || `OpenAI embeddings HTTP ${response.status}`);
    const items = [...(data.data || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (items.length !== group.length) throw new Error("Unexpected OpenAI embedding count");
    return items.map(({ embedding }) => {
      if (embedding?.length !== dimensions) throw new Error("Unexpected OpenAI embedding dimensions");
      return [...embedding, ...new Array(VECTOR_DIMENSIONS - embedding.length).fill(0)];
    });
  }
  const ai = new GoogleGenAI({ apiKey: options.apiKey });
  // A group is either text only or a single media input (see embedRagInputs).
  const contents = group.every((input) => typeof input === "string")
    ? group.map((input) => options.model === "gemini-embedding-2" ? (options.query ? `task: search result | query: ${input}` : `title: none | text: ${input}`) : input)
    : group.map((input) => typeof input === "string" ? { role: "user", parts: [{ text: input }] } : { role: "user", parts: [...(input.text ? [{ text: input.text }] : []), { inlineData: input.inlineData }] });
  const response = await ai.models.embedContent({ model: options.model, contents, config: {
    outputDimensionality: VECTOR_DIMENSIONS,
    ...(options.model !== "gemini-embedding-2" ? { taskType: options.query ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT" } : {}),
    abortSignal: options.signal,
  } });
  if (response.embeddings?.length !== group.length) throw new Error("Unexpected Gemini embedding count");
  return response.embeddings.map((embedding) => embedding.values);
}
