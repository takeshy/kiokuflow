import type { Message, StreamChunk, StreamChunkUsage, WebSearchSource } from "~/types/chat";
import type { ModelType, ToolDefinition, UserSettings } from "~/types/settings";
import type { ChatWithToolsOptions } from "./gemini-chat-core";
import { isDriveToolMediaResult } from "./gemini-content-builders";

type Item = Record<string, unknown>;
interface ResponseOutput extends Item {
  type: string;
  call_id?: string;
  name?: string;
  arguments?: string;
}
interface OpenAIResponse {
  status?: string;
  output?: ResponseOutput[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } };
  error?: { message?: string };
  incomplete_details?: { reason?: string };
}
export interface OpenAIEvent {
  type: string;
  delta?: string;
  response?: OpenAIResponse;
  message?: string;
  error?: { message?: string };
  annotation?: { type?: string; url?: string; title?: string };
}

export { readSseJson as readOpenAIEvents } from "./sse-json";
import { readSseJson } from "./sse-json";
import { compatibleChatEvents } from "./compatible-chat";
import { parseCompatibleModel } from "~/types/settings";

function imagePart(mimeType: string, data: string): Item {
  return { type: "input_image", image_url: `data:${mimeType};base64,${data}`, detail: "auto" };
}

// MCP names contain a server identifier and can exceed OpenAI's 64-character
// limit. Keep a stable alias in API history while dispatching the original name.
function openAIToolName(name: string): string {
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(name)) return name;
  let hash = 2166136261;
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 56)}_${(hash >>> 0).toString(36)}`;
}

export function messagesToOpenAIInput(messages: Message[]): Item[] {
  const input: Item[] = [];
  for (const message of messages) {
    // Preserve only complete historic tool pairs. Interrupted calls have no
    // output and must not make a future turn an invalid Responses request.
    if (message.role === "assistant") {
      for (const call of message.toolCalls || []) {
        const result = message.toolResults?.find((item) => item.toolCallId === call.id);
        if (!result) continue;
        input.push({ type: "function_call", call_id: call.id, name: openAIToolName(call.name), arguments: JSON.stringify(call.args) });
        input.push({ type: "function_call_output", call_id: call.id, output: JSON.stringify(result.result) ?? "null" });
      }
      if (message.content) input.push({ role: "assistant", content: message.content });
      continue;
    }
    const content: Item[] = [];
    if (message.content) content.push({ type: "input_text", text: message.content });
    for (const attachment of message.attachments || []) {
      if (attachment.type === "image") content.push(imagePart(attachment.mimeType, attachment.data));
      else if (attachment.type === "pdf") content.push({ type: "input_file", filename: attachment.name, file_data: `data:application/pdf;base64,${attachment.data}` });
      else if (attachment.type === "text") {
        const bytes = Uint8Array.from(atob(attachment.data), (char) => char.charCodeAt(0));
        content.push({ type: "input_text", text: `${attachment.name}:\n${new TextDecoder().decode(bytes)}` });
      } else throw new Error(`OpenAI chat does not support ${attachment.type} attachments. Choose Gemini for this file.`);
    }
    if (content.length) input.push({ role: "user", content });
  }
  return input;
}

export interface OpenAIChatOptions extends ChatWithToolsOptions {
  abortSignal?: AbortSignal;
  /** Server callers only. The browser uses the authenticated same-origin proxy. */
  serverApiKey?: string;
  /** Server callers using a compatible provider: the workspace and its enabled
   *  models, enforced the same way as the browser proxy. */
  serverCompatible?: { rootFolderId: string; providers?: UserSettings["compatibleProviders"] };
}

export async function* openAIChatWithToolsStream(
  model: ModelType,
  messages: Message[],
  tools: ToolDefinition[] = [],
  systemPrompt?: string,
  executeToolCall?: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  options: OpenAIChatOptions = {},
): AsyncGenerator<StreamChunk> {
  try {
    const input = messagesToOpenAIInput(messages);
    if (!input.length) throw new Error("No message to send");
    const definitions = options.disableTools ? [] : tools;
    const knownTools = new Map(definitions.map((tool) => [openAIToolName(tool.name), tool.name]));
    const requestTools: Item[] = definitions.map((tool) => ({ type: "function", name: openAIToolName(tool.name), description: tool.description, parameters: tool.parameters, strict: false }));
    if (options.webSearchEnabled) requestTools.push({ type: "web_search" });
    const effort = options.reasoningEffort ?? (options.enableThinking === true ? "high" : "default");
    const baseLimit = Math.max(0, options.functionCallLimits?.maxFunctionCalls ?? 50);
    let limit = baseLimit;
    let used = 0;
    let lastPromptLimit = -1;
    let finalRound = limit === 0;
    const usage: StreamChunkUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, thinkingTokens: 0 };
    const sources: WebSearchSource[] = [];
    while (true) {
      options.abortSignal?.throwIfAborted();
      const requestBody = {
        model, input, instructions: systemPrompt,
        ...(requestTools.length ? { tools: requestTools } : {}),
        ...(finalRound ? { tool_choice: "none" } : {}),
        ...(effort !== "default" && !/^(?:ft:)?(?:gpt-4|chatgpt-4)/i.test(model) ? { reasoning: { effort, summary: "auto" } } : {}),
      };
      const compatible = parseCompatibleModel(model);
      const response = compatible ? undefined : await fetch(options.serverApiKey ? "https://api.openai.com/v1/responses" : "/api/openai/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(options.serverApiKey ? { Authorization: `Bearer ${options.serverApiKey}` } : {}) },
        body: JSON.stringify({ ...requestBody, stream: true, store: false, include: ["reasoning.encrypted_content"] }),
        signal: options.abortSignal,
      });
      if (response && !response.ok) {
        const error = await response.json().catch(() => null) as { error?: string | { message?: string } } | null;
        throw new Error(typeof error?.error === "string" ? error.error : error?.error?.message || `OpenAI HTTP ${response.status}`);
      }
      if (!compatible && !response?.body) throw new Error("OpenAI returned an empty stream");
      let completed: OpenAIResponse | undefined;
      const events = compatible
        ? compatibleChatEvents(compatible, requestBody, `gemihub-${messages[0]?.timestamp}-${messages[0]?.role}`, options)
        : readSseJson<OpenAIEvent>(response!.body!);
      for await (const event of events) {
        options.abortSignal?.throwIfAborted();
        if (event.type === "response.output_text.delta" && event.delta) yield { type: "text", content: event.delta };
        else if (event.type === "response.reasoning_summary_text.delta" && event.delta) yield { type: "thinking", content: event.delta };
        else if (event.type === "response.output_text.annotation.added" && event.annotation?.type === "url_citation" && event.annotation.url) {
          if (!sources.some((source) => source.url === event.annotation!.url)) sources.push({ url: event.annotation.url, title: event.annotation.title || event.annotation.url });
        } else if (event.type === "response.completed") completed = event.response;
        else if (event.type === "error" || event.type === "response.failed" || event.type === "response.incomplete") {
          throw new Error(event.error?.message || event.message || event.response?.error?.message || `OpenAI response failed: ${event.response?.incomplete_details?.reason || event.type}`);
        }
      }
      if (!completed) throw new Error("OpenAI stream ended before the response completed");
      usage.inputTokens! += completed.usage?.input_tokens ?? 0;
      usage.outputTokens! += completed.usage?.output_tokens ?? 0;
      usage.totalTokens! += completed.usage?.total_tokens ?? 0;
      usage.thinkingTokens! += completed.usage?.output_tokens_details?.reasoning_tokens ?? 0;
      // Include reasoning (with encrypted_content) and assistant output on
      // every tool continuation; store:false needs the full stateless input.
      input.push(...(completed.output || []));
      const calls = (completed.output || []).filter((item) => item.type === "function_call");
      if (!calls.length) break;
      if (finalRound) throw new Error("OpenAI requested tools after the tool limit");
      const threshold = options.functionCallLimits?.functionCallWarningThreshold ?? 10;
      if (limit - used - calls.length <= threshold && lastPromptLimit !== limit && options.functionCallLimits?.requestLimitExtension) {
        lastPromptLimit = limit;
        const extension = await options.functionCallLimits.requestLimitExtension({ used, currentLimit: limit, extensionAmount: baseLimit, pendingCalls: calls.length, remaining: Math.max(0, limit - used) });
        if (extension === true) limit += baseLimit;
        else if (typeof extension === "number" && Number.isFinite(extension) && extension > 0) limit += Math.floor(extension);
      }
      const mediaParts: Item[] = [];
      for (const call of calls) {
        options.abortSignal?.throwIfAborted();
        if (!call.call_id || !call.name) throw new Error("Invalid OpenAI function call");
        let result: unknown;
        let media: Item | undefined;
        const args: unknown = JSON.parse(call.arguments || "{}");
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid OpenAI tool arguments");
        const originalName = knownTools.get(call.name);
        const toolCall = { id: call.call_id, name: originalName || call.name, args: args as Record<string, unknown> };
        yield { type: "tool_call", toolCall };
        if (used >= limit) result = { error: "Function call limit reached. Provide a final answer using available information." };
        else {
          used++;
          try { result = originalName && executeToolCall ? await executeToolCall(originalName, toolCall.args) : { error: `Unknown or disabled tool: ${call.name}` }; }
          catch (error) {
            options.abortSignal?.throwIfAborted();
            result = { error: error instanceof Error ? error.message : String(error) };
          }
          if (isDriveToolMediaResult(result)) {
            const data = result.__mediaData;
            if (data.mimeType.startsWith("image/")) media = imagePart(data.mimeType, data.base64);
            else if (data.mimeType === "application/pdf") media = { type: "input_file", filename: data.fileName, file_data: `data:application/pdf;base64,${data.base64}` };
            result = { mediaFile: data.fileName, mimeType: data.mimeType, ...(!media ? { error: "This media type cannot be passed to OpenAI chat." } : {}) };
          }
        }
        yield { type: "tool_result", toolResult: { toolCallId: call.call_id, result } };
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) ?? "null" });
        if (media) mediaParts.push(media);
      }
      if (mediaParts.length) input.push({ role: "user", content: mediaParts });
      finalRound = used >= limit;
    }
    if (sources.length) yield { type: "web_search_used", ragSources: sources.map((source) => source.title), webSearchSources: sources };
    yield { type: "done", usage, ...(sources.length ? { webSearchSources: sources } : {}) };
  } catch (error) {
    if (options.abortSignal?.aborted) throw error;
    yield { type: "error", error: error instanceof Error ? error.message : String(error) };
  }
}
