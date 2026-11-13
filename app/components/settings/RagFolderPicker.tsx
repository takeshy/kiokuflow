import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { CachedTreeNode } from "~/types/tree";
import { inputClass } from "./shared";

interface FolderChoice {
  name: string;
  path: string;
  children: FolderChoice[];
}

function folderChoices(nodes: CachedTreeNode[], parent = ""): FolderChoice[] {
  return nodes
    .filter((node) => node.isFolder)
    .map((node) => {
      const path = parent ? `${parent}/${node.name}` : node.name;
      return {
        name: node.name,
        path,
        children: folderChoices(node.children ?? [], path),
      };
    });
}

function matchingFolders(
  folders: FolderChoice[],
  query: string,
): FolderChoice[] {
  return folders.flatMap((folder) => {
    if (folder.path.toLocaleLowerCase().includes(query)) return [folder];
    const children = matchingFolders(folder.children, query);
    return children.length ? [{ ...folder, children }] : [];
  });
}

export function RagFolderPicker({
  rootFolderId,
  value,
  onChange,
}: {
  rootFolderId: string;
  value: string[];
  onChange: (folders: string[]) => void;
}) {
  const ja = useI18n().language === "ja";
  const id = useId();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    root: string;
    attempt: number;
    folders?: FolderChoice[];
    error?: boolean;
  }>();
  const [expanded, setExpanded] = useState<Map<string, boolean>>(new Map());
  const [query, setQuery] = useState("");
  const selected = new Set(
    value.map((path) => path.trim().replace(/\/+$/g, "")).filter(Boolean),
  );
  const current =
    result?.root === rootFolderId && result.attempt === attempt
      ? result
      : undefined;
  const folders = useMemo(
    () =>
      matchingFolders(current?.folders ?? [], query.trim().toLocaleLowerCase()),
    [current?.folders, query],
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    // This tab configures personal Drive RAG even when a project is selected.
    const params = new URLSearchParams({
      folderId: rootFolderId,
      mount: "drive",
    });
    void fetch(`/api/drive/tree?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as { items?: CachedTreeNode[] };
        if (!Array.isArray(data.items)) throw new Error("Invalid folder tree");
        if (!controller.signal.aborted)
          setResult({
            root: rootFolderId,
            attempt,
            folders: folderChoices(data.items),
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({ root: rootFolderId, attempt, error: true });
      });
    return () => controller.abort();
  }, [open, rootFolderId, attempt]);

  const toggle = (path: string) => {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onChange([...next]);
  };
  const renderFolders = (choices: FolderChoice[]): ReactNode =>
    choices.map((folder) => {
      const isExpanded =
        !!query.trim() ||
        (expanded.get(folder.path) ??
          [...selected].some((path) => path.startsWith(`${folder.path}/`)));
      const inherited = [...selected].some((path) =>
        folder.path.startsWith(`${path}/`),
      );
      return (
        <li key={folder.path}>
          <div className="flex min-w-0 items-center gap-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            {folder.children.length ? (
              <button
                type="button"
                aria-label={`${ja ? "開閉" : "Expand/collapse"}: ${folder.path}`}
                aria-expanded={isExpanded}
                onClick={() =>
                  setExpanded((previous) => {
                    const next = new Map(previous);
                    next.set(folder.path, !isExpanded);
                    return next;
                  })
                }
                className="shrink-0 rounded p-2 focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                {isExpanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </button>
            ) : (
              <span className="w-[30px] shrink-0" />
            )}
            <label
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 pr-2 text-sm"
              title={folder.path}
            >
              <input
                type="checkbox"
                aria-label={folder.path}
                checked={selected.has(folder.path) || inherited}
                disabled={inherited && !selected.has(folder.path)}
                onChange={() => toggle(folder.path)}
                className="shrink-0"
              />
              {isExpanded ? (
                <FolderOpen size={16} className="shrink-0 text-amber-500" />
              ) : (
                <Folder size={16} className="shrink-0 text-amber-500" />
              )}
              <span className="min-w-0 break-all">{folder.name}</span>
              {inherited && (
                <span className="shrink-0 text-xs text-gray-500">
                  {ja ? "親に含む" : "included"}
                </span>
              )}
            </label>
          </div>
          {isExpanded && folder.children.length > 0 && (
            <ul className="ml-3 border-l border-gray-200 pl-1 dark:border-gray-700">
              {renderFolders(folder.children)}
            </ul>
          )}
        </li>
      );
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {ja ? "対象フォルダ" : "Folders"}
        </label>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-picker`}
          onClick={() => setOpen((previous) => !previous)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700"
        >
          <FolderOpen size={14} />
          {ja ? "フォルダから選ぶ" : "Choose folders"}
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>
      <p id={`${id}-hint`} className="text-xs text-gray-500">
        {ja
          ? "1行に1つ指定します。空欄ならすべてのフォルダが対象です。"
          : "One path per line. Leave blank to include all folders."}
      </p>
      <textarea
        id={id}
        aria-describedby={`${id}-hint`}
        rows={3}
        className={inputClass}
        value={value.join("\n")}
        onChange={(event) => onChange(event.target.value.split("\n"))}
      />
      {open && (
        <div
          id={`${id}-picker`}
          className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
        >
          <div className="flex items-center gap-2">
            <input
              type="search"
              aria-label={ja ? "フォルダを絞り込む" : "Filter folders"}
              placeholder={
                ja
                  ? "フォルダ名・パスで絞り込み"
                  : "Filter by folder name or path"
              }
              className={inputClass + " min-w-0 flex-1"}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
            <button
              type="button"
              disabled={!current}
              aria-label={ja ? "フォルダを再読み込み" : "Reload folders"}
              onClick={() => setAttempt((previous) => previous + 1)}
              className="shrink-0 rounded border p-2 disabled:opacity-50"
            >
              <RefreshCw size={16} className={!current ? "animate-spin" : ""} />
            </button>
          </div>
          <p className="text-xs text-gray-500">
            {ja
              ? "チェックすると対象一覧に反映します。サブフォルダも対象です。何も指定しない場合はすべて対象です。"
              : "Check folders to add them above, including their subfolders. Leaving the list empty includes all folders."}
          </p>
          {!current ? (
            <p role="status" className="py-3 text-sm text-gray-500">
              {ja ? "フォルダを読み込み中…" : "Loading folders…"}
            </p>
          ) : current.error ? (
            <p
              role="status"
              className="py-3 text-sm text-amber-700 dark:text-amber-300"
            >
              {ja
                ? "フォルダを取得できませんでした。再読み込みするか、パスを直接入力してください。"
                : "Could not load folders. Reload or enter paths directly."}
            </p>
          ) : folders.length ? (
            <ul
              aria-label={
                ja ? "対象フォルダの候補" : "Available target folders"
              }
              className="max-h-64 overflow-y-auto"
            >
              {renderFolders(folders)}
            </ul>
          ) : (
            <p role="status" className="py-3 text-sm text-gray-500">
              {query.trim()
                ? ja
                  ? "一致するフォルダがありません。"
                  : "No matching folders."
                : ja
                  ? "フォルダがありません。Driveと同期すると表示されます。"
                  : "No folders found. Sync Drive to see folders here."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
