import { activeSettingsProvider } from "~/utils/provider-default-models";
import type { UserSettings } from "~/types/settings";

export type LiveProvider = "gemini" | "openai";
export type LiveState = "idle" | "connecting" | "connected";
export interface LiveTranscript { id: string; role: "user" | "assistant"; text: string }
export interface LiveOptions { model: string; voice: string; instructions: string; language: "ja" | "en" }
export interface LiveCallbacks {
  audio: HTMLAudioElement;
  onState: (state: LiveState) => void;
  onTranscript: (transcript: LiveTranscript[]) => void;
  onError: (message: string) => void;
}
export interface LiveSession {
  start(options: LiveOptions): Promise<void>;
  stop(): void;
  mute(muted: boolean): void;
}

/** Live follows the saved chat provider; Vertex and compatible services have no Live path. */
export function getLiveProvider(settings: UserSettings, project: unknown = null): LiveProvider | null {
  if (project) return null;
  const provider = activeSettingsProvider(settings);
  return provider === "apikey" ? "gemini" : provider === "openai" ? "openai" : null;
}
