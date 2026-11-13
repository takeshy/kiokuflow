import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import { useI18n } from "~/i18n/context";
import type { UserSettings } from "~/types/settings";
import { inputClass } from "./shared";
import { invalidateIndexCache } from "~/utils/index-cache";
import { createProviderSettingsDrafts, type ProviderDraftProps } from "~/services/provider-settings-drafts";

export function JevSettings({ settings, onOpenGeneral, draft, onChange, onBusyChange, openRouterApiKey }: { settings: UserSettings; onOpenGeneral?: () => void; openRouterApiKey?: string } & ProviderDraftProps) {
  const ja = useI18n().language === "ja";
  const revalidator = useRevalidator();
  const encryptionReady = !!settings.encryption.publicKey;
  const apiKey = draft.apiKey;
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const router = draft.useOpenRouter;
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/jev/settings", { cache: "no-store", signal: controller.signal }).then(response => response.ok ? response.json() : null).then(data => { if (data) setUnlocked(data.unlocked); }).catch(() => {});
    return () => controller.abort();
  }, []);
  const submit = async (action: "verify" | "remove") => {
    setBusy(true); onBusyChange(true); setNotice("");
    try {
      const response = await fetch("/api/jev/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, apiKey, useOpenRouter: router, ...(action === "verify" && router ? { openRouterApiKey } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (action === "remove") {
        onChange(createProviderSettingsDrafts({ ...settings, jev: { useOpenRouter: settings.jev?.useOpenRouter === true } }).jev);
        setUnlocked(false); invalidateIndexCache(); revalidator.revalidate();
      }
      setNotice(ja ? action === "verify" ? "接続を確認しました。保存は画面末尾のSaveで行います。" : "削除しました。" : action === "verify" ? "Connection verified. Use Save at the bottom to apply changes." : "Removed.");
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <div className="mb-6 space-y-3" role="group" aria-label="Jev" onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
    <p className="text-sm text-gray-500">{ja ? "JevはRAGの候補が質問に実質的に一致するかを判定します。チャット用のAIプロバイダーではありません。JevまたはOpenRouterのAPI利用料がかかります。" : "Jev checks whether RAG candidates materially match the query. It is a decision service, not a chat provider. Jev or OpenRouter API usage charges apply."}</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={router} disabled={busy || (!router && !settings.compatibleProviders?.openrouter?.encryptedApiKey && !openRouterApiKey?.trim())} onChange={event => { onChange({ ...draft, useOpenRouter: event.target.checked, dirty: true }); setNotice(""); }} />{ja ? "登録済みのOpenRouterキーを使う" : "Use the configured OpenRouter key"}</label>
    <p className="text-xs text-gray-500">{ja ? "接続方式とAPIキーは、画面末尾のSaveでまとめて保存します。保存時にも接続を確認します。" : "Use Save at the bottom to apply the connection mode and key together. Saving also verifies the connection."}</p>
    {router ? <p className="text-xs text-gray-500">{ja ? "OpenRouterのロック解除は一般設定で行います。" : "Unlock the OpenRouter key in General settings."}</p> : <>
      <p className="text-xs text-gray-500">{settings.jev?.encryptedApiKey ? unlocked ? (ja ? "Jevキー：ロック解除済み" : "Jev key: unlocked") : (ja ? "Jevキー：保存済み・ロック中" : "Jev key: saved, locked") : (ja ? "Jevキーは未設定です。" : "No Jev key saved.")}</p>
      {onOpenGeneral && <button type="button" disabled={busy} onClick={onOpenGeneral} className="text-sm text-blue-600 hover:underline">{ja ? "一般設定で暗号化・ロック解除を管理" : "Manage encryption and unlocking in General"}</button>}
      <label className="block text-sm">Jev API key<input type="password" autoComplete="off" value={apiKey} disabled={busy || !encryptionReady} onChange={event => { onChange({ ...draft, apiKey: event.target.value, dirty: true }); setNotice(""); }} className={inputClass} placeholder={settings.jev?.encryptedApiKey ? (ja ? "空欄で現在のキーを保持" : "Leave blank to keep current key") : (ja ? "TypeSafe公式APIキー" : "Official TypeSafe API key")} /></label>
      <div className="flex flex-wrap gap-3 text-sm">

        {settings.jev?.encryptedApiKey && <button type="button" disabled={busy} onClick={() => void submit("remove")} className="rounded border px-3 py-2 text-red-600 disabled:opacity-50">{ja ? "キーを削除" : "Remove key"}</button>}
        <a href="https://console.typesafe.ai/" target="_blank" rel="noreferrer" className="self-center text-blue-600 underline">{ja ? "TypeSafe公式コンソールでAPIキーを作成" : "Create an API key in the TypeSafe console"}</a>
        <a href="https://docs.typesafe.ai/api/system-one" target="_blank" rel="noreferrer" className="self-center text-blue-600 underline">{ja ? "公式APIドキュメント" : "Official API documentation"}</a>
      </div>
    </>}
    <button type="button" disabled={busy || (!router && !encryptionReady)} onClick={() => void submit("verify")} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{ja ? "接続確認" : "Verify connection"}</button>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </div>;
}
