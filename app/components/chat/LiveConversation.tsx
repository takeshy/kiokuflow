import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mic, MicOff, PhoneOff, X } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { OpenAILiveSession, LIVE_MODELS, LIVE_VOICES, type LiveState, type LiveTranscript } from "~/services/openai-live";
import { GeminiLiveSession } from "~/services/gemini-live";
import { GEMINI_LIVE_MODELS, GEMINI_LIVE_VOICES } from "~/services/gemini-live-config";
import type { LiveProvider, LiveSession } from "~/services/live-session";
import type { Message } from "~/types/chat";

export function LiveConversation({ provider, systemPrompt, messages, onClose }: {
  provider: LiveProvider; systemPrompt: string; messages: Message[]; onClose: (transcript: Message[]) => void;
}) {
  const { language } = useI18n();
  const ja = language === "ja";
  const [state, setState] = useState<LiveState>("idle");
  const models = provider === "gemini" ? GEMINI_LIVE_MODELS : LIVE_MODELS;
  const voices = provider === "gemini" ? GEMINI_LIVE_VOICES : LIVE_VOICES;
  const [model, setModel] = useState<string>(models[0]);
  const [voice, setVoice] = useState<string>(voices[0]);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState<LiveTranscript[]>([]);
  const [includeContext, setIncludeContext] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const sessionRef = useRef<LiveSession | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const Session = provider === "gemini" ? GeminiLiveSession : OpenAILiveSession;
    const session = new Session({ audio: audioRef.current!, onState: setState, onTranscript: setTranscript, onError: setError });
    sessionRef.current = session;
    const onPageHide = () => session.stop();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      session.stop(); sessionRef.current = null;
      previousFocus?.focus();
    };
  }, [provider]);
  const close = () => {
    sessionRef.current?.stop();
    const timestamp = Date.now();
    onClose(transcript.filter((item) => item.text.trim()).map((item, index) => ({ role: item.role, content: item.text, timestamp: timestamp + index })));
  };
  // The mobile chat lives in a transformed swipe strip. A portal keeps this
  // fixed overlay relative to the viewport, outside its clipping ancestors.
  const dialog = <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-2 sm:p-4"
    onTouchStart={(event) => event.stopPropagation()}
    onTouchMove={(event) => event.stopPropagation()}
    onTouchEnd={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); close(); }
    if (event.key === "Tab") {
      const elements = panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled),select:not(:disabled),input:not(:disabled),audio[controls]");
      const first = elements?.[0]; const last = elements?.[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="live-title" className="flex max-h-[calc(100dvh-1rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white p-3 text-gray-900 shadow-xl sm:max-h-[90dvh] sm:p-5 dark:bg-gray-900 dark:text-gray-100">
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h2 id="live-title" className="text-lg font-semibold">Live · {provider === "gemini" ? "Gemini" : "OpenAI"}</h2>
        <button ref={closeRef} type="button" onClick={close} aria-label={ja ? "閉じる" : "Close"} className="flex min-h-11 min-w-11 items-center justify-center rounded p-2"><X size={20} /></button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
      <p className="mb-3 text-sm text-gray-500">{ja ? "AIと音声で会話します。API利用料がかかります。応答音声はAIが生成しています。" : "Talk with AI by voice. API charges apply. The voice you hear is AI generated."}</p>
      <div className="mb-3 flex flex-wrap gap-3 text-sm">
        <label className="min-w-0">{ja ? "モデル" : "Model"}<select disabled={state !== "idle"} value={model} onChange={(event) => setModel(event.target.value)} className="ml-2 min-h-11 max-w-full rounded border bg-transparent p-1">
          {models.map((item) => <option key={item}>{item}</option>)}
        </select></label>
        <label>{ja ? "声" : "Voice"}<select disabled={state !== "idle"} value={voice} onChange={(event) => setVoice(event.target.value)} className="ml-2 min-h-11 rounded border bg-transparent p-1">
          {voices.map((item) => <option key={item}>{item}</option>)}
        </select></label>
      </div>
      <p className="mb-3 text-xs text-gray-500">{ja ? `${provider === "gemini" ? "Gemini" : "OpenAI"}の保存済みAPIキーを一般設定でロック解除してから開始してください。` : `Unlock your saved ${provider === "gemini" ? "Gemini" : "OpenAI"} API key in General settings before starting.`}</p>
      <label className="mb-3 text-sm"><input type="checkbox" checked={includeContext} disabled={state !== "idle"} onChange={(event) => setIncludeContext(event.target.checked)} className="mr-2" />{ja ? "現在のチャットを会話の背景として使う" : "Use the current chat as conversation context"}</label>
      <p className="mb-3 text-xs text-gray-500">{ja ? "Liveは音声会話専用です。ファイル操作やMCPツールは通常のチャットで利用できます。終了時に会話テキストをチャットへ追加します。" : "Live is for voice conversations. Use chat for file operations and MCP tools. The transcript is added to chat when you close Live."}</p>
      <p role="status" className="mb-3 text-sm">{state === "connecting" ? (ja ? "接続中…" : "Connecting…") : state === "connected" ? (ja ? "会話中" : "Connected") : (ja ? "停止中" : "Stopped")}</p>
      {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
      <div role="log" aria-label={ja ? "会話テキスト" : "Conversation transcript"} className="mb-3 max-h-[30dvh] min-h-24 space-y-3 overflow-y-auto overscroll-contain rounded border p-3 text-sm">
        {transcript.map((item) => <p key={item.id} className="whitespace-pre-wrap"><strong>{item.role === "user" ? (ja ? "あなた" : "You") : "AI"}: </strong>{item.text}</p>)}
      </div>
      <audio ref={audioRef} autoPlay controls playsInline className="mb-3 w-full" aria-label={ja ? "会話音声" : "Conversation audio"} />
      </div>
      <div className="flex shrink-0 flex-wrap gap-3 pt-2 pb-[env(safe-area-inset-bottom)]">
        {state === "idle" && transcript.length > 0 ? <button type="button" onClick={close} className="min-h-11 rounded bg-blue-600 px-4 py-2 text-white">{ja ? "チャットへ戻る" : "Return to chat"}</button> : state === "idle" ? <button type="button" onClick={() => {
          setError(""); setMuted(false);
          const context = includeContext ? messages.slice(-20).map((item) => `${item.role}: ${item.content}`).join("\n").slice(-40_000) : "";
          void sessionRef.current?.start({ model, voice, language: ja ? "ja" : "en", instructions: [systemPrompt, ja ? "自然な日本語で会話してください。" : "Converse naturally in English.", context ? `Prior text conversation for context:\n${context}` : ""].filter(Boolean).join("\n\n") });
        }} className="min-h-11 rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{ja ? "会話を開始" : "Start conversation"}</button> : <>
          <button type="button" onClick={() => { sessionRef.current?.mute(!muted); setMuted(!muted); }} disabled={state !== "connected"} className="flex min-h-11 items-center gap-2 rounded border px-3 py-2 disabled:opacity-50" aria-pressed={muted}>{muted ? <MicOff size={18} /> : <Mic size={18} />}{muted ? (ja ? "ミュート解除" : "Unmute") : (ja ? "ミュート" : "Mute")}</button>
          <button type="button" onClick={close} className="flex min-h-11 items-center gap-2 rounded bg-red-600 px-3 py-2 text-white"><PhoneOff size={18} />{ja ? "会話を終了" : "End conversation"}</button>
        </>}
      </div>
    </div>
  </div>;
  return typeof document === "undefined" ? null : createPortal(dialog, document.body);
}
