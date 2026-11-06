import type { StreamChunk } from "~/types/chat";

/** Drain a response for the UI. Providers may finish with an error instead of
 * `done`; that response still needs to be committed before clearing the bubble.
 * Keep the provider's completion status intact rather than inventing success.
 */
export async function consumeChatStream(
  stream: AsyncIterable<StreamChunk>,
  onChunk: (chunk: StreamChunk) => void,
): Promise<StreamChunk | undefined> {
  let receivedError = false;
  for await (const chunk of stream) {
    if (chunk.type === "done") return chunk;
    receivedError ||= chunk.type === "error";
    onChunk(chunk);
  }
  if (!receivedError) {
    onChunk({ type: "error", error: "Response interrupted before completion. Received content has been kept." });
  }
  return undefined;
}
