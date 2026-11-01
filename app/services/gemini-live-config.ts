import type { LiveOptions } from "./live-session";
import { liveToolDefinitions } from "./live-tool-definitions";

export const GEMINI_LIVE_MODELS = ["gemini-3.8-live", "gemini-3.8-live-extended-thinking", "gemini-3.1-flash-live-preview"] as const;
export const GEMINI_LIVE_VOICES = ["Kore", "Puck", "Aoede", "Charon", "Fenrir", "Leda", "Orus", "Zephyr"] as const;

/** Wire-format setup, also locked into the single-use ephemeral token. */
export function geminiLiveSetup(options: LiveOptions) {
  return {
    model: `models/${options.model}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voice } } },
    },
    systemInstruction: { parts: [{ text: options.instructions || (options.language === "ja" ? "自然な日本語で会話してください。" : "Converse naturally in English.") }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    ...(options.fileAccess ? { tools: [{ functionDeclarations: liveToolDefinitions(options) }] } : {}),
  };
}
