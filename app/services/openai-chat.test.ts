import assert from "node:assert/strict";
import test from "node:test";
import { messagesToOpenAIInput, openAIChatWithToolsStream, readOpenAIEvents } from "./openai-chat";
import { getAvailableModels, getReasoningEfforts, isOpenAIModel } from "~/types/settings";
import type { StreamChunk, Message } from "~/types/chat";

const messages: Message[] = [{ role: "user", content: "調べて", timestamp: 1 }];
const tool = { name: "lookup", description: "Lookup", parameters: { type: "object", properties: {} } };
function stream(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
}
async function collect(generator: AsyncGenerator<StreamChunk>) { return Array.fromAsync(generator); }
const completed = (output: unknown[] = [], tokens = 1) => ({ type: "response.completed", response: { status: "completed", output, usage: { input_tokens: tokens, output_tokens: tokens, total_tokens: tokens * 2 } } });

test("OpenAI model choices offer current Sol/Terra 6.1 and Luna 6, independently of Gemini's free tier", () => {
  for (const plan of ["free", "paid"] as const) {
    const models = getAvailableModels(plan, true).map((model) => model.name);
    assert.ok(models.includes("gpt-6.1-sol"));
    assert.ok(models.includes("gpt-6.1-terra"));
    assert.ok(models.includes("gpt-6-luna"));
    assert.ok(!getAvailableModels(plan).some((model) => isOpenAIModel(model.name)));
  }
  assert.equal(isOpenAIModel("o3"), true);
  assert.equal(isOpenAIModel("gemini-3.8-flash"), false);
  assert.ok(!getReasoningEfforts("gpt-6.1-sol").includes("none"));
  assert.ok(!getReasoningEfforts("gpt-6.1-terra").includes("minimal"));
  assert.ok(getReasoningEfforts("gpt-6.1-terra").includes("none"));
});

test("SSE parser preserves Japanese across single-byte chunks and CRLF frames", async () => {
  const bytes = new TextEncoder().encode('event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"日本語"}\r\n\r\ndata: [DONE]\r\n\r\n');
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  assert.deepEqual(await Array.fromAsync(readOpenAIEvents(body)), [{ type: "response.output_text.delta", delta: "日本語" }]);
});

test("tool continuation includes encrypted reasoning, matches call IDs and sums token usage", async (t) => {
  const requests: Record<string, unknown>[] = [];
  const reason = { type: "reasoning", id: "rs_1", encrypted_content: "encrypted", summary: [] };
  const call = { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup", arguments: '{"query":"test"}' };
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    assert.equal(url, "/api/openai/responses");
    assert.equal(new Headers(init.headers).get("Authorization"), null);
    requests.push(JSON.parse(String(init.body)));
    return requests.length === 1 ? stream([completed([reason, call], 3)]) : stream([
      { type: "response.reasoning_summary_text.delta", delta: "考察" },
      { type: "response.output_text.delta", delta: "結果" }, completed([], 2),
    ]);
  });
  const chunks = await collect(openAIChatWithToolsStream("gpt-6.1-sol", messages, [tool], "Instructions", async (name, args) => {
    assert.equal(name, "lookup"); assert.deepEqual(args, { query: "test" }); return { answer: 42 };
  }, { reasoningEffort: "high" }));
  const continuation = requests[1].input as Record<string, unknown>[];
  assert.ok(continuation.some((item) => item.encrypted_content === "encrypted"));
  assert.ok(continuation.some((item) => item.type === "function_call_output" && item.call_id === "call_1" && item.output === '{"answer":42}'));
  assert.equal(chunks.find((chunk) => chunk.type === "tool_call")?.toolCall?.id, "call_1");
  assert.equal(chunks.find((chunk) => chunk.type === "thinking")?.content, "考察");
  assert.deepEqual(chunks.at(-1)?.usage, { inputTokens: 5, outputTokens: 5, thinkingTokens: 0, totalTokens: 10 });
  assert.equal(requests[0].store, false);
});

test("tool budget answers every parallel call but executes only allowed calls, then disables tools", async (t) => {
  const requests: Record<string, unknown>[] = [];
  let executed = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return requests.length === 1 ? stream([completed([1, 2].map((id) => ({ type: "function_call", call_id: `c${id}`, name: "lookup", arguments: "{}" })))]) : stream([completed()]);
  });
  await collect(openAIChatWithToolsStream("gpt-6.1-terra", messages, [tool], undefined, async () => { executed++; return "ok"; }, { functionCallLimits: { maxFunctionCalls: 1 } }));
  assert.equal(executed, 1);
  assert.equal(requests[1].tool_choice, "none");
  assert.equal((requests[1].input as Record<string, unknown>[]).filter((item) => item.type === "function_call_output").length, 2);
});

