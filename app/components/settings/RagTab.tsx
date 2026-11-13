import { ragSettingDisplayName } from "~/config/branding";
import {
  normalizeRagSettings,
  resolveRagTopK,
} from "~/services/rag-search-options";
import { EMBEDDING_MODELS, embeddingConfig } from "~/services/rag-config";
import { useState, useCallback, useEffect, useRef, useId } from "react";
import { useFetcher, useRevalidator } from "react-router";
import {
  ArrowLeft,
  ChevronRight,
  Database,
  Plus,
  Trash2,
  RefreshCw,
  BookOpen,
} from "lucide-react";
import { useI18n } from "~/i18n/context";
import { invalidateIndexCache } from "~/utils/index-cache";
import {
  StatusBanner,
  SectionCard,
  SaveButton,
  inputClass,
} from "~/components/settings/shared";
import { RagFilesDialog } from "./RagFilesDialog";
import { RagFolderPicker } from "./RagFolderPicker";
import { RerankingSelect } from "./RerankingSelect";
import { EmbeddingModelSelect } from "./EmbeddingModelSelect";
import { useRagConnections } from "~/hooks/useRagConnections";
import type { UserSettings, RagSetting } from "~/types/settings";
import { DEFAULT_RAG_SETTING, DEFAULT_RAG_STORE_KEY } from "~/types/settings";
import { discoverOkfBundles, type OkfBundle } from "~/services/okf-loader";

const normalizeRoot = (value: string) =>
  value.trim().replace(/^\/+|\/+$/g, "") || "Knowledge";
const lines = (values: string[]) =>
  values.map((value) => value.trim()).filter(Boolean);
const initialSettings = (settings: UserSettings): Record<string, RagSetting> =>
  Object.fromEntries(
    Object.entries(
      normalizeRagSettings(settings.ragSettings, settings.ragTopK),
    ).map(([name, setting]) => [
      name,
      { ...setting, isExternal: false, storeIds: [] },
    ]),
  );
const initialSelection = (settings: UserSettings) =>
  settings.selectedRagSetting &&
  settings.ragSettings[settings.selectedRagSetting]
    ? settings.selectedRagSetting
    : settings.ragSettings[DEFAULT_RAG_STORE_KEY]
      ? DEFAULT_RAG_STORE_KEY
      : Object.keys(settings.ragSettings)[0] || "";

// Compare editable options only; sync progress never creates unsaved edits.
function indexSnapshot(setting: RagSetting, name: string) {
  return JSON.stringify([
    name.trim(),
    resolveRagTopK(setting),
    setting.rerankProvider ?? "off",
    setting.hybridSearch !== false,
    setting.searchUntilMatch === true,
    embeddingConfig(setting),
    setting.chunkSize || 1500,
    setting.chunkOverlap ?? 150,
    lines(setting.targetFolders),
    lines(setting.excludePatterns),
  ]);
}
const withoutKey = <T,>(record: Record<string, T>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));

