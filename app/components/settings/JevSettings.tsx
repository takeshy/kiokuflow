import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import { useI18n } from "~/i18n/context";
import type { UserSettings } from "~/types/settings";
import { useProviderPasswords } from "./ProviderPasswords";
import { inputClass } from "./shared";
import { invalidateIndexCache } from "~/utils/index-cache";

export function JevSettings({ settings, onOpenGeneral }: { settings: UserSettings; onOpenGeneral?: () => void }) {
  const ja = useI18n().language === "ja";
  const revalidator = useRevalidator();
  const { password } = useProviderPasswords();
  const [apiKey, setApiKey] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const router = settings.jev?.useOpenRouter === true;
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/jev/settings", { cache: "no-store", signal: controller.signal }).then(response => response.ok ? response.json() : null).then(data => { if (data) setUnlocked(data.unlocked); }).catch(() => {});
    return () => controller.abort();
  }, []);
  const submit = async (action: "save" | "remove" | "verify" | "setMode", useOpenRouter?: boolean) => {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/jev/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, apiKey, password: password, useOpenRouter }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (action !== "verify") { setApiKey(""); invalidateIndexCache(); revalidator.revalidate(); }
      setUnlocked(data.unlocked); setNotice(ja ? action === "verify" ? "接続を確認しました。" : "保存しました。" : action === "verify" ? "Connection verified." : "Saved.");
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div className="mb-6 space-y-3" role="group" aria-label="Jev" onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
    <p className="text-sm text-gray-500">{ja ? "JevはRAGの候補が質問に実質的に一致するかを判定します。チャット用のAIプロバイダーではありません。JevまたはOpenRouterのAPI利用料がかかります。" : "Jev checks whether RAG candidates materially match the query. It is a decision service, not a chat provider. Jev or OpenRouter API usage charges apply."}</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={router} disabled={busy || (!router && !settings.compatibleProviders?.openrouter?.encryptedApiKey)} onChange={event => void submit("setMode", event.target.checked)} />{ja ? "登録済みのOpenRouterキーを使う" : "Use the configured OpenRouter key"}</label>
    {router ? <p className="text-xs text-gray-500">{ja ? "OpenRouterのロック解除は一般設定で行います。" : "Unlock the OpenRouter key in General settings."}</p> : <>
      <p className="text-xs text-gray-500">{settings.jev?.encryptedApiKey ? unlocked ? (ja ? "Jevキー：ロック解除済み" : "Jev key: unlocked") : (ja ? "Jevキー：保存済み・ロック中" : "Jev key: saved, locked") : (ja ? "Jevキーは未設定です。" : "No Jev key saved.")}</p>
      {onOpenGeneral && <button type="button" onClick={onOpenGeneral} className="text-sm text-blue-600 hover:underline">{ja ? "一般設定で共通パスワードを管理" : "Manage the common password in General"}</button>}
      <label className="block text-sm">Jev API key<input type="password" autoComplete="off" value={apiKey} disabled={!password} onChange={event => setApiKey(event.target.value)} className={inputClass} placeholder={settings.jev?.encryptedApiKey ? (ja ? "空欄で現在のキーを保持" : "Leave blank to keep current key") : (ja ? "TypeSafe公式APIキー" : "Official TypeSafe API key")} /></label>
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" disabled={busy || !password} onClick={() => void submit("save")} className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-50">{ja ? "APIキーを保存" : "Save API key"}</button>
        {settings.jev?.encryptedApiKey && <button type="button" disabled={busy || !password} onClick={() => void submit("remove")} className="rounded border px-3 py-2 text-red-600 disabled:opacity-50">{ja ? "キーを削除" : "Remove key"}</button>}
        <a href="https://console.typesafe.ai/" target="_blank" rel="noreferrer" className="self-center text-blue-600 underline">{ja ? "TypeSafe公式コンソールでAPIキーを作成" : "Create an API key in the TypeSafe console"}</a>
        <a href="https://docs.typesafe.ai/api/system-one" target="_blank" rel="noreferrer" className="self-center text-blue-600 underline">{ja ? "公式APIドキュメント" : "Official API documentation"}</a>
      </div>
    </>}
    <button type="button" disabled={busy} onClick={() => void submit("verify")} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{ja ? "接続確認" : "Verify connection"}</button>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </div>;
}
