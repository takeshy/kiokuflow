import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import { useI18n } from "~/i18n/context";
import { COMPATIBLE_PROVIDERS, type CompatibleProvider, type OpenAIModelEntry, type UserSettings } from "~/types/settings";
import { createProviderSettingsDrafts, type ProviderDraftProps } from "~/services/provider-settings-drafts";
import { invalidateIndexCache } from "~/utils/index-cache";
import { inputClass } from "./shared";

export function CompatibleProviderSettings({ provider, settings, onOpenGeneral, draft, onChange, onBusyChange }: { provider: CompatibleProvider; settings: UserSettings; onOpenGeneral?: () => void } & ProviderDraftProps) {
  const ja = useI18n().language === "ja";
  const definition = COMPATIBLE_PROVIDERS[provider];
  const config = settings.compatibleProviders?.[provider];
  const stored = !!config?.encryptedApiKey;
  const revalidator = useRevalidator();
  const [unlocked, setUnlocked] = useState(false);
  const { apiKey, models, enabledModels, verified } = draft;
  const encryptionReady = !!settings.encryption.publicKey;
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const endpoint = `/api/ai-providers/${provider}/settings`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal, cache: "no-store" }).then(response => response.ok ? response.json() : null).then(data => { if (data) setUnlocked(data.unlocked); }).catch(() => {});
    return () => controller.abort();
  }, [endpoint]);
  const submit = async (action: "verify" | "remove") => {
    setBusy(true); onBusyChange(true); setNotice("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, apiKey }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (action === "verify") {
        const available = new Set((data.models as OpenAIModelEntry[]).map(model => model.id));
        onChange({ ...draft, models: data.models, enabledModels: enabledModels.filter(id => available.has(id)), verified: true, dirty: true });
        setNotice(ja ? `${data.models.length}モデルを取得しました。画面末尾のSaveで保存します。` : `Found ${data.models.length} models. Save changes with the Save button at the bottom.`);
      } else {
        setUnlocked(false); onChange(createProviderSettingsDrafts({ ...settings, compatibleProviders: { ...settings.compatibleProviders, [provider]: undefined } })[provider]);
        setNotice(ja ? "削除しました。" : "Removed."); invalidateIndexCache(); revalidator.revalidate();
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <div className="mb-6 space-y-3" role="group" aria-label={definition.name} onKeyDown={event => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); }
  }}>
    <>
      <p className="text-sm text-gray-500">{ja ? `${definition.name}のAPIキーを保存し、チャット・ワークフローで使用するモデルを選択します。利用料・上限は各サービスの契約に従います。` : `Save your ${definition.name} API key and choose models for chat and workflows. Your provider's billing and limits apply.`}</p>
      {provider === "opencodego" && <p className="text-xs text-gray-500">{ja ? "OpenCode Goはコーディングエージェント向けです。使用可能モデルやプライバシー設定はOpenCode側で管理します。" : "OpenCode Go is intended for coding agents. Available models and privacy settings are managed in OpenCode."}</p>}
      <p className="text-sm" role="status">{stored ? unlocked ? (ja ? "APIキー：ロック解除済み" : "API key: unlocked") : (ja ? "APIキー：保存済み・ロック中" : "API key: saved, locked") : (ja ? "APIキーは未設定です。" : "No API key saved.")}</p>
      <label className="block text-sm">{definition.name} API key<input type="password" autoComplete="off" value={apiKey} disabled={busy || !encryptionReady} onChange={event => { onChange({ ...draft, apiKey: event.target.value, verified: false, models: [], dirty: true }); setNotice(""); }} placeholder={stored ? (ja ? "空欄で現在のキーを保持" : "Leave blank to keep current key") : "sk-…"} className={inputClass} /></label>
    </>
    {!encryptionReady && <p className="text-xs text-gray-500">{ja ? "一般設定で暗号化用の鍵を作成してください。作成後はパスワードなしでAPIキーを保存できます。" : "Create encryption keys in General first. Saving an API key then needs no password."}</p>}
    {onOpenGeneral && <button type="button" disabled={busy} onClick={onOpenGeneral} className="text-sm text-blue-600 hover:underline">{ja ? "一般設定で暗号化・ロック解除を管理" : "Manage encryption and unlocking in General"}</button>}
    <>
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" disabled={busy} onClick={() => void submit("verify")} className="rounded border px-3 py-2 disabled:opacity-50">{ja ? "接続確認・モデル一覧を取得" : "Verify and fetch models"}</button>
        <a href={definition.keyUrl} target="_blank" rel="noreferrer" className="self-center text-blue-600 underline">{ja ? "APIキーを取得" : "Get an API key"}</a>
      </div>
    {!verified && <p className="text-xs text-gray-500">{ja ? "入力したAPIキーとモデル選択は、画面末尾のSaveでまとめて保存します。チャットモデルが未選択でもキーを保存できます。" : "The Save button at the bottom saves your key and model selections together. Chat models are optional."}</p>}
      {!!models.length && <fieldset className="space-y-2 rounded border border-gray-200 p-3 dark:border-gray-700">
        <legend className="px-1 text-sm">{ja ? "使用するモデル" : "Enabled models"}</legend>
        <input type="search" aria-label={ja ? "モデルを検索" : "Filter models"} placeholder={ja ? "モデルを検索" : "Filter models"} className={inputClass} value={filter} onChange={event => setFilter(event.target.value)} />
        <div className="max-h-64 space-y-2 overflow-y-auto">{models.filter(model => `${model.id} ${model.name}`.toLowerCase().includes(filter.toLowerCase())).map(model => <label key={model.id} className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={enabledModels.includes(model.id)} disabled={busy} onChange={event => onChange({ ...draft, enabledModels: event.target.checked ? [...enabledModels, model.id] : enabledModels.filter(id => id !== model.id), dirty: true })} />
          <span className="min-w-0 break-words">{model.name}<span className="ml-2 text-xs text-gray-500">{model.id}</span></span>
        </label>)}</div>
      </fieldset>}
    </>
    <div className="flex flex-wrap gap-3 text-sm">
      {stored && <button type="button" disabled={busy} onClick={() => void submit("remove")} className="rounded border px-4 py-2 text-red-600 disabled:opacity-50">{ja ? "キーを削除" : "Remove key"}</button>}
    </div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </div>;
}
