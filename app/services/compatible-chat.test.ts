import assert from "node:assert/strict";
import test from "node:test";
import { openAIChatWithToolsStream } from "./openai-chat";
import { getAvailableModels, getChatApiKey, parseCompatibleModel, DEFAULT_USER_SETTINGS } from "~/types/settings";
import { usesInteractions, availableChatModels } from "~/hooks/chat-dispatch";

const messages = [{ role: "user" as const, content: "調べて", timestamp: 1234 }];
interface SentBody {
  model: string;
  messages: { role: string; tool_calls?: unknown[]; reasoning_details?: unknown; reasoning_content?: string }[];
  input?: unknown;
  webSearch?: boolean;
  sessionId?: string;
  tool_choice?: string;
}
const tool = { name: "lookup", description: "Look up", parameters: { type: "object", properties: {} } };
async function collect<T>(stream: AsyncIterable<T>) { const items: T[] = []; for await (const item of stream) items.push(item); return items; }
function stream(events: unknown[]) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n");
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }));
}
const text = (content = "完了") => ({ choices: [{ delta: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });

test("OpenRouter streams text and reasoning, assembles split tool arguments, and replays reasoning details", async t => {
  const bodies: SentBody[] = [];
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    assert.equal(url, "/api/ai-providers/openrouter/chat");
    bodies.push(JSON.parse(String(init.body)));
    return bodies.length === 1 ? stream([
      { choices: [{ delta: { reasoning: "考察", reasoning_details: [{ index: 0, type: "reasoning.encrypted", data: "opaque" }], tool_calls: [{ index: 0, id: "call-one", function: { name: "lookup", arguments: '{"q":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"例"}' } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } },
    ]) : stream([text()]);
  });
  const result = await collect(openAIChatWithToolsStream("openrouter:vendor/model", messages, [tool], "System", async (name, args) => {
    assert.equal(name, "lookup"); assert.deepEqual(args, { q: "例" }); return { found: true };
  }, { webSearchEnabled: true, reasoningEffort: "high" }));
  assert.equal(result.find(chunk => chunk.type === "thinking")?.content, "考察");
  assert.equal(result.find(chunk => chunk.type === "text")?.content, "完了");
  assert.deepEqual(result.at(-1)?.usage, { inputTokens: 5, outputTokens: 3, totalTokens: 8, thinkingTokens: 0 });
  assert.equal(bodies[0].model, "vendor/model");
  assert.equal(bodies[0].webSearch, true);
  const assistant = bodies[1].messages.find((message) => message.tool_calls);
  assert.deepEqual(assistant.reasoning_details, [{ index: 0, type: "reasoning.encrypted", data: "opaque" }]);
  assert.equal(bodies[1].messages.at(-1).role, "tool");
  assert.equal(bodies[0].sessionId, bodies[1].sessionId);
  assert.equal(bodies[0].input, undefined);
});

test("Go uses its own key and fixed destination, bare model ID, and stable conversation routing across tool rounds", async t => {
  const headers: Headers[] = [];
  const bodies: SentBody[] = [];
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    assert.equal(url, "https://opencode.ai/zen/go/v1/chat/completions");
    headers.push(new Headers(init.headers)); bodies.push(JSON.parse(String(init.body)));
    return bodies.length === 1 ? stream([{ choices: [{ delta: { reasoning_content: "plan", tool_calls: [{ index: 0, id: "c1", function: { name: "lookup", arguments: "{}" } }, { index: 1, id: "c2", function: { name: "lookup", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }]) : stream([text()]);
  });
  let executed = 0;
  const result = await collect(openAIChatWithToolsStream("opencodego:glm-5.3", messages, [tool], undefined, async () => { executed++; return "found"; }, { serverApiKey: "synthetic-go-key", serverCompatible: { rootFolderId: "root", providers: { opencodego: { enabledModels: ["glm-5.3"] } as never } }, functionCallLimits: { maxFunctionCalls: 1 } }));
  assert.equal(executed, 1);
  assert.equal(result.at(-1)?.type, "done");
  assert.equal(headers[0].get("Authorization"), "Bearer synthetic-go-key");
  assert.equal(headers[0].get("User-Agent"), "gemihub/1.0");
  assert.equal(headers[0].get("x-opencode-session"), headers[1].get("x-opencode-session"));
  assert.match(headers[0].get("x-opencode-session") || "", /^gemihub-[a-f0-9]{64}$/);
  assert.equal(bodies[0].model, "glm-5.3");
  assert.equal(bodies[1].tool_choice, "none");
  assert.equal(bodies[1].messages.filter((message) => message.role === "tool").length, 2);
  assert.equal(bodies[1].messages.find((message) => message.tool_calls).reasoning_content, "plan");
  assert.equal(bodies[0].sessionId, undefined);
});

test("server-side calls reject compatible models that are not enabled", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("disabled model reached the provider"));
  for (const serverCompatible of [undefined, { rootFolderId: "root", providers: { opencodego: { enabledModels: ["other"] } as never } }]) {
    const result = await collect(openAIChatWithToolsStream("opencodego:glm-5.3", messages, [], undefined, undefined, { serverApiKey: "synthetic-go-key", serverCompatible }));
    assert.match(result.at(-1)?.error || "", /Enable this model/);
  }
});

test("provider errors, truncated streams, and native Go web search fail explicitly", async t => {
  t.mock.method(globalThis, "fetch", async () => stream([{ choices: [{ delta: { content: "partial" } }] }]));
  const truncated = await collect(openAIChatWithToolsStream("openrouter:vendor/model", messages));
  assert.match(truncated.at(-1)?.error || "", /ended before completion/);
  const unsupported = await collect(openAIChatWithToolsStream("opencodego:glm-5.3", messages, [], undefined, undefined, { webSearchEnabled: true }));
  assert.match(unsupported.at(-1)?.error || "", /web search MCP/);
});

test("configured models stay provider-qualified and use only their own unlocked key", () => {
  const providers = { openrouter: { encryptedApiKey: "cipher", salt: "salt", availableModels: [{ id: "vendor/model", name: "Model" }], enabledModels: ["vendor/model"] } };
  assert.ok(getAvailableModels("free", false, providers).some(model => model.name === "openrouter:vendor/model"));
  assert.equal(usesInteractions({ apiPlan: "paid" }, "openrouter:vendor/model"), false);
  assert.equal(getChatApiKey("openrouter:vendor/model", { geminiApiKey: "gemini", openaiApiKey: "openai" }), undefined);
  assert.equal(getChatApiKey("opencodego:glm-5.3", { compatibleApiKeys: { openrouter: "router", opencodego: "go" } }), "go");
  assert.equal(parseCompatibleModel("openrouter:https://attacker.invalid/path\n"), null);
  assert.equal(availableChatModels(null, "paid", { ...DEFAULT_USER_SETTINGS, usePersonalVertex: true, compatibleProviders: providers }).some(model => model.name.startsWith("openrouter:")), false);
  assert.equal(availableChatModels({ projectId: "project", orgId: "org", allowedModels: [] }, "paid", { compatibleProviders: providers }).some(model => model.name.startsWith("openrouter:")), false);
});
