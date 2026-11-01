import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mic, MicOff, PhoneOff, X } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { OpenAILiveSession, LIVE_MODELS, LIVE_VOICES, type LiveState, type LiveTranscript } from "~/services/openai-live";
import { GeminiLiveSession } from "~/services/gemini-live";
import { GEMINI_LIVE_MODELS, GEMINI_LIVE_VOICES } from "~/services/gemini-live-config";
import type { LiveProvider, LiveSession } from "~/services/live-session";
import { createLiveFileToolRunner, type LiveFileContext } from "~/services/live-file-tools";
import { LIVE_FILE_INSTRUCTIONS } from "~/services/live-tool-definitions";
import { resolveRagTopK } from "~/services/rag-search-options";
import type { RagSetting } from "~/types/settings";
import type { Message } from "~/types/chat";

export function LiveConversation({ provider, systemPrompt, messages, fileContext, ragSettings, selectedRagSetting, onClose }: {
  provider: LiveProvider; systemPrompt: string; messages: Message[]; fileContext: LiveFileContext;
  ragSettings?: Record<string, RagSetting>; selectedRagSetting?: string | null; onClose: (transcript: Message[]) => void;
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
  const transcriptRef = useRef<LiveTranscript[]>([]);
  const [fileAccess, setFileAccess] = useState(true);
  const [ragName, setRagName] = useState(selectedRagSetting || "");
  const [toolStatus, setToolStatus] = useState("");
  const activeToolsRef = useRef(new Map<string, { status: string }>());
  const fileContextRef = useRef(fileContext);
  fileContextRef.current = fileContext;
  const toolRunnerRef = useRef<ReturnType<typeof createLiveFileToolRunner> | null>(null);
  const [includeContext, setIncludeContext] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const sessionRef = useRef<LiveSession | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const Session = provider === "gemini" ? GeminiLiveSession : OpenAILiveSession;
    const session = new Session({
      audio: audioRef.current!, onState: value => { setState(value); if (value === "idle") { activeToolsRef.current.clear(); setToolStatus(""); } },
      onTranscript: value => { transcriptRef.current = value; }, onError: setError,
      onToolCall: async (call, signal) => {
        const activity = { status: call.name === "search_rag" ? "RAG" : call.name.includes("search") ? "search" : "read" };
        activeToolsRef.current.set(call.id, activity); setToolStatus(activity.status);
        const finish = () => {
          if (activeToolsRef.current.get(call.id) !== activity) return;
          activeToolsRef.current.delete(call.id);
          setToolStatus([...activeToolsRef.current.values()].at(-1)?.status || "");
        };
        signal.addEventListener("abort", finish, { once: true });
        try {
          if (!toolRunnerRef.current) throw new Error("File access is not enabled.");
          return await toolRunnerRef.current(call, signal);
        } finally { signal.removeEventListener("abort", finish); finish(); }
      },
    });
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
    onClose(transcriptRef.current.filter((item) => item.text.trim()).map((item, index) => ({ role: item.role, content: item.text, timestamp: timestamp + index })));
  };
  // The mobile chat lives in a transformed swipe strip. A portal keeps this
  // fixed overlay relative to the viewport, outside its clipping ancestors.
  const dialog = <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-2 sm:p-4"
    onPointerDown={() => {
      if (state === "connected") void audioRef.current?.play().then(() => { if (/audio/i.test(error)) setError(""); }).catch(() => {});
    }}
    onTouchStart={(event) => event.stopPropagation()}
    onTouchMove={(event) => event.stopPropagation()}
    onTouchEnd={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); close(); }
    if (event.key === "Tab") {
      const elements = panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled),select:not(:disabled),input:not(:disabled)");
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
      <label className="mt-3 mb-2 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={fileAccess} disabled={state !== "idle"} onChange={event => setFileAccess(event.target.checked)} />{ja ? "ファイルを参照・検索する" : "Read and search files"}</label>
      {fileAccess && <p className="mb-2 text-xs text-gray-500">{fileContext.currentFile ? (ja ? `現在のファイル：${fileContext.currentFile.name}` : `Current file: ${fileContext.currentFile.name}`) : (ja ? "ファイル名や内容を話しかけて検索できます。" : "Ask to find a file by its name or content.")}</p>}
      {fileAccess && ragSettings && Object.values(ragSettings).some(setting => setting.storeId) && <label className="mb-3 block text-sm">RAG<select value={ragName} disabled={state !== "idle"} onChange={event => setRagName(event.target.value)} className="mt-1 min-h-11 w-full rounded border bg-transparent p-1"><option value="">{ja ? "使用しない" : "Do not use"}</option>{Object.entries(ragSettings).filter(([, setting]) => setting.storeId).map(([name]) => <option key={name} value={name}>{name}</option>)}</select></label>}
      <p className="mb-3 text-xs text-gray-500">{ja ? "ファイルは読み取り専用です。終了時に会話をチャット履歴へ保存します。" : "Files are read-only. The conversation is saved to chat history when you finish."}</p>
      <p role="status" className="mb-3 text-sm">{state === "connecting" ? (ja ? "接続中…" : "Connecting…") : state === "connected" ? (ja ? "会話中" : "Connected") : (ja ? "停止中" : "Stopped")}</p>
      {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
      {toolStatus && <p role="status" className="mb-3 text-sm text-blue-600">{toolStatus === "RAG" ? (ja ? "RAGを検索中…" : "Searching RAG…") : toolStatus === "search" ? (ja ? "ファイルを検索中…" : "Searching files…") : (ja ? "ファイルを参照中…" : "Reading file…")}</p>}
      <audio ref={audioRef} autoPlay playsInline hidden />
      </div>
      <div className="flex shrink-0 flex-wrap gap-3 pt-2 pb-[env(safe-area-inset-bottom)]">
        {state === "idle" && transcriptRef.current.length > 0 ? <button type="button" onClick={close} className="min-h-11 rounded bg-blue-600 px-4 py-2 text-white">{ja ? "チャットへ戻る" : "Return to chat"}</button> : state === "idle" ? <button type="button" onClick={() => {
          setError(""); setMuted(false);
          const context = includeContext ? messages.slice(-20).map((item) => `${item.role}: ${item.content}`).join("\n").slice(-40_000) : "";
          const setting = ragSettings?.[ragName];
          const rag = setting?.storeId ? { name: ragName, setting, topK: resolveRagTopK(setting) } : undefined;
          toolRunnerRef.current = fileAccess ? createLiveFileToolRunner(() => fileContextRef.current, rag) : null;
          const current = fileContextRef.current.currentFile;
          void sessionRef.current?.start({ model, voice, fileAccess, ragEnabled: fileAccess && !!rag, language: ja ? "ja" : "en", instructions: [systemPrompt, ja ? "自然な日本語で会話してください。" : "Converse naturally in English.", fileAccess ? LIVE_FILE_INSTRUCTIONS : "", fileAccess && current ? `Current editor file: ${current.name} (fileId: ${current.id})` : "", context ? `Prior text conversation for context:\n${context}` : ""].filter(Boolean).join("\n\n") });
        }} className="min-h-11 rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{ja ? "会話を開始" : "Start conversation"}</button> : <>
          <button type="button" onClick={() => { sessionRef.current?.mute(!muted); setMuted(!muted); }} disabled={state !== "connected"} className="flex min-h-11 items-center gap-2 rounded border px-3 py-2 disabled:opacity-50" aria-pressed={muted}>{muted ? <MicOff size={18} /> : <Mic size={18} />}{muted ? (ja ? "ミュート解除" : "Unmute") : (ja ? "ミュート" : "Mute")}</button>
          <button type="button" onClick={close} className="flex min-h-11 items-center gap-2 rounded bg-red-600 px-3 py-2 text-white"><PhoneOff size={18} />{ja ? "会話を終了" : "End conversation"}</button>
        </>}
      </div>
    </div>
  </div>;
  return typeof document === "undefined" ? null : createPortal(dialog, document.body);
}
