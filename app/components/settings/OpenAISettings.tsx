import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import { useI18n } from "~/i18n/context";
import { type OpenAIModelEntry, type UserSettings } from "~/types/settings";
import { inputClass } from "./shared";
import { createProviderSettingsDrafts, type ProviderDraftProps } from "~/services/provider-settings-drafts";
import { invalidateIndexCache } from "~/utils/index-cache";

export function OpenAISettings({ settings, onOpenGeneral, draft, onChange, onBusyChange }: { settings: UserSettings; onOpenGeneral?: () => void } & ProviderDraftProps) {
  const ja = useI18n().language === "ja";
  const revalidator = useRevalidator();
  const encryptionReady = !!settings.encryption.publicKey;
  const stored = !!settings.openai?.encryptedApiKey;
  const [unlocked, setUnlocked] = useState(false);
  const { apiKey, models, enabledModels, verified } = draft;
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/openai/settings", { cache: "no-store", signal: controller.signal }).then(response => response.ok ? response.json() : null).then(data => { if (data) setUnlocked(data.unlocked); }).catch(() => {});
    return () => controller.abort();
  }, []);
  const submit = async (action: "verify" | "remove") => {
    setBusy(true); onBusyChange(true); setNotice("");
    try {
      const response = await fetch("/api/openai/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, apiKey }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (action === "verify") {
        const available = new Set((data.models as OpenAIModelEntry[]).map(model => model.id));
        onChange({ ...draft, models: data.models, enabledModels: enabledModels.filter(id => available.has(id)), verified: true, dirty: true });
        setNotice(ja ? `${data.models.length}モデルを取得しました。画面末尾のSaveで保存します。` : `Found ${data.models.length} models. Save changes with the Save button at the bottom.`);
      } else {
        setUnlocked(false); onChange(createProviderSettingsDrafts({ ...settings, openai: undefined }).openai);
        setNotice(ja ? "削除しました。" : "Removed."); invalidateIndexCache(); revalidator.revalidate();
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <div className="mb-6 space-y-3" role="group" aria-label="OpenAI" onKeyDown={event => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); }
  }}>
    <p className="text-sm text-gray-500">{ja ? "OpenAIのモデル一覧を取得し、チャット・ワークフローで使うモデルを選択します。Live音声会話も利用できます。OpenAIのAPI利用料がかかります。" : "Fetch your OpenAI models and choose which to use in chat and workflows. Live voice conversations are also available. OpenAI API usage is billed to your account."}</p>
    <p className="text-sm" role="status">{stored ? unlocked ? (ja ? "接続キー：ロック解除済み" : "API key: unlocked") : (ja ? "接続キー：保存済み・ロック中" : "API key: saved, locked") : (ja ? "APIキーは未設定です。" : "No API key saved.")}</p>
    {!encryptionReady && <p className="text-xs text-gray-500">{ja ? "一般設定で暗号化用の鍵を作成してください。作成後はパスワードなしでAPIキーを保存できます。" : "Create encryption keys in General first. Saving an API key then needs no password."}</p>}
    {onOpenGeneral && <button type="button" disabled={busy} onClick={onOpenGeneral} className="text-sm text-blue-600 hover:underline">{ja ? "一般設定で暗号化・ロック解除を管理" : "Manage encryption and unlocking in General"}</button>}
    <label className="block text-sm">OpenAI API key<input type="password" autoComplete="off" value={apiKey} disabled={busy || !encryptionReady} onChange={event => { onChange({ ...draft, apiKey: event.target.value, verified: false, models: [], dirty: true }); setNotice(""); }} className={inputClass} placeholder={stored ? (ja ? "空欄で現在のキーを保持" : "Leave blank to keep current key") : "sk-…"} /></label>
    <div className="flex flex-wrap gap-3 text-sm">
      <button type="button" disabled={busy} onClick={() => void submit("verify")} className="rounded border px-3 py-2 disabled:opacity-50">{ja ? "モデル情報を取得" : "Fetch model information"}</button>
      <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="self-center text-blue-600 underline">{ja ? "APIキーを取得" : "Get an API key"}</a>
    </div>
    {!verified && <p className="text-xs text-gray-500">{ja ? "入力したAPIキーとモデル選択は、画面末尾のSaveでまとめて保存します。チャットモデルが未選択でもキーを保存できます。" : "The Save button at the bottom saves your key and model selections together. Chat models are optional."}</p>}
    {!!models.length && <fieldset className="space-y-2 rounded border border-gray-200 p-3 dark:border-gray-700">
      <legend className="px-1 text-sm">{ja ? "使用するモデル（複数選択可）" : "Enabled models (multiple selection)"}</legend>
      <input type="search" aria-label={ja ? "モデルを検索" : "Filter models"} placeholder={ja ? "モデルを検索" : "Filter models"} value={filter} onChange={event => setFilter(event.target.value)} className={inputClass} />
      <div className="max-h-64 space-y-2 overflow-y-auto">{models.filter(model => `${model.id} ${model.name}`.toLowerCase().includes(filter.toLowerCase())).map(model => <label key={model.id} className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={enabledModels.includes(model.id)} disabled={busy} onChange={event => onChange({ ...draft, enabledModels: event.target.checked ? [...enabledModels, model.id] : enabledModels.filter(id => id !== model.id), dirty: true })} />
        <span className="min-w-0 break-words">{model.name}<span className="block text-xs text-gray-500">{[model.ownedBy, model.created ? new Date(model.created * 1000).toISOString().slice(0, 10) : ""].filter(Boolean).join(" · ")}</span></span>
      </label>)}</div>
    </fieldset>}
    <div className="flex flex-wrap gap-3 text-sm">
      {stored && <button type="button" disabled={busy} onClick={() => void submit("remove")} className="rounded border px-4 py-2 text-red-600 disabled:opacity-50">{ja ? "キーを削除" : "Remove key"}</button>}
    </div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </div>;
}
