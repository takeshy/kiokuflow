import { ragSettingDisplayName } from "~/config/branding";
import { resolveRagTopK, resolveRerankProvider } from "~/services/rag-search-options";
import { useRagConnections } from "~/hooks/useRagConnections";
import { RerankingSelect } from "~/components/settings/RerankingSelect";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ArrowLeft, Search, Loader2, FileCode, FileText, FileJson, File } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { useI18n } from "~/i18n/context";
import { useEnterpriseSelection } from "~/contexts/EnterpriseContext";
import { getAllCachedFiles } from "~/services/indexeddb-cache";
import { isSentenceSearch, searchFileNames, searchFileContents, resolveRagResults, mergeFileSearchResults, type FileSearchResult, type SearchTarget } from "~/services/file-search";
import type { FileListItem } from "~/contexts/EditorContext";
import type { ApiPlan, RagSetting } from "~/types/settings";

export interface SearchPanelProps {
  apiPlan: ApiPlan;
  /** kiokuflow subscription entitlement; independent of Gemini's API tier. */
  ragAvailable?: boolean;
  ragStoreIds: string[];
  ragSettingName?: string;
  ragSettings?: Record<string, RagSetting>;
  jevAvailable?: boolean;
  ragTopK: number;
  fileList: FileListItem[];
  onSelectFile: (fileId: string, fileName: string, mimeType: string) => void;
  onClose: () => void;
  initialQuery?: string;
  initialTarget?: SearchTarget;
  autoSearch?: boolean;
  workspaceKey?: string;
}

function getFileIcon(name: string) {
  if (/\.ya?ml$/i.test(name)) return <FileCode size={ICON.MD} className="shrink-0 text-orange-500" />;
  if (/\.md$/i.test(name)) return <FileText size={ICON.MD} className="shrink-0 text-blue-500" />;
  if (/\.json$/i.test(name)) return <FileJson size={ICON.MD} className="shrink-0 text-yellow-500" />;
  return <File size={ICON.MD} className="shrink-0 text-gray-400" />;
}

