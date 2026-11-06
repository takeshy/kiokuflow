import assert from "node:assert/strict";
import test from "node:test";
import { consumeChatStream } from "./consume-chat-stream";
import type { StreamChunk } from "~/types/chat";

const tool: StreamChunk = { type: "tool_call", toolCall: { id: "read-1", name: "read_drive_file", args: { fileId: "note" } } };

async function* stream(chunks: StreamChunk[]) { yield* chunks; }

test("a tool failure without done keeps the bubble's chunks available for committing", async () => {
  const received: StreamChunk[] = [];
  const chunks: StreamChunk[] = [{ type: "text", content: "Reading the note" }, tool, { type: "error", error: "Failed to fetch" }];
  const completion = await consumeChatStream(stream(chunks), (chunk) => { received.push(chunk); });
  assert.equal(completion, undefined);
  assert.deepEqual(received, chunks);
  assert.equal(received.filter((chunk) => chunk.type === "error").length, 1);
});

test("EOF after a tool call reports an interrupted response instead of silently clearing it", async () => {
  const received: StreamChunk[] = [];
  const completion = await consumeChatStream(stream([tool]), (chunk) => { received.push(chunk); });
  assert.equal(completion, undefined);
  assert.equal(received[0], tool);
  assert.equal(received[1].type, "error");
  assert.match(received[1].error!, /interrupted/);
});

test("normal completion retains usage and continuation metadata and closes the iterator", async () => {
  let closed = false;
  const done: StreamChunk = { type: "done", usage: { totalTokens: 123 }, interactionId: "next", webSearchSources: [{ title: "Source", url: "https://example.com" }] };
  async function* response() {
    try { yield tool; yield done; assert.fail("stream read after completion"); }
    finally { closed = true; }
  }
  const received: StreamChunk[] = [];
  assert.equal(await consumeChatStream(response(), (chunk) => { received.push(chunk); }), done);
  assert.deepEqual(received, [tool]);
  assert.equal(closed, true);
});

test("a thrown tool/network error or abort leaves received chunks available to the caller", async () => {
  for (const error of [new Error("Network failed"), new DOMException("Stopped", "AbortError")]) {
    const received: StreamChunk[] = [];
    async function* response() { yield tool; throw error; }
    await assert.rejects(consumeChatStream(response(), (chunk) => { received.push(chunk); }), (actual) => actual === error);
    assert.deepEqual(received, [tool]);
  }
});
