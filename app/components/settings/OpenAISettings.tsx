import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import { useI18n } from "~/i18n/context";
import { getConfiguredOpenAIModels, type OpenAIModelEntry, type UserSettings } from "~/types/settings";
import { inputClass } from "./shared";
import { invalidateIndexCache } from "~/utils/index-cache";

export function OpenAISettings({ settings, onOpenGeneral }: { settings: UserSettings; onOpenGeneral?: () => void }) {
  const ja = useI18n().language === "ja";
  const revalidator = useRevalidator();
  const encryptionReady = !!settings.encryption.publicKey;
  const stored = !!settings.openai?.encryptedApiKey;
  const [unlocked, setUnlocked] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<OpenAIModelEntry[]>(settings.openai?.availableModels || (stored ? getConfiguredOpenAIModels(settings.openai).map(model => ({ id: model.name, name: model.name })) : []));
  const [enabledModels, setEnabledModels] = useState<string[]>(stored ? getConfiguredOpenAIModels(settings.openai).map(model => model.name) : []);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/openai/settings", { cache: "no-store", signal: controller.signal }).then(response => response.ok ? response.json() : null).then(data => { if (data) setUnlocked(data.unlocked); }).catch(() => {});
    return () => controller.abort();
  }, []);
  const submit = async (action: "verify" | "save" | "remove") => {

    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/openai/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: action === "save" && stored && !apiKey ? "saveModels" : action, apiKey, ...(action === "save" ? { enabledModels } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (action === "verify") {
        setModels(data.models);
        const available = new Set((data.models as OpenAIModelEntry[]).map(model => model.id));
        setEnabledModels(previous => previous.filter(id => available.has(id)));
        setNotice(ja ? `${data.models.length}モデルを取得しました。使うモデルを複数選択して保存してください。` : `Found ${data.models.length} chat models. Select the models you want and save.`);
      } else {
        setUnlocked(data.unlocked); setApiKey("");
        setNotice(ja ? "保存しました。" : "Saved."); invalidateIndexCache(); revalidator.revalidate();
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div className="mb-6 space-y-3" role="group" aria-label="OpenAI" onKeyDown={event => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); }
  }}>
    <p className="text-sm text-gray-500">{ja ? "OpenAIのモデル一覧を取得し、チャット・ワークフローで使うモデルを選択します。Live音声会話も利用できます。OpenAIのAPI利用料がかかります。" : "Fetch your OpenAI models and choose which to use in chat and workflows. Live voice conversations are also available. OpenAI API usage is billed to your account."}</p>
    <p className="text-sm" role="status">{stored ? unlocked ? (ja ? "接続キー：ロック解除済み" : "API key: unlocked") : (ja ? "接続キー：保存済み・ロック中" : "API key: saved, locked") : (ja ? "APIキーは未設定です。" : "No API key saved.")}</p>
    {!encryptionReady && <p className="text-xs text-gray-500">{ja ? "一般設定で暗号化用の鍵を作成してください。作成後はパスワードなしでAPIキーを保存できます。" : "Create encryption keys in General first. Saving an API key then needs no password."}</p>}
    {onOpenGeneral && <button type="button" onClick={onOpenGeneral} className="text-sm text-blue-600 hover:underline">{ja ? "一般設定で暗号化・ロック解除を管理" : "Manage encryption and unlocking in General"}</button>}
    <label className="block text-sm">OpenAI API key<input type="password" autoComplete="off" value={apiKey} disabled={!encryptionReady} onChange={event => setApiKey(event.target.value)} className={inputClass} placeholder={stored ? (ja ? "空欄で現在のキーを保持" : "Leave blank to keep current key") : "sk-…"} /></label>
    <div className="flex flex-wrap gap-3 text-sm">
      <button type="button" disabled={busy} onClick={() => void submit("verify")} className="rounded border px-3 py-2 disabled:opacity-50">{ja ? "モデル情報を取得" : "Fetch model information"}</button>
      <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="self-center text-blue-600 underline">{ja ? "APIキーを取得" : "Get an API key"}</a>
    </div>
    {!!models.length && <fieldset className="space-y-2 rounded border border-gray-200 p-3 dark:border-gray-700">
      <legend className="px-1 text-sm">{ja ? "使用するモデル（複数選択可）" : "Enabled models (multiple selection)"}</legend>
      <input type="search" aria-label={ja ? "モデルを検索" : "Filter models"} placeholder={ja ? "モデルを検索" : "Filter models"} value={filter} onChange={event => setFilter(event.target.value)} className={inputClass} />
      <div className="max-h-64 space-y-2 overflow-y-auto">{models.filter(model => `${model.id} ${model.name}`.toLowerCase().includes(filter.toLowerCase())).map(model => <label key={model.id} className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={enabledModels.includes(model.id)} onChange={event => setEnabledModels(previous => event.target.checked ? [...previous, model.id] : previous.filter(id => id !== model.id))} />
        <span className="min-w-0 break-words">{model.name}<span className="block text-xs text-gray-500">{[model.ownedBy, model.created ? new Date(model.created * 1000).toISOString().slice(0, 10) : ""].filter(Boolean).join(" · ")}</span></span>
      </label>)}</div>
    </fieldset>}
    <div className="flex flex-wrap gap-3 text-sm">
      <button type="button" onClick={() => void submit("save")} disabled={busy || (!stored && !encryptionReady) || !enabledModels.length} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{ja ? "APIキーとモデルを保存" : "Save API key and models"}</button>
      {stored && <button type="button" disabled={busy} onClick={() => void submit("remove")} className="rounded border px-4 py-2 text-red-600 disabled:opacity-50">{ja ? "キーを削除" : "Remove key"}</button>}
    </div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </div>;
}