type SearchMethod = "keyword" | "expanded";
export function SearchPanel({ ragAvailable = false, ragStoreIds, ragSettingName = "gemihub", ragSettings, ragTopK, fileList, onSelectFile, onClose, initialQuery = "", initialTarget, autoSearch = false, workspaceKey = "" }: SearchPanelProps) {
  const { t, language } = useI18n();
  const project = useEnterpriseSelection();
  const [target, setTarget] = useState<SearchTarget>(initialTarget || (autoSearch ? "content" : "files"));
  const [query, setQuery] = useState(initialQuery);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const [method, setMethod] = useState<SearchMethod>("keyword");
  const [ragScope, setRagScope] = useState<"none" | "server" | "hybrid">("none");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });
  const autoRunRef = useRef(false);
  const [searchRagName, setSearchRagName] = useState(ragSettingName);
  const currentRagSetting = ragSettings?.[searchRagName];
  const effectiveStoreIds = useMemo(() => ragSettings ? currentRagSetting?.storeId ? [currentRagSetting.storeId] : [] : ragStoreIds, [ragSettings, currentRagSetting?.storeId, ragStoreIds]);
  const defaultTopK = resolveRagTopK(currentRagSetting, ragTopK);
  const scope = JSON.stringify([workspaceKey, project?.projectId, searchRagName]);
  const [topKOverride, setTopKOverride] = useState<{ scope: string; value: number }>();
  const batchTopK = topKOverride?.scope === scope ? topKOverride.value : defaultTopK;
  const { connections, error: connectionError, refresh: refreshConnections } = useRagConnections(project?.projectId, "", ragAvailable);
  const [rerankProvider, setRerankProvider] = useState(resolveRerankProvider(currentRagSetting));
  const [hybridSearch, setHybridSearch] = useState(currentRagSetting?.hybridSearch !== false);
  const [untilMatch, setUntilMatch] = useState(currentRagSetting?.searchUntilMatch === true);
  const jevActive = rerankProvider !== "off";
  const canRag = ragAvailable && (project ? !!searchRagName : effectiveStoreIds.length > 0);

  const resetSearch = useCallback(() => {
    requestRef.current.controller?.abort();
    requestRef.current.generation++;
    setSearching(false); setResults([]); setError(null); setNotice(null); setSearchedQuery(null); setRagScope("none");
  }, []);
  useEffect(() => {
    const pending = requestRef.current;
    resetSearch();
    return () => { pending.generation++; pending.controller?.abort(); };
  }, [workspaceKey, project?.orgId, project?.projectId, resetSearch]);
  useEffect(() => { inputRef.current?.focus(); }, [target]);

  const runSearch = useCallback(async (forced?: SearchMethod) => {
    const q = query.trim();
    if (!q) return;
    requestRef.current.controller?.abort();
    const generation = ++requestRef.current.generation;
    const controller = new AbortController();
    requestRef.current.controller = controller;
    const current = () => generation === requestRef.current.generation && !controller.signal.aborted;
    const sentence = target === "content" && isSentenceSearch(q);
    const expanded = forced === "expanded" || (forced !== "keyword" && sentence && canRag);
    const serverOnly = sentence && canRag && !forced;
    setSearching(true); setResults([]); setError(null); setNotice(null); setSearchedQuery(null); setRagScope("none");
    let localResults: FileSearchResult[] = [];
    let appliedMethod: SearchMethod = expanded ? "expanded" : "keyword";
    try {
      const cached = target === "content" && !serverOnly ? await getAllCachedFiles() : [];
      if (!current()) return;
      const keywords = serverOnly ? [] : target === "files" ? searchFileNames(fileList, q) : searchFileContents(fileList, cached, q);
      localResults = expanded && (!sentence || forced === "expanded")
        ? mergeFileSearchResults(keywords, target === "files" ? searchFileNames(fileList, q, true) : searchFileContents(fileList, cached, q, true))
        : keywords;
      if (sentence && !canRag && forced !== "keyword") setNotice(t(ragAvailable ? "search.ragSetupNeeded" : "search.ragPaidOnly"));
      if (target === "content" && expanded && canRag) {
        try {
          const response = await fetch(project ? "/api/rag/search" : "/api/search", {
            method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
            body: JSON.stringify(project ? { projectId: project.projectId, ragSettingName: searchRagName, query: q, topK: batchTopK, rerankProvider, hybridSearch, searchUntilMatch: jevActive && untilMatch } : { mode: "rag", query: q, ragStoreIds: effectiveStoreIds, topK: batchTopK, rerankProvider, hybridSearch, searchUntilMatch: jevActive && untilMatch }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || t("search.error"));
          if (!current()) return;
          const hits = project ? (data.results || []).map((result: { docPath: string; text: string; contentType?: string; jevVerified?: boolean; retrievalScore?: number; retrievalSource?: string; rerankScore?: number; rerankSkippedReason?: string }) => ({ title: result.docPath, snippet: result.text, mimeType: result.contentType, jevVerified: result.jevVerified, retrievalScore: result.retrievalScore, retrievalSource: result.retrievalSource, rerankScore: result.rerankScore, rerankSkippedReason: result.rerankSkippedReason })) : data.results || [];
          const semantic = resolveRagResults(hits, fileList);
          localResults = serverOnly ? mergeFileSearchResults(semantic) : mergeFileSearchResults(keywords, semantic, localResults);
          setRagScope(serverOnly ? "server" : "hybrid");
          const warnings: string[] = Array.isArray(data.warnings) ? data.warnings : [];
          if (data.candidateLimitReached) warnings.push(language === "ja" ? "1000候補の検索上限に達しました。検索条件を絞って再検索してください。" : "Reached the 1,000-candidate limit. Narrow the query and search again.");
          if (data.uncheckedCount) warnings.push(language === "ja" ? "一部のメディアは採点できないため元の検索順位を保持しています。" : "Some media could not be judged and is shown as unchecked candidates.");
          if (warnings.length) setNotice(warnings.join(" "));
        } catch (cause) {
          if (!current()) return;
          if (serverOnly) {
            const fallbackCache = await getAllCachedFiles();
            if (!current()) return;
            localResults = searchFileContents(fileList, fallbackCache, q);
            appliedMethod = "keyword";
          }
          setNotice(`${t("search.ragUnavailable")} ${cause instanceof Error ? cause.message : ""}`.trim());
        }
      }
      if (!current()) return;
      setResults(localResults); setSearchedQuery(q); setMethod(appliedMethod);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : t("search.error"));
    } finally {
      if (current()) setSearching(false);
    }
  }, [query, target, fileList, canRag, ragAvailable, effectiveStoreIds, batchTopK, searchRagName, jevActive, rerankProvider, hybridSearch, untilMatch, project, t, language]);

  useEffect(() => {
    if (autoSearch && initialQuery && !autoRunRef.current) {
      autoRunRef.current = true;
      void runSearch();
    }
  }, [autoSearch, initialQuery, target, runSearch]);

  const chooseTarget = (next: SearchTarget) => { if (next !== target) { resetSearch(); setTarget(next); } };
  return <div className="flex h-full flex-col">
    <div className="flex items-center justify-between border-b border-gray-200 px-2 py-1 dark:border-gray-800">
      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("search.title")}</span>
      <button type="button" onClick={onClose} title={t("search.backToFiles")} aria-label={t("search.backToFiles")} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><ArrowLeft size={ICON.MD} /></button>
    </div>
    <div role="tablist" aria-label={t("search.chooseTarget")} className="flex border-b border-gray-200 dark:border-gray-800">
      {(["files", "content"] as const).map(value => <button type="button" role="tab" key={value} id={`search-tab-${value}`} aria-controls="search-panel" aria-selected={target === value} onClick={() => chooseTarget(value)} className={`flex-1 border-b-2 px-2 py-2 text-xs font-medium ${target === value ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"}`}>{t(value === "files" ? "search.fileMode" : "search.contentMode")}</button>)}
    </div>
    <div id="search-panel" role="tabpanel" aria-labelledby={`search-tab-${target}`} className="flex min-h-0 flex-1 flex-col">
      {target === "content" && ragAvailable && <div className="space-y-2 px-2 pt-2 text-xs">
        {ragSettings && Object.keys(ragSettings).length > 0 && <label className="block">RAG<select aria-label="RAG" value={searchRagName} onChange={event => {
          resetSearch(); setSearchRagName(event.target.value);
          setRerankProvider(resolveRerankProvider(ragSettings[event.target.value]));
          setHybridSearch(ragSettings[event.target.value]?.hybridSearch !== false);
          setUntilMatch(ragSettings[event.target.value]?.searchUntilMatch === true);
          setTopKOverride(undefined);
        }} className="mt-1 w-full rounded border border-gray-300 bg-white p-1 dark:border-gray-700 dark:bg-gray-900">{Object.keys(ragSettings).map(name => <option key={name} value={name} disabled={!project && !ragSettings[name].storeId}>{ragSettingDisplayName(name)}</option>)}</select></label>}
        <details className="rounded border border-gray-200 p-2 dark:border-gray-700">
        <summary className="cursor-pointer font-medium">{language === "ja" ? "検索設定" : "Search settings"} · Top K: {batchTopK}</summary>
        <div className="mt-2 max-h-[40vh] space-y-2 overflow-y-auto">
        <p className="text-[10px] text-gray-500">{language === "ja" ? "この検索だけに適用します。保存済みの設定は変更しません。" : "Applies to this search only. Saved defaults stay unchanged."}</p>
        <label className="flex flex-wrap items-center gap-2">Top K<input type="number" min={1} max={20} value={batchTopK} onChange={event => { resetSearch(); setTopKOverride({ scope, value: resolveRagTopK({ topK: Number(event.target.value) || 1 }) }); }} className="w-16 rounded border bg-transparent p-1" /></label>
        <button type="button" onClick={() => { resetSearch(); setTopKOverride(undefined); }} className="text-blue-600 underline">{language === "ja" ? `既定のTop Kに戻す（${defaultTopK}）` : `Reset Top K to default (${defaultTopK})`}</button>
        <label className="flex items-center gap-2"><input type="checkbox" checked={hybridSearch} onChange={event => { resetSearch(); setHybridSearch(event.target.checked); }} />{language === "ja" ? "ハイブリッド検索" : "Hybrid search"}</label>
        <RerankingSelect value={rerankProvider} onChange={provider => { resetSearch(); setRerankProvider(provider); }} connections={connections} error={connectionError} onRefresh={refreshConnections} projectId={project?.projectId} />
        <label className="flex items-center gap-2"><input type="checkbox" checked={jevActive && untilMatch} disabled={!jevActive} onChange={event => { resetSearch(); setUntilMatch(event.target.checked); }} />{language === "ja" ? "回答が見つかるまで検索する" : "Search until an answer is found"}</label>
        {jevActive && <p className="text-[10px] text-gray-500">{language === "ja" ? "Top Kは採点後の件数です。繰り返し時は40件ずつ、2点以上が見つかるまで確認します（最大1000候補）。" : "Top K limits final results. Repeated searches score groups of 40 until relevance reaches 2/3 (up to 1,000 candidates)."}</p>}
        </div>
        </details>
      </div>}
      <form className="space-y-2 px-2 py-2" onSubmit={event => { event.preventDefault(); void runSearch(); }}>
        <textarea ref={inputRef} aria-label={t(target === "files" ? "search.filePlaceholder" : "search.contentPlaceholder")} placeholder={t(target === "files" ? "search.filePlaceholder" : "search.contentPlaceholder")} value={query} maxLength={16000} rows={target === "files" ? 1 : 3} onChange={event => { resetSearch(); setQuery(event.target.value); }} onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void runSearch(); }
        }} className="w-full resize-y rounded border border-gray-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900" />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-gray-400">{t("search.enterHint")}</span>
          <button type="submit" disabled={searching || !query.trim()} className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-40">{searching ? <Loader2 size={ICON.SM} className="animate-spin" /> : <Search size={ICON.SM} />}{t("search.title")}</button>
        </div>
        <p className="text-[10px] text-gray-500">{t(target === "files" ? "search.fileHint" : "search.contentHint")}</p>
        {target === "content" && <p className="text-[10px] text-gray-400">{t(canRag ? "search.autoRagHint" : ragAvailable ? "search.ragSetupHint" : "search.freeSearchHint")}</p>}
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {searching && <div className="flex items-center justify-center py-8" role="status"><Loader2 size={ICON.LG} className="animate-spin text-gray-400" /><span className="ml-2 text-xs text-gray-400">{t("search.searching")}</span></div>}
        {error && <p role="alert" className="py-3 text-xs text-red-500">{error}</p>}
        {notice && <p role="status" className="mb-2 rounded bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">{notice}</p>}
        {!searching && searchedQuery === query.trim() && <>
          <div className="mb-2 space-y-2">
            <p className="text-[10px] text-gray-500" role="status">{t(ragScope === "server" ? "search.semanticResults" : ragScope === "hybrid" ? "search.hybridResults" : method === "expanded" ? "search.fuzzyResults" : "search.keywordResults")} · {t("search.resultCount").replace("{count}", String(results.length))}</p>
            <button type="button" onClick={() => void runSearch(method === "keyword" ? "expanded" : "keyword")} className="rounded border border-blue-200 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/20">{t(method === "keyword" ? "search.expandFuzzy" : "search.keywordOnly")}</button>
          </div>
          {results.length === 0 && <p className="py-4 text-center text-xs text-gray-400">{t("search.noResults")}</p>}
          <div className="space-y-1">{results.map((result, index) => <button type="button" key={result.id || `${result.location}-${index}`} title={result.location || result.name} disabled={!result.id} onClick={() => { if (result.id) onSelectFile(result.id, result.name, result.mimeType || (/\.ya?ml$/i.test(result.name) ? "text/yaml" : "text/plain")); }} className="flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-gray-100 disabled:cursor-default disabled:opacity-60 dark:hover:bg-gray-800">
            {getFileIcon(result.name)}<span className="min-w-0 flex-1"><span className="block truncate font-medium text-gray-700 dark:text-gray-300">{result.name}</span><span className="block truncate text-[10px] text-gray-400">{result.location}</span>{result.match === "rag" && <span className="text-[10px] text-blue-500">{result.jevVerified === false ? (language === "ja" ? "RAG · 未採点" : "RAG · unchecked") : "RAG"}</span>}{result.retrievalScore !== undefined && <span className="ml-1 text-[10px] text-gray-500">score: {result.retrievalScore.toFixed(4)}{result.retrievalSource ? ` (${result.retrievalSource})` : ""}</span>}{result.rerankScore !== undefined && <span className="ml-1 text-[10px] text-blue-500">rerank: {result.rerankScore.toFixed(3)}/3</span>}{result.rerankSkippedReason && <span className="block text-[10px] text-amber-600">{result.rerankSkippedReason}</span>}{result.snippet && <span className="mt-0.5 block whitespace-pre-wrap break-words text-[10px] text-gray-500 dark:text-gray-400">{result.snippet}</span>}</span>
          </button>)}</div>
        </>}
      </div>
    </div>
  </div>;
}
