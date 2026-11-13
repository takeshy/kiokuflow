import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "~/i18n/context";
import { ragConnectionLabel, type RagConnectionStatus, type RagEmbeddingModel } from "~/services/rag-connections";
import { EMBEDDING_MODELS, type EmbeddingProvider } from "~/services/rag-config";
import { useRagRequestScope } from "~/hooks/useRagRequestScope";

export function EmbeddingModelSelect({ provider, value, onChange, connection, onRefresh, error }: {
  provider: EmbeddingProvider; value: string; onChange: (model: string) => void;
  connection?: RagConnectionStatus; onRefresh: () => void; error?: string;
}) {
  const ja = useI18n().language === "ja";
  const id = useId();
  const scope = useRagRequestScope(JSON.stringify([provider, connection?.id]));
  const latest = useRef(scope); latest.current = scope;
  const controller = useRef<AbortController | null>(null);
  const [catalogue, setCatalogue] = useState<{ scope: string; models?: RagEmbeddingModel[]; busy?: boolean; error?: string }>();
  const current = catalogue?.scope === scope ? catalogue : undefined;
  const load = async () => {
    if (connection?.state !== "ready") return;
    controller.current?.abort();
    const pending = new AbortController(); controller.current = pending;
    setCatalogue({ scope, busy: true });
    try {
      const response = await fetch("/api/rag/providers", { method: "POST", headers: { "Content-Type": "application/json" }, signal: pending.signal,
        body: JSON.stringify({ action: "embedding-models", provider, connectionId: connection.id }) });
      const data = await response.json() as { error?: string; models: RagEmbeddingModel[]; connectionId?: string };
      if (!response.ok) { if (response.status === 409 || response.status === 401) onRefresh(); throw new Error(data.error || `HTTP ${response.status}`); }
      if (data.connectionId !== connection.id || !Array.isArray(data.models)) throw new Error(ja ? "接続が変更されました。一覧を更新してください。" : "Connection changed. Refresh the list.");
      if (latest.current === scope && !pending.signal.aborted) setCatalogue({ scope, models: data.models });
    } catch (error) {
      if (latest.current === scope && !pending.signal.aborted) setCatalogue({ scope, error: error instanceof Error ? error.message : String(error) });
    }
  };
  useEffect(() => () => controller.current?.abort(), [scope]);
  const models = current?.models ?? EMBEDDING_MODELS[provider].map(id => ({ id, supported: true }));
  return <div className="space-y-1">
    <label htmlFor={id} className="block text-sm font-medium">{ja ? "Embedding モデル" : "Embedding model"}</label>
    <div className="flex flex-wrap items-center gap-2">
      <select id={id} value={value} disabled={current?.busy} onChange={event => onChange(event.target.value)} className="min-w-0 max-w-full rounded border border-gray-300 bg-white p-2 text-sm dark:border-gray-700 dark:bg-gray-900">
        {!models.some(model => model.id === value) && <option value={value}>{value} ({ja ? "保存済み" : "saved"})</option>}
        {models.map(model => <option key={model.id} value={model.id} disabled={!model.supported}>{model.id}{!model.supported ? (ja ? "（未対応）" : " (unsupported)") : ""}</option>)}
      </select>
      <button type="button" disabled={current?.busy || connection?.state !== "ready"} onClick={() => void load()} className="rounded border px-2 py-1 text-xs disabled:opacity-50">{current?.busy ? (ja ? "取得中…" : "Loading…") : (ja ? "モデル一覧を取得・更新" : "Fetch / refresh models")}</button>
    </div>
    <p className="text-xs text-gray-500">{ja ? "チャットモデルの選択とは独立しています。未対応モデルは選択できません。" : "Independent of enabled chat models. Unsupported models cannot be selected."}</p>
    {connection && <p className="text-xs text-gray-500">{ragConnectionLabel(connection, ja)}</p>}
    {(current?.error || error || current?.models?.length === 0) && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{current?.error || (error ? (ja ? "接続状態を取得できません。" : "Could not load connection status.") : (ja ? "Embeddingモデルが見つかりませんでした。" : "No embedding models were listed."))}</p>}
    {connection && connection.state !== "ready" && <a href={connection.settingsHref} className="text-xs text-blue-600 underline">{connection.state === "locked" ? (ja ? "一般設定でロック解除" : "Unlock in General settings") : (ja ? "AIプロバイダーを設定" : "Configure AI provider")}</a>}
    <button type="button" onClick={onRefresh} className="ml-2 text-xs text-blue-600 underline">{ja ? "接続状態を更新" : "Refresh connection status"}</button>
  </div>;
}
