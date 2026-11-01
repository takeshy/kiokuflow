import {
  GoogleGenAI,
  FinishReason,
  HarmCategory,
  HarmBlockThreshold,
  type SafetySetting,
} from "@google/genai";
import type { ModelType } from "~/types/settings";
import { getThinkingConfig } from "~/services/gemini-chat-core";
import { isExternalChatModel } from "~/types/settings";
import { openAIChatWithToolsStream, type OpenAIChatOptions } from "~/services/openai-chat";

// Default safety settings per Gemini best practices
export const DEFAULT_SAFETY_SETTINGS: SafetySetting[] = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

function checkFinishReason(candidates: Array<{ finishReason?: string }> | undefined): string | null {
  if (!candidates || candidates.length === 0) return null;
  const reason = candidates[0].finishReason;
  if (reason === FinishReason.SAFETY) {
    return "Response blocked by safety filters. Please rephrase your message.";
  }
  if (reason === FinishReason.RECITATION) {
    return "Response blocked due to potential recitation of copyrighted content.";
  }
  return null;
}

export async function generateWorkflow(
  userPrompt: string,
  systemPrompt: string,
  apiKey: string,
  model: ModelType = "gemini-3.8-flash",
  serverCompatible?: OpenAIChatOptions["serverCompatible"],
): Promise<string> {
  if (isExternalChatModel(model)) {
    let text = "";
    for await (const chunk of openAIChatWithToolsStream(model, [{ role: "user", content: userPrompt, timestamp: Date.now() }], [], systemPrompt, undefined, { serverApiKey: apiKey, serverCompatible, disableTools: true })) {
      if (chunk.type === "error") throw new Error(chunk.error);
      if (chunk.type === "text") text += chunk.content || "";
    }
    return text.match(/```(?:yaml)?\s*([\s\S]*?)```/)?.[1]?.trim() ?? text;
  }
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      safetySettings: DEFAULT_SAFETY_SETTINGS,
    },
  });

  let text = response.text || "";

  // Extract YAML from code block if present
  const codeBlockMatch = text.match(/```(?:yaml)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  return text;
}

// Streaming workflow generation with thinking support
export interface WorkflowStreamChunk {
  type: "thinking" | "text" | "error" | "done";
  content?: string;
}

export async function* generateWorkflowStream(
  userPrompt: string,
  systemPrompt: string,
  apiKey: string,
  model: ModelType = "gemini-3.8-flash",
  history?: Array<{ role: "user" | "model"; text: string }>,
  serverCompatible?: OpenAIChatOptions["serverCompatible"],
): AsyncGenerator<WorkflowStreamChunk> {
  try {
    if (isExternalChatModel(model)) {
      const messages = (history || []).map((message) => ({ role: message.role === "model" ? "assistant" as const : "user" as const, content: message.text, timestamp: Date.now() }));
      messages.push({ role: "user", content: userPrompt, timestamp: Date.now() });
      for await (const chunk of openAIChatWithToolsStream(model, messages, [], systemPrompt, undefined, { serverApiKey: apiKey, serverCompatible, disableTools: true })) {
        if (chunk.type === "text" || chunk.type === "thinking" || chunk.type === "done") yield { type: chunk.type, content: chunk.content };
        else if (chunk.type === "error") yield { type: "error", content: chunk.error };
      }
      return;
    }
    const ai = new GoogleGenAI({ apiKey });

    // Always enable thinking for workflow generation (quality improvement)
    const thinkingConfig = getThinkingConfig(model, true);

    // Build contents with history for regeneration
    const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
    if (history && history.length > 0) {
      for (const msg of history) {
        contents.push({
          role: msg.role,
          parts: [{ text: msg.text }],
        });
      }
    }
    contents.push({
      role: "user",
      parts: [{ text: userPrompt }],
    });

    const response = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: systemPrompt,
        safetySettings: DEFAULT_SAFETY_SETTINGS,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    });

    for await (const chunk of response) {
      // Check finishReason for blocked responses (before content check —
      // blocked responses may have finishReason but no content.parts)
      const blockReason = checkFinishReason(chunk.candidates as Array<{ finishReason?: string }> | undefined);
      if (blockReason) {
        yield { type: "error", content: blockReason };
        return;
      }

      if (!chunk.candidates?.[0]?.content?.parts) continue;

      for (const part of chunk.candidates[0].content.parts) {
        if (part.thought && part.text) {
          yield { type: "thinking", content: part.text };
        } else if (part.text) {
          yield { type: "text", content: part.text };
        }
      }
    }

    yield { type: "done" };
  } catch (err) {
    yield {
      type: "error",
      content: err instanceof Error ? err.message : String(err),
    };
  }
}