export function RagTab({
  settings,
  rootFolderId,
  disabledByApiKey = false,
}: {
  settings: UserSettings;
  rootFolderId: string;
  disabledByApiKey?: boolean;
}) {
  const { t, language } = useI18n();
  const ja = language === "ja";
  const id = useId();
  const fetcher = useFetcher<{
    success?: boolean;
    message?: string;
    ragSettingName?: string;
    ragSetting?: RagSetting;
  }>();
  const okfFetcher = useFetcher<{
    success?: boolean;
    message?: string;
    okfRoot?: string;
  }>();
  const revalidator = useRevalidator();
  const {
    connections,
    error: connectionError,
    refresh: refreshConnections,
  } = useRagConnections(
    undefined,
    JSON.stringify([
      settings.encryptedApiKey,
      settings.openai?.encryptedApiKey,
      settings.jev,
      settings.compatibleProviders?.openrouter?.encryptedApiKey,
    ]),
    !!settings.ragAvailable,
  );
  const [ragSettings, setRagSettings] = useState(() =>
    initialSettings(settings),
  );
  const [selected, setSelected] = useState(() => initialSelection(settings));
  const [editing, setEditing] = useState(false);
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [okfRoot, setOkfRoot] = useState(settings.okfRoot || "Knowledge");
  const [savedIndexes, setSavedIndexes] = useState(() =>
    initialSettings(settings),
  );
  const [savedOkfRoot, setSavedOkfRoot] = useState(() =>
    normalizeRoot(settings.okfRoot || "Knowledge"),
  );
  const pendingSave = useRef<{ kind: "save" | "delete"; key: string } | null>(
    null,
  );
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [bundles, setBundles] = useState<(OkfBundle & { path: string })[]>([]);
  const [loadingBundles, setLoadingBundles] = useState(false);
  const current = ragSettings[selected];
  const name = renames[selected] ?? selected;
  const isIndexDirty = (key: string) =>
    !Object.hasOwn(savedIndexes, key) ||
    indexSnapshot(ragSettings[key], renames[key] ?? key) !==
      indexSnapshot(savedIndexes[key], key);
  const dirty = !!current && isIndexDirty(selected);
  const okfDirty = normalizeRoot(okfRoot) !== savedOkfRoot;
  const saving = fetcher.state !== "idle" || okfFetcher.state !== "idle";
  const unsavedIndexes = Object.keys(ragSettings).some(isIndexDirty);
  const names = Object.keys(ragSettings).sort((a, b) =>
    a === DEFAULT_RAG_STORE_KEY
      ? -1
      : b === DEFAULT_RAG_STORE_KEY
        ? 1
        : a.localeCompare(b),
  );

  const refreshBundles = useCallback(async (root: string) => {
    setLoadingBundles(true);
    try {
      const folder = normalizeRoot(root);
      const discovered = await discoverOkfBundles(folder);
      setBundles(
        discovered.map((bundle) => ({
          ...bundle,
          path: [folder, bundle.id].filter(Boolean).join("/"),
        })).sort((a, b) => a.path.localeCompare(b.path)),
      );
    } catch {
      setBundles([]);
    } finally {
      setLoadingBundles(false);
    }
  }, []);
  useEffect(() => {
    void refreshBundles(settings.okfRoot || "Knowledge");
  }, [settings.okfRoot, refreshBundles]);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || !pendingSave.current)
      return;
    const pending = pendingSave.current;
    if (fetcher.data.success) {
      if (
        pending.kind === "save" &&
        fetcher.data.ragSetting &&
        fetcher.data.ragSettingName
      ) {
        const setting = fetcher.data.ragSetting;
        const name = fetcher.data.ragSettingName;
        setSavedIndexes((previous) => ({
          ...withoutKey(previous, pending.key),
          [name]: setting,
        }));
        setRagSettings((previous) => ({
          ...withoutKey(previous, pending.key),
          [name]: setting,
        }));
        setRenames((previous) => withoutKey(previous, pending.key));
        setSelected(name);
      } else if (pending.kind === "delete") {
        setSavedIndexes((previous) => withoutKey(previous, pending.key));
        setRagSettings((previous) => withoutKey(previous, pending.key));
        setRenames((previous) => withoutKey(previous, pending.key));
        setSelected("");
        setEditing(false);
        setShowFiles(false);
      }
      invalidateIndexCache();
    }
    setWarning(!fetcher.data.success);
    setMessage(fetcher.data.message || "");
    pendingSave.current = null;
  }, [fetcher.state, fetcher.data]);
  useEffect(() => {
    if (
      okfFetcher.state !== "idle" ||
      !okfFetcher.data?.success ||
      okfFetcher.data.okfRoot === undefined
    )
      return;
    const root = okfFetcher.data.okfRoot;
    setSavedOkfRoot(root);
    setOkfRoot(root);
    void refreshBundles(root);
    invalidateIndexCache();
  }, [okfFetcher.state, okfFetcher.data, refreshBundles]);

  const update = (patch: Partial<RagSetting>) =>
    setRagSettings((previous) => ({
      ...previous,
      [selected]: { ...previous[selected], ...patch },
    }));
  const select = (key: string) => {
    setSelected(key);
    setEditing(true);
    setShowFiles(false);
    setMessage("");
  };
  const add = (automatic = false) => {
    let key = automatic ? DEFAULT_RAG_STORE_KEY : "index-1";
    for (let number = 2; ragSettings[key]; number++) key = `index-${number}`;
    setRagSettings((previous) => ({
      ...previous,
      [key]: { ...DEFAULT_RAG_SETTING, files: {} },
    }));
    select(key);
  };
  const remove = () => {
    if (!current || saving || syncing) return;
    if (!Object.hasOwn(savedIndexes, selected)) {
      setRagSettings((previous) => withoutKey(previous, selected));
      setRenames((previous) => withoutKey(previous, selected));
      setSelected("");
      setEditing(false);
      setShowFiles(false);
      setMessage("");
      return;
    }
    const form = new FormData();
    form.set("_action", "deleteRagIndex");
    form.set("name", selected);
    pendingSave.current = { kind: "delete", key: selected };
    setMessage("");
    fetcher.submit(form, { method: "post" });
  };
  const save = () => {
    if (!current || !dirty || saving || syncing) return;
    setMessage("");
    setWarning(false);
    const nextName = name.trim();
    if (
      !nextName ||
      (nextName !== selected &&
        (Object.hasOwn(savedIndexes, nextName) ||
          Object.entries(ragSettings).some(
            ([key]) =>
              key !== selected && (renames[key] ?? key).trim() === nextName,
          ))) ||
      (selected !== DEFAULT_RAG_STORE_KEY && nextName === DEFAULT_RAG_STORE_KEY)
    ) {
      setWarning(true);
      setMessage(
        ja
          ? "重複しないインデックス名を入力してください。"
          : "Enter a unique index name.",
      );
      return;
    }
    const excludePatterns = lines(current.excludePatterns);
    for (const pattern of excludePatterns) {
      try {
        new RegExp(pattern);
      } catch {
        setWarning(true);
        setMessage(
          t("settings.rag.invalidExcludePattern").replace("{pattern}", pattern),
        );
        return;
      }
    }
    const form = new FormData();
    form.set("_action", "saveRagIndex");
    form.set(
      "originalName",
      Object.hasOwn(savedIndexes, selected) ? selected : "",
    );
    form.set("name", nextName);
    form.set(
      "ragSetting",
      JSON.stringify({
        topK: resolveRagTopK(current, settings.ragTopK),
        rerankProvider: current.rerankProvider,
        hybridSearch: current.hybridSearch,
        jevRagFilterEnabled: current.jevRagFilterEnabled,
        searchUntilMatch: current.searchUntilMatch,
        embeddingProvider: embeddingConfig(current).provider,
        embeddingModel: embeddingConfig(current).model,
        chunkSize: current.chunkSize || 1500,
        chunkOverlap: current.chunkOverlap ?? 150,
        targetFolders: lines(current.targetFolders),
        excludePatterns,
      }),
    );
    pendingSave.current = { kind: "save", key: selected };
    fetcher.submit(form, { method: "post" });
  };
  const saveOkf = () => {
    if (!okfDirty || saving || syncing) return;
    const form = new FormData();
    form.set("_action", "saveOkf");
    form.set("okfRoot", normalizeRoot(okfRoot));
    okfFetcher.submit(form, { method: "post" });
  };

  const sync = async () => {
    if (!current || dirty || saving || syncing) return;
    setSyncing(true);
    setWarning(false);
    setMessage(ja ? "同期を開始しています…" : "Starting sync…");
    try {
      // Synchronize saved settings only; Sync never silently saves other edits.
      const response = await fetch("/api/settings/rag-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ragSettingName: selected }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || t("settings.rag.syncFailed"));
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error(t("settings.rag.noResponseBody"));
      const decoder = new TextDecoder();
      let buffer = "";
      const consume = (line: string) => {
        if (!line.startsWith("data: ")) return;
        let event: {
          type?: string;
          message?: string;
          errors?: number;
          ragSetting?: RagSetting;
        };
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          return;
        }
        if (event.message) setMessage(event.message);
        if (event.type === "error" || event.errors) setWarning(true);
        if (event.type === "complete" && event.ragSetting)
          setRagSettings((previous) => ({
            ...previous,
            [selected]: event.ragSetting!,
          }));
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const complete = buffer.split("\n");
        buffer = complete.pop() || "";
        complete.forEach(consume);
      }
      if (buffer) consume(buffer);
      invalidateIndexCache();
      revalidator.revalidate();
    } catch (error) {
      setWarning(true);
      setMessage(
        error instanceof Error ? error.message : t("settings.rag.syncError"),
      );
    } finally {
      setSyncing(false);
    }
  };

  if (!settings.ragAvailable || disabledByApiKey)
    return (
      <SectionCard>
        <p className="text-sm text-amber-800 dark:text-amber-200">
          {ja
            ? "RAGには有効なkiokuflowプランとFirestoreが必要です。"
            : "RAG requires an active kiokuflow plan and Firestore."}
        </p>
      </SectionCard>
    );
  const files = Object.values(current?.files || {});
  const registered = files.filter(
    (file) => file.status === "registered",
  ).length;
  return (
    <div>
      <fetcher.Form
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          if (editing) save();
          else saveOkf();
        }}
      >
        <fieldset disabled={saving || syncing} className="min-w-0 space-y-6">
          <SectionCard>
            <section aria-labelledby={`${id}-vector`} className="space-y-5">
              <div className="space-y-2">
                <h2
                  id={`${id}-vector`}
                  className="flex items-center gap-2 text-lg font-semibold"
                >
                  <Database size={18} />
                  {ja ? "ベクトルインデックス" : "Vector indexes"}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {editing
                    ? ja
                      ? "このインデックスの設定は画面末尾のSaveで保存します。対象ファイルやモデルを変更したら、その後に同期してください。"
                      : "Save this index with Save at the bottom, then sync after changing files or the embedding model."
                    : ja
                      ? "文書をインデックス化して意味で検索します。設定は各インデックスの詳細画面で保存します。"
                      : "Index documents for semantic search. Open an index to edit and save its settings."}
                </p>
                {(editing ? dirty : unsavedIndexes) && (
                  <p
                    role="status"
                    className="text-xs text-amber-700 dark:text-amber-300"
                  >
                    {editing
                      ? ja
                        ? "このインデックスに未保存の変更があります。"
                        : "This index has unsaved changes."
                      : ja
                        ? "未保存のRAG設定があります。各インデックスの詳細から保存してください。"
                        : "Some indexes have unsaved changes. Open each index to save it."}
                  </p>
                )}
              </div>
              <section className="space-y-3">
                {!editing ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        {ja ? "インデックス" : "Indexes"} ({names.length})
                      </h3>
                      <button
                        type="button"
                        onClick={() => add()}
                        className="inline-flex items-center gap-1 rounded border px-3 py-2 text-sm"
                      >
                        <Plus size={14} />
                        {ja ? "追加" : "Add"}
                      </button>
                    </div>
                    {names.length ? (
                      <ul
                        aria-label={ja ? "RAGインデックス一覧" : "RAG indexes"}
                        className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700"
                      >
                        {names.map((key) => {
                          const setting = ragSettings[key];
                          const title = ragSettingDisplayName(
                            renames[key] ?? key,
                          );
                          const files = Object.values(setting.files || {});
                          const registered = files.filter(
                            (file) => file.status === "registered",
                          ).length;
                          const pending = files.length - registered;
                          const folders = lines(setting.targetFolders);
                          return (
                            <li key={key}>
                              <button
                                type="button"
                                aria-label={
                                  ja ? `${title} の設定を開く` : `Edit ${title}`
                                }
                                onClick={() => select(key)}
                                className="flex w-full items-center gap-3 p-4 text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:bg-gray-800"
                              >
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="break-all text-sm font-semibold">
                                      {title}
                                    </span>
                                    {isIndexDirty(key) && (
                                      <span className="text-xs text-amber-700 dark:text-amber-300">
                                        {ja ? "未保存" : "Unsaved"}
                                      </span>
                                    )}
                                    {key === DEFAULT_RAG_STORE_KEY && (
                                      <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                        {ja
                                          ? "Push時に自動登録"
                                          : "Auto on Push"}
                                      </span>
                                    )}
                                  </div>
                                  <p className="break-all text-xs text-gray-600 dark:text-gray-400">
                                    {ja ? "対象: " : "Folders: "}
                                    {folders.length
                                      ? folders.join(", ")
                                      : ja
                                        ? "すべてのフォルダ"
                                        : "All folders"}
                                  </p>
                                  <p className="break-all text-xs text-gray-500">
                                    {embeddingConfig(setting).model}
                                  </p>
                                  <p className="text-xs text-gray-600 dark:text-gray-400">
                                    {ja
                                      ? `登録済み ${registered} / ${files.length} ファイル`
                                      : `${registered} / ${files.length} files registered`}
                                    {pending > 0 && (
                                      <span className="ml-2 text-amber-700 dark:text-amber-300">
                                        {ja
                                          ? `保留 ${pending}`
                                          : `${pending} pending`}
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {setting.lastFullSync
                                      ? `${ja ? "前回の同期: " : "Last sync: "}${new Date(setting.lastFullSync).toLocaleString(language)}`
                                      : ja
                                        ? "未同期"
                                        : "Not synced yet"}
                                  </p>
                                </div>
                                <span className="flex shrink-0 items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                                  {ja ? "編集" : "Edit"}
                                  <ChevronRight size={16} />
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700">
                        {ja
                          ? "インデックスがありません。「追加」から作成してください。"
                          : "No indexes yet. Choose Add to create one."}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(false);
                        setShowFiles(false);
                        setMessage("");
                      }}
                      className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400"
                    >
                      <ArrowLeft size={16} />
                      {ja ? "一覧へ戻る" : "Back to indexes"}
                    </button>
                    {current && (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="min-w-0 break-all text-sm font-semibold">
                          {ragSettingDisplayName(name)}
                        </h3>
                        <button
                          type="button"
                          onClick={remove}
                          className="inline-flex items-center gap-1 rounded border px-3 py-2 text-sm text-red-600"
                        >
                          <Trash2 size={14} />
                          {ja ? "削除" : "Delete"}
                        </button>
                      </div>
                    )}
                    {current && (
                      <label className="block text-sm">
                        {ja ? "名前" : "Name"}
                        <input
                          className={inputClass + " mt-1"}
                          value={
                            selected === DEFAULT_RAG_STORE_KEY
                              ? ragSettingDisplayName(selected)
                              : name
                          }
                          disabled={selected === DEFAULT_RAG_STORE_KEY}
                          onChange={(event) =>
                            setRenames((previous) => ({
                              ...previous,
                              [selected]: event.target.value,
                            }))
                          }
                        />
                      </label>
                    )}
                    {selected === DEFAULT_RAG_STORE_KEY && (
                      <p className="text-xs text-gray-500">
                        {ja
                          ? "このインデックスはPush時にも自動登録されます。"
                          : "This index also registers files automatically on Push."}
                      </p>
                    )}
                  </>
                )}
                {!editing && !ragSettings[DEFAULT_RAG_STORE_KEY] && (
                  <button
                    type="button"
                    onClick={() => add(true)}
                    className="text-xs text-blue-600 underline"
                  >
                    {ja
                      ? "Push時の自動登録用インデックスを追加"
                      : "Add an index for automatic registration on Push"}
                  </button>
                )}
              </section>
              {editing && current && (
                <>
                  <section
                    aria-label={ja ? "検索設定" : "Search settings"}
                    className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
                  >
                    <h3 className="text-sm font-semibold">
                      {ja ? "検索設定" : "Search settings"}
                    </h3>
                    <p className="text-xs text-gray-500">
                      {ja
                        ? "保存すると検索・チャットに反映されます。再同期は不要です。"
                        : "Saved options apply to search and chat. No reindexing is needed."}
                    </p>
                    <label className="flex flex-wrap items-center gap-2 text-sm">
                      {ja ? "返す件数（Top K）" : "Result limit (Top K)"}
                      <input
                        aria-label="Top K"
                        type="number"
                        min={1}
                        max={20}
                        value={resolveRagTopK(current, settings.ragTopK)}
                        onChange={(event) =>
                          update({
                            topK: resolveRagTopK({
                              topK: Number(event.target.value) || 1,
                            }),
                          })
                        }
                        className={inputClass + " max-w-24"}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={current.hybridSearch !== false}
                        onChange={(event) =>
                          update({ hybridSearch: event.target.checked })
                        }
                      />
                      {ja
                        ? "ハイブリッド検索（キーワード＋意味検索）"
                        : "Hybrid search (keywords + semantic search)"}
                    </label>
                    <RerankingSelect
                      value={current.rerankProvider}
                      onChange={(rerankProvider) => update({ rerankProvider })}
                      connections={connections}
                      error={connectionError}
                      onRefresh={refreshConnections}
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={
                          !current.rerankProvider ||
                          current.rerankProvider === "off"
                        }
                        checked={current.searchUntilMatch === true}
                        onChange={(event) =>
                          update({ searchUntilMatch: event.target.checked })
                        }
                      />
                      {ja
                        ? "回答が見つかるまで検索する"
                        : "Search until an answer is found"}
                    </label>
                    {current.rerankProvider &&
                      current.rerankProvider !== "off" && (
                        <p className="text-xs text-gray-500">
                          {ja
                            ? "関連度を0〜3点で採点します。繰り返し検索は40件ずつ最大1,000候補を調べ、2点以上で停止します。失敗時は警告付きで元の結果を返します。"
                            : "Relevance is scored from 0 to 3. Repeat checks batches of 40, up to 1,000 candidates, until a score of at least 2. Failures return original results with a warning."}
                        </p>
                      )}
                  </section>
                  <section className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                    <h3 className="text-sm font-semibold">
                      {ja
                        ? "対象ファイル・モデルの設定"
                        : "Files and embedding model"}
                    </h3>
                    <div className="mt-3 space-y-4">
                      <p className="text-xs text-gray-500">
                        {ja
                          ? "ここを変更したらSaveの後に同期してください。モデルの変更時はインデックスを再作成します。"
                          : "Save and then sync after changing these options. Changing models rebuilds the index."}
                      </p>
                      <label className="block text-sm">
                        {ja ? "Embeddingプロバイダー" : "Embedding provider"}
                        <select
                          className={inputClass + " mt-1"}
                          value={embeddingConfig(current).provider}
                          onChange={(event) => {
                            const provider = event.target.value as
                              | "gemini"
                              | "openai";
                            update({
                              embeddingProvider: provider,
                              embeddingModel: EMBEDDING_MODELS[provider][0],
                            });
                          }}
                        >
                          <option value="gemini">Gemini</option>
                          <option value="openai">OpenAI</option>
                        </select>
                      </label>
                      <EmbeddingModelSelect
                        provider={embeddingConfig(current).provider}
                        value={embeddingConfig(current).model}
                        onChange={(embeddingModel) =>
                          update({ embeddingModel })
                        }
                        connection={
                          connections?.embedding[
                            embeddingConfig(current).provider
                          ]
                        }
                        error={connectionError}
                        onRefresh={refreshConnections}
                      />
                      <p className="text-xs text-gray-500">
                        {ja
                          ? "OpenAIはテキストと文字を抽出できるPDF、Gemini Embedding 2は画像・スキャンPDFにも対応します。"
                          : "OpenAI supports text and text PDFs. Gemini Embedding 2 also supports images and scanned PDFs."}
                      </p>
                      <RagFolderPicker
                        rootFolderId={rootFolderId}
                        value={current.targetFolders}
                        onChange={(targetFolders) => update({ targetFolders })}
                      />
                      <label className="block text-sm">
                        {ja
                          ? "除外するパス（1行に1つ、正規表現）"
                          : "Excluded paths (one regular expression per line)"}
                        <textarea
                          rows={2}
                          className={inputClass + " mt-1"}
                          value={current.excludePatterns.join("\n")}
                          onChange={(event) =>
                            update({
                              excludePatterns: event.target.value.split("\n"),
                            })
                          }
                        />
                      </label>
                      <p className="text-xs text-gray-500">
                        {t("settings.rag.excludePatternHint")}
                      </p>
                      <section>
                        <h4 className="text-sm font-medium">
                          {ja
                            ? "文書の分割方法"
                            : "Text chunking"}
                        </h4>
                        <div className="mt-2 space-y-2">
                          <label className="block text-sm">
                            {ja ? "1区切りの文字数" : "Characters per chunk"}
                            <input
                              type="number"
                              min={100}
                              max={5000}
                              className={inputClass}
                              value={current.chunkSize || 1500}
                              onChange={(event) => {
                                const chunkSize = Math.min(
                                  5000,
                                  Math.max(
                                    100,
                                    Number(event.target.value) || 1500,
                                  ),
                                );
                                update({
                                  chunkSize,
                                  chunkOverlap: Math.min(
                                    current.chunkOverlap ?? 150,
                                    chunkSize - 1,
                                  ),
                                });
                              }}
                            />
                          </label>
                          <label className="block text-sm">
                            {ja
                              ? "前後の重なり（文字数）"
                              : "Overlapping characters"}
                            <input
                              type="number"
                              min={0}
                              max={(current.chunkSize || 1500) - 1}
                              className={inputClass}
                              value={current.chunkOverlap ?? 150}
                              onChange={(event) =>
                                update({
                                  chunkOverlap: Math.max(
                                    0,
                                    Math.min(
                                      (current.chunkSize || 1500) - 1,
                                      Number(event.target.value) || 0,
                                    ),
                                  ),
                                })
                              }
                            />
                          </label>
                        </div>
                      </section>
                    </div>
                  </section>
                  <section
                    aria-label={ja ? "同期" : "Sync"}
                    className="space-y-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
                  >
                    <h3 className="text-sm font-semibold">
                      {ja ? "同期" : "Sync"}
                    </h3>
                    <p className="text-xs text-gray-500">
                      {ja
                        ? "保存済みの設定でファイルを読み込み、検索用インデックスを更新します。"
                        : "Read files using saved settings and update the search index."}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={dirty || saving || syncing}
                        onClick={() => void sync()}
                        className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm disabled:opacity-50"
                      >
                        <RefreshCw
                          size={14}
                          className={syncing ? "animate-spin" : ""}
                        />
                        {syncing
                          ? ja
                            ? "同期中…"
                            : "Syncing…"
                          : current.storeId
                            ? ja
                              ? "同期する"
                              : "Sync index"
                            : ja
                              ? "インデックスを作成・同期"
                              : "Create and sync index"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowFiles(true)}
                        className="text-xs text-blue-600 underline"
                      >
                        {ja
                          ? `登録済み ${registered} / ${files.length} ファイル`
                          : `${registered} / ${files.length} files registered`}
                      </button>
                    </div>
                    {dirty && (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        {ja
                          ? "先に画面末尾のSaveで設定を保存してください。"
                          : "Save the settings below before syncing."}
                      </p>
                    )}
                    {current.lastFullSync && (
                      <p className="text-xs text-gray-500">
                        {ja ? "前回の同期: " : "Last sync: "}
                        {new Date(current.lastFullSync).toLocaleString(
                          language,
                        )}
                      </p>
                    )}
                  </section>
                </>
              )}

              {message && (
                <p
                  role="status"
                  className={`whitespace-pre-wrap break-words rounded p-3 text-sm ${warning ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
                >
                  {message}
                </p>
              )}
              {editing && current && (
                <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
                  <SaveButton loading={saving} disabled={!dirty || syncing} />
                  <p className="mt-2 text-xs text-gray-500">
                    {ja
                      ? "このインデックスの設定だけを保存します。同期は実行しません。"
                      : "Save only this index. This does not start a sync."}
                  </p>
                </div>
              )}
            </section>
          </SectionCard>
          {!editing && (
            <SectionCard>
              <section aria-labelledby={`${id}-okf`} className="space-y-4">
                <div className="space-y-2">
                  <h2
                    id={`${id}-okf`}
                    className="flex items-center gap-2 text-lg font-semibold"
                  >
                    <BookOpen size={18} />
                    OKF
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {ja
                      ? "目次から必要な知識を参照します。"
                      : "Use a table of contents to look up the knowledge you need."}
                  </p>
                </div>
                <div className="space-y-3">
                  <StatusBanner fetcher={okfFetcher} />
                  <label className="block text-sm">
                    {ja ? "知識パックのフォルダ" : "Knowledge bundle folder"}
                    <input
                      className={inputClass + " mt-1"}
                      value={okfRoot}
                      onChange={(event) => setOkfRoot(event.target.value)}
                      placeholder="Knowledge"
                    />
                  </label>
                  {bundles.length > 0 && (
                    <ul
                      aria-label={ja ? "知識パック一覧" : "Knowledge bundles"}
                      className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700"
                    >
                      {bundles.map((bundle) => (
                        <li
                          key={bundle.id}
                          className="flex items-center gap-2 p-3"
                        >
                          <BookOpen
                            size={16}
                            className="shrink-0 text-gray-500"
                          />
                          <span
                            className="min-w-0 flex-1 truncate text-sm"
                            title={bundle.path}
                          >
                            {bundle.id || "."}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!loadingBundles && !bundles.length && (
                    <p className="text-xs text-gray-500">
                      {ja
                        ? "知識パックが見つかりません。index.mdを含むフォルダを追加してDriveと同期してください。"
                        : "No knowledge bundles found. Add folders containing index.md and sync Drive."}
                    </p>
                  )}
                  <p className="text-xs text-gray-500">
                    {ja
                      ? "このSaveは知識パックのフォルダだけを保存します。"
                      : "This Save updates only the knowledge bundle folder."}
                  </p>
                  <SaveButton
                    loading={okfFetcher.state !== "idle"}
                    disabled={!okfDirty || saving || syncing}
                  />
                </div>
              </section>
            </SectionCard>
          )}
        </fieldset>
      </fetcher.Form>
      {showFiles && current && (
        <RagFilesDialog
          settingName={selected}
          files={current.files}
          onClose={() => setShowFiles(false)}
        />
      )}
    </div>
  );
}
