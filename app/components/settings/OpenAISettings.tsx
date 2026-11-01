import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import { useI18n } from "~/i18n/context";
import type { UserSettings } from "~/types/settings";
import { inputClass } from "./shared";
import { invalidateIndexCache } from "~/utils/index-cache";
import { useProviderPasswords } from "./ProviderPasswords";

export function OpenAISettings({ settings, onOpenGeneral }: { settings: UserSettings; onOpenGeneral?: () => void }) {
  const ja = useI18n().language === "ja";
  const revalidator = useRevalidator();
  const { password } = useProviderPasswords();
  const stored = !!settings.openai?.encryptedApiKey;
  const [unlocked, setUnlocked] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/openai/settings", { cache: "no-store", signal: controller.signal }).then(response => response.ok ? response.json() : null).then(data => { if (data) setUnlocked(data.unlocked); }).catch(() => {});
    return () => controller.abort();
  }, []);
  const submit = async (action: "save" | "remove") => {
    if (!password) { setNotice(ja ? "一般設定で共通パスワードを設定・確認してください。" : "Set or verify the common password in General settings."); return; }
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/openai/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, apiKey, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setUnlocked(data.unlocked); setApiKey("");
      setNotice(ja ? "保存しました。" : "Saved."); invalidateIndexCache(); revalidator.revalidate();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div className="mb-6 space-y-3" role="group" aria-label="OpenAI" onKeyDown={event => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); if (!busy && password) void submit("save"); }
  }}>
    <p className="text-sm text-gray-500">{ja ? "APIキーを保存すると、チャットでOpenAIモデルとLive音声会話を利用できます。OpenAIのAPI利用料がかかります。" : "Save your API key to use OpenAI chat models and Live voice conversations. OpenAI API usage is billed to your account."}</p>
    <p className="text-sm" role="status">{stored ? unlocked ? (ja ? "接続キー：ロック解除済み" : "API key: unlocked") : (ja ? "接続キー：保存済み・ロック中" : "API key: saved, locked") : (ja ? "APIキーは未設定です。" : "No API key saved.")}</p>
    {!password && <p className="text-xs text-gray-500">{ja ? "APIキーの保存・変更には、一般設定でパスワードを設定・確認してください。" : "Set or verify the password in General before saving or changing the API key."}</p>}
    {onOpenGeneral && <button type="button" onClick={onOpenGeneral} className="text-sm text-blue-600 hover:underline">{ja ? "一般設定でパスワードを管理" : "Manage password in General"}</button>}
    <label className="block text-sm">OpenAI API key<input type="password" autoComplete="off" value={apiKey} disabled={!password} onChange={event => setApiKey(event.target.value)} className={inputClass} placeholder={stored ? (ja ? "空欄で現在のキーを保持" : "Leave blank to keep current key") : "sk-…"} /></label>
    <div className="flex flex-wrap gap-3 text-sm">
      <button type="button" onClick={() => void submit("save")} disabled={busy || !password} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{ja ? "APIキーを保存" : "Save API key"}</button>
      {stored && <button type="button" disabled={busy || !password} onClick={() => void submit("remove")} className="rounded border px-4 py-2 text-red-600 disabled:opacity-50">{ja ? "キーを削除" : "Remove key"}</button>}
      <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="self-center text-blue-600 underline">{ja ? "APIキーを取得" : "Get an API key"}</a>
    </div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </div>;
}
