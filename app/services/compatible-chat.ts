import { COMPATIBLE_PROVIDERS, type CompatibleProvider } from "~/types/settings";
import type { OpenAIChatOptions, OpenAIEvent } from "./openai-chat";
import { readSseJson } from "./sse-json";

type Item = Record<string, unknown>;
interface ChatEvent {
  error?: { message?: string };
  choices?: { delta?: { content?: string; reasoning?: string; reasoning_content?: string; reasoning_details?: Item[]; annotations?: { type?: string; url_citation?: { url: string; title?: string } }[]; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
}

/** Translate the shared tool history to Chat Completions, preserving reasoning. */
export function compatibleMessages(input: Item[], instructions?: string): Item[] {
  const messages: Item[] = instructions ? [{ role: "system", content: instructions }] : [];
  for (const item of input) {
    if (item.type === "compatible_message") { messages.push(item.message as Item); continue; }
    if (item.type === "function_call") {
      if (item.compatible) continue; // Already contained in compatible_message.
      const call = { id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } };
      const previous = messages.at(-1);
      if (previous?.role === "assistant" && previous.tool_calls) (previous.tool_calls as Item[]).push(call);
      else messages.push({ role: "assistant", content: null, tool_calls: [call] });
    } else if (item.type === "function_call_output") messages.push({ role: "tool", tool_call_id: item.call_id, content: item.output });
    else if (item.role) {
      const content = Array.isArray(item.content) ? (item.content as Item[]).map(part => {
        if (part.type === "input_text") return { type: "text", text: part.text };
        if (part.type === "input_image") return { type: "image_url", image_url: { url: part.image_url } };
        if (part.type === "input_file") return { type: "file", file: { filename: part.filename, file_data: part.file_data } };
        throw new Error("Unsupported provider attachment");
      }) : item.content;
      messages.push({ role: item.role, content });
    }
  }
  return messages;
}

/** Same value as compatibleSessionId() on the proxy path; Web Crypto keeps this module browser-safe. */
async function workspaceSessionId(root: string, conversation: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${root}:${conversation}`));
  return `gemihub-${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Adapt provider chunks to the shared bounded tool loop used by OpenAI. */
export async function* compatibleChatEvents(
  selection: { provider: CompatibleProvider; model: string },
  request: { input: Item[]; instructions?: string; tools?: Item[]; tool_choice?: string },
  sessionId: string,
  options: OpenAIChatOptions,
): AsyncGenerator<OpenAIEvent> {
  const { provider, model } = selection;
  const definition = COMPATIBLE_PROVIDERS[provider];
  if (options.webSearchEnabled && provider !== "openrouter") throw new Error("Use a web search MCP tool with OpenCode Go.");
  const effort = options.reasoningEffort;
  const body = {
    model, messages: compatibleMessages(request.input, request.instructions), sessionId,
    ...(request.tools?.some(tool => tool.type === "function") ? { tools: request.tools.filter(tool => tool.type === "function").map(({ name, description, parameters }) => ({ type: "function", function: { name, description, parameters } })) } : {}),
    ...(request.tool_choice ? { tool_choice: request.tool_choice } : {}),
    ...(effort && ["none", "low", "medium", "high"].includes(effort) ? provider === "openrouter" ? { reasoning: { effort, exclude: false } } : { reasoning_effort: effort } : {}),
    ...(options.webSearchEnabled ? { webSearch: true } : {}),
  };
  const { sessionId: _sessionId, webSearch: _webSearch, ...upstream } = body;
  let upstreamSession = sessionId;
  if (options.serverApiKey) {
    if (!options.serverCompatible?.providers?.[provider]?.enabledModels.includes(model)) throw new Error("Enable this model in Settings > AI providers.");
    upstreamSession = await workspaceSessionId(options.serverCompatible.rootFolderId, sessionId);
  }
  const response = await fetch(options.serverApiKey ? `${definition.baseUrl}/chat/completions` : `/api/ai-providers/${provider}/chat`, {
    method: "POST", headers: {
      "Content-Type": "application/json",
      ...(options.serverApiKey ? { Authorization: `Bearer ${options.serverApiKey}`, ...(provider === "opencodego" ? { "User-Agent": "kiokuflow/1.0", "x-opencode-session": upstreamSession } : { "X-Title": "kiokuflow" }) } : {}),
    },
    body: JSON.stringify(options.serverApiKey ? { ...upstream, stream: true, stream_options: { include_usage: true }, ...(options.webSearchEnabled ? { plugins: [{ id: "web" }] } : {}) } : body),
    signal: options.abortSignal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(typeof error?.error === "string" ? error.error : error?.error?.message || `${definition.name} HTTP ${response.status}`);
  }
  if (!response.body) throw new Error(`${definition.name} returned an empty stream`);
  let content = "";
  let reasoning = "";
  const reasoningDetails = new Map<string, Item>();
  const calls = new Map<number, { id: string; type: "function"; function: { name: string; arguments: string } }>();
  let usage: ChatEvent["usage"];
  let finished = false;
  for await (const event of readSseJson<ChatEvent>(response.body)) {
    options.abortSignal?.throwIfAborted();
    if (event.error) throw new Error(event.error.message || `${definition.name} stream error`);
    if (event.usage) usage = event.usage;
    const choice = event.choices?.[0];
    const delta = choice?.delta;
    if (delta?.content) { content += delta.content; yield { type: "response.output_text.delta", delta: delta.content }; }
    const thinking = delta?.reasoning_content || delta?.reasoning;
    if (thinking) { reasoning += thinking; yield { type: "response.reasoning_summary_text.delta", delta: thinking }; }
    for (const detail of delta?.reasoning_details || []) {
      const key = `${detail.index ?? detail.id ?? 0}:${detail.type}`;
      const previous = reasoningDetails.get(key);
      const merged = { ...previous, ...detail };
      for (const field of ["text", "data", "summary"]) if (typeof previous?.[field] === "string" && typeof detail[field] === "string") merged[field] = previous[field] + detail[field];
      reasoningDetails.set(key, merged);
    }
    for (const annotation of delta?.annotations || []) if (annotation.type === "url_citation" && annotation.url_citation) yield { type: "response.output_text.annotation.added", annotation: { type: "url_citation", ...annotation.url_citation } };
    for (const part of delta?.tool_calls || []) {
      const call = calls.get(part.index) || { id: "", type: "function" as const, function: { name: "", arguments: "" } };
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
      calls.set(part.index, call);
    }
    if (choice?.finish_reason) {
      if (!["stop", "tool_calls", "function_call"].includes(choice.finish_reason)) throw new Error(`${definition.name} response ended: ${choice.finish_reason}`);
      finished = true;
    }
  }
  if (!finished) throw new Error(`${definition.name} stream ended before completion`);
  const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
  if (toolCalls.some(call => !call.id || !call.function.name)) throw new Error("Invalid provider tool call");
  const message = { role: "assistant", content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}), ...(provider === "openrouter" && reasoningDetails.size ? { reasoning_details: [...reasoningDetails.values()] } : reasoning ? { reasoning_content: reasoning } : {}) };
  yield { type: "response.completed", response: {
    output: [ { type: "compatible_message", message }, ...toolCalls.map(call => ({ type: "function_call", compatible: true, call_id: call.id, name: call.function.name, arguments: call.function.arguments })) ],
    usage: { input_tokens: usage?.prompt_tokens, output_tokens: usage?.completion_tokens, total_tokens: usage?.total_tokens, output_tokens_details: { reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens } },
  } };
}
