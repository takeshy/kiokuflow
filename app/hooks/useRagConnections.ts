import { useCallback, useEffect, useRef, useState } from "react";
import type { RagConnections } from "~/services/rag-connections";

export function useRagConnections(projectId?: string, revision = "", enabled = true) {
  const scope = JSON.stringify([projectId, revision]);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ scope: string; data?: RagConnections; error?: string }>();
  const latest = useRef(scope);
  latest.current = scope;
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    void fetch(`/api/rag/providers${query}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as RagConnections;
      if (!data.reranking || !data.embedding) throw new Error("Invalid connection status");
      if (!controller.signal.aborted && latest.current === scope) setResult({ scope, data });
    }).catch(error => {
      if (!controller.signal.aborted && latest.current === scope) setResult({ scope, error: error instanceof Error ? error.message : String(error) });
    });
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); };
  }, [projectId, scope, attempt, refresh, enabled]);
  return { connections: result?.scope === scope ? result.data : undefined, error: result?.scope === scope ? result.error : undefined, refresh };
}
