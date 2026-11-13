import { useEffect, useRef, useState } from "react";
import { useI18n } from "~/i18n/context";
import { ragConnectionLabel, type RagConnections } from "~/services/rag-connections";
import type { RagSetting } from "~/types/settings";
import { useRagRequestScope } from "~/hooks/useRagRequestScope";

export function RerankingSelect({ value = "off", onChange, connections, error, onRefresh, projectId }: {
  value?: RagSetting["rerankProvider"];
  onChange: (provider: "off" | "gemini" | "jev") => void;
  connections?: RagConnections;
  error?: string;
  onRefresh: () => void;
  projectId?: string;
}) {
  const ja = useI18n().language === "ja";
  const connection = value === "off" ? undefined : connections?.reranking[value];
  const scope = useRagRequestScope(JSON.stringify([projectId, value, connection?.id]));
  const latest = useRef(scope);
  latest.current = scope;
  const controller = useRef<AbortController | null>(null);
  const [verification, setVerification] = useState<{ scope: string; busy: boolean; ok?: boolean; message?: string }>();
  const current = verification?.scope === scope ? verification : undefined;
  useEffect(() => () => controller.current?.abort(), [scope]);
  const verify = async () => {
    if (!connection || value === "off") return;
    controller.current?.abort();
    const pending = new AbortController(); controller.current = pending;
    setVerification({ scope, busy: true });
    try {
      const response = await fetch("/api/rag/providers", { method: "POST", headers: { "Content-Type": "application/json" }, signal: pending.signal,
        body: JSON.stringify({ action: "verify", provider: value, connectionId: connection.id, projectId }) });
      const data = await response.json() as { error?: string; connectionId?: string };
      if (!response.ok) { if (response.status === 409 || response.status === 401) onRefresh(); throw new Error(data.error || `HTTP ${response.status}`); }
      if (data.connectionId !== connection.id) throw new Error(ja ? "接続が変更されました。もう一度確認してください。" : "Connection changed. Verify again.");
      if (latest.current === scope && !pending.signal.aborted) setVerification({ scope, busy: false, ok: true, message: ja ? "接続を確認しました。" : "Connection verified." });
    } catch (error) {
      if (latest.current === scope && !pending.signal.aborted) setVerification({ scope, busy: false, message: error instanceof Error ? error.message : String(error) });
    }
  };
  return <div className="space-y-1">
    <label className="flex flex-wrap items-center gap-2 text-sm">
      {ja ? "リランキング" : "Reranking"}
      <select value={value} disabled={current?.busy} onChange={event => { setVerification(undefined); onChange(event.target.value as "off" | "gemini" | "jev"); }} className="max-w-full rounded border border-gray-300 bg-white p-1 dark:border-gray-700 dark:bg-gray-900">
        <option value="off">OFF</option><option value="gemini">Gemini Decisions API</option><option value="jev">Jev</option>
      </select>
    </label>
    {value !== "off" && <div className="space-y-1 text-xs">
      <p role="status" className={current?.ok ? "text-green-700 dark:text-green-400" : "text-gray-500"}>{current?.message || (connection ? ragConnectionLabel(connection, ja) : error ? (ja ? "接続状態を取得できません。" : "Could not load connection status.") : (ja ? "接続状態を取得中…" : "Loading connection status…"))}</p>
      <div className="flex flex-wrap items-center gap-2">
        {connection?.state === "ready" && <button type="button" disabled={current?.busy} onClick={() => void verify()} className="rounded border px-2 py-1 disabled:opacity-50">{current?.busy ? (ja ? "確認中…" : "Verifying…") : (ja ? "接続確認" : "Verify connection")}</button>}
        {connection && <a href={connection.settingsHref} className="text-blue-600 underline">{connection.state === "locked" ? (ja ? "一般設定でロック解除" : "Unlock in General settings") : (ja ? "AIプロバイダーを設定" : "Configure AI provider")}</a>}
        <button type="button" disabled={current?.busy} onClick={() => { setVerification(undefined); onRefresh(); }} className="text-blue-600 underline">{ja ? "状態を更新" : "Refresh status"}</button>
      </div>
      {connection?.state === "ready" && <p className="text-[10px] text-gray-500">{ja ? "接続確認には少量のAPI利用料がかかります。" : "Connection verification incurs a small API usage charge."}</p>}
    </div>}
  </div>;
}