test("unknown tools consume budget and cannot produce an unbounded loop", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return stream([completed([{ type: "function_call", call_id: `c${requests}`, name: "unknown", arguments: "{}" }])]);
  });
  const chunks = await collect(openAIChatWithToolsStream("gpt-6.1-sol", messages, [tool], undefined, async () => assert.fail("unknown tool executed"), { functionCallLimits: { maxFunctionCalls: 1 } }));
  assert.equal(requests, 2);
  assert.equal(chunks.at(-1)?.type, "error");
});

test("cancelling a tool turn prevents the next tool and API continuation", async (t) => {
  const abort = new AbortController();
  t.mock.method(globalThis, "fetch", async () => stream([completed([1, 2].map((id) => ({ type: "function_call", call_id: `c${id}`, name: "lookup", arguments: "{}" })))]));
  let executed = 0;
  await assert.rejects(collect(openAIChatWithToolsStream("gpt-6.1-sol", messages, [tool], undefined, async () => { executed++; abort.abort(); return "ok"; }, { abortSignal: abort.signal })), { name: "AbortError" });
  assert.equal(executed, 1);
});

test("partial streams and provider errors never emit a successful done", async (t) => {
  for (const response of [stream([{ type: "response.output_text.delta", delta: "partial" }]), stream([{ type: "response.failed", response: { error: { message: "Quota exceeded" } } }]), Response.json({ error: "Key locked" }, { status: 401 })]) {
    t.mock.method(globalThis, "fetch", async () => response);
    const chunks = await collect(openAIChatWithToolsStream("gpt-6.1-sol", messages));
    assert.equal(chunks.at(-1)?.type, "error");
    assert.ok(!chunks.some((chunk) => chunk.type === "done"));
    t.mock.restoreAll();
  }
});

test("images and PDFs retain data while unsupported audio is rejected before transmission", async (t) => {
  const input = messagesToOpenAIInput([{ ...messages[0], attachments: [
    { type: "image", mimeType: "image/png", data: "aGVsbG8=", name: "image.png" },
    { type: "pdf", mimeType: "application/pdf", data: "cGRm", name: "doc.pdf" },
  ] }]);
  const parts = input[0].content as Record<string, unknown>[];
  assert.equal(parts[1].image_url, "data:image/png;base64,aGVsbG8=");
  assert.equal(parts[2].filename, "doc.pdf");
  t.mock.method(globalThis, "fetch", async () => assert.fail("unsupported audio transmitted"));
  const chunks = await collect(openAIChatWithToolsStream("gpt-6.1-sol", [{ ...messages[0], attachments: [{ type: "audio", mimeType: "audio/wav", name: "audio.wav", data: "aA==" }] }]));
  assert.match(chunks[0].error!, /does not support audio/);
});

test("web search emits source links and omits invented Gemini costs", async (t) => {
  t.mock.method(globalThis, "fetch", async () => stream([
    { type: "response.output_text.annotation.added", annotation: { type: "url_citation", title: "Reference", url: "https://example.com" } }, completed(),
  ]));
  const chunks = await collect(openAIChatWithToolsStream("gpt-6.1-sol", messages, [], undefined, undefined, { webSearchEnabled: true }));
  assert.equal(chunks[0].type, "web_search_used");
  assert.equal(chunks.at(-1)?.webSearchSources?.[0].url, "https://example.com");
  assert.equal(chunks.at(-1)?.usage?.totalCost, undefined);
});

test("Drive PDF tool outputs become file inputs after all function results", async (t) => {
  const requests: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return requests.length === 1 ? stream([completed([{ type: "function_call", call_id: "pdf-call", name: "lookup", arguments: "{}" }])]) : stream([completed()]);
  });
  const chunks = await collect(openAIChatWithToolsStream("gpt-6.1-sol", messages, [tool], undefined, async () => ({ __mediaData: { mimeType: "application/pdf", base64: "cGRm", fileName: "range.pdf" } })));
  const input = requests[1].input as Record<string, unknown>[];
  const media = (input.at(-1)?.content as Record<string, unknown>[])[0];
  assert.equal(media.type, "input_file"); assert.equal(media.filename, "range.pdf");
  assert.equal(input.at(-2)?.type, "function_call_output");
  assert.deepEqual(chunks.find((chunk) => chunk.type === "tool_result")?.toolResult?.result, { mediaFile: "range.pdf", mimeType: "application/pdf" });
});

test("long MCP tool names use stable API aliases while the executor receives the original name", async (t) => {
  const name = `mcp_${"long_server_identifier_".repeat(3)}lookup_document`;
  let requests = 0;
  let executed = "";
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const alias = body.tools[0].name;
    assert.match(alias, /^[a-zA-Z0-9_-]{1,64}$/);
    requests++;
    return requests === 1 ? stream([completed([{ type: "function_call", call_id: "long-call", name: alias, arguments: "{}" }])]) : stream([completed()]);
  });
  const chunks = await collect(openAIChatWithToolsStream("gpt-6.1-sol", messages, [{ ...tool, name }], undefined, async (original) => { executed = original; return "ok"; }));
  assert.equal(executed, name);
  assert.equal(chunks.find((chunk) => chunk.type === "tool_call")?.toolCall?.name, name);
});
