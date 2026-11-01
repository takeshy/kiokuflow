import type { FileListItem } from "~/contexts/EditorContext";
import type { RagSetting } from "~/types/settings";
import { getAllCachedFiles, getCachedFile, getCachedRemoteMeta, activeProjectMountKey } from "./indexeddb-cache";
import { getCachedLoaderDataInMemory } from "./loader-data-memory";
import { searchFileNames, searchFileContents } from "./file-search";
import { isEncryptedFile } from "./crypto-core";
import { base64ToBytes } from "~/utils/media-utils";
import { extractOfficeText } from "./office-text";
import type { LiveToolCall } from "./live-tool-definitions";

export interface LiveFileContext {
  rootFolderId: string;
  files: FileListItem[];
  currentFile: { id: string; name: string; content: string | null } | null;
  secretFolder?: string;
}
export interface LiveRagSelection { name: string; setting: RagSetting; topK: number }
const MAX_TEXT = 24_000;
const MAX_BYTES = 20 * 1024 * 1024;

export function isLivePrivatePath(path: string, secretFolder = "Secrets") {
  const name = path.replace(/^\/+/, "");
  const secrets = secretFolder.replace(/^\/+|\/+$/g, "") || "Secrets";
  return name.split("/").some(part => part.startsWith(".") || part === "..")
    || /^(settings\.json|_?encrypted-auth\.json|_sync-meta\.json)$/i.test(name)
    || /\.encrypted$/i.test(name) || name === secrets || name.startsWith(`${secrets}/`);
}
function positive(value: unknown, fallback: number) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("Page and line numbers must be positive integers.");
  return value;
}
function excerpt(text: string, source: string, args: Record<string, unknown> = {}) {
  if (isEncryptedFile(text)) throw new Error("Encrypted files cannot be read in Live.");
  const lines = text.split("\n"), from = positive(args.startLine, 1), to = Math.min(positive(args.endLine, from + 399), lines.length);
  if (from > Math.max(1, lines.length) || to < from) throw new Error("Invalid text line range.");
  const offset = args.startCharacter ?? 0;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid character offset.");
  const selected = lines.slice(from - 1, to).join("\n");
  return { source, content: selected.slice(offset, offset + MAX_TEXT), startLine: from, endLine: to, totalLines: lines.length,
    ...(offset + MAX_TEXT < selected.length ? { truncated: true, nextCharacter: offset + MAX_TEXT } : {}),
    ...(to < lines.length ? { nextLine: to + 1 } : {}) };
}

async function readBytes(fileId: string, signal: AbortSignal) {
  const cached = await getCachedFile(fileId);
  signal.throwIfAborted();
  if (cached?.encoding === "base64") {
    if (cached.content.length > MAX_BYTES * 4 / 3 + 4) throw new Error("File exceeds the 20 MB Live read limit.");
    return base64ToBytes(cached.content);
  }
  const response = await fetch(`/api/drive/files?action=raw&fileId=${encodeURIComponent(fileId)}`, { signal });
  if (!response.ok) throw new Error(`Could not read file (${response.status}).`);
  if (Number(response.headers.get("Content-Length")) > MAX_BYTES) throw new Error("File exceeds the 20 MB Live read limit.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("File exceeds the 20 MB Live read limit.");
  return bytes;
}

/** Read-only, scoped to this Drive tree. No cache writes or file mutations. */
export function createLiveFileToolRunner(getContext: () => LiveFileContext, rag?: LiveRagSelection) {
  return async (call: LiveToolCall, signal: AbortSignal): Promise<unknown> => {
    signal.throwIfAborted();
    const context = getContext();
    const rootFolderId = context.rootFolderId;
    const checkScope = () => {
      signal.throwIfAborted();
      if (activeProjectMountKey() || getContext().rootFolderId !== rootFolderId) throw new Error("Workspace changed. Start a new Live conversation.");
      const root = getCachedLoaderDataInMemory()?.rootFolderId;
      if (typeof root === "string" && root !== rootFolderId) throw new Error("Workspace changed.");
    };
    checkScope();
    const meta = await getCachedRemoteMeta(); checkScope();
    if (meta && meta.rootFolderId !== rootFolderId) throw new Error("Workspace metadata is not ready. Reload the file tree.");
    const files = context.files.filter(file => !isLivePrivatePath(file.path || file.name, context.secretFolder));
    const args = call.args;
    const read = async (file: { id: string; name: string }, preferEditor = true): Promise<unknown> => {
      if (isLivePrivatePath(file.name, context.secretFolder)) throw new Error("Private or encrypted files are unavailable in Live.");
      if (preferEditor && context.currentFile?.id === file.id && context.currentFile.content !== null) return excerpt(context.currentFile.content, file.name, args);
      if (/\.pdf$/i.test(file.name)) {
        const from = positive(args.startPage, 1), requestedTo = positive(args.endPage, from + 7);
        if (requestedTo < from || requestedTo - from >= 16) throw new Error("Read PDFs in ranges of at most 16 pages.");
        const bytes = await readBytes(file.id, signal); checkScope();
        const { extractPdfTextInBrowser } = await import("~/engine/local-handlers/pdfText");
        const pdf = await extractPdfTextInBrowser(bytes, total => {
          if (from > total) throw new Error("The requested PDF page does not exist.");
          return { from, to: Math.min(total, requestedTo) };
        }); checkScope();
        const text = pdf.pages.map(page => `[Page ${page.number}]\n${page.text}`).join("\n\n");
        if (!pdf.pages.some(page => page.text.trim())) throw new Error("This PDF has no text layer. Search its indexed content with RAG or open it in text chat.");
        return { ...excerpt(text, file.name, args), totalPages: pdf.totalPages, startPage: pdf.from, endPage: pdf.to, ...(pdf.to < pdf.totalPages ? { nextPage: pdf.to + 1 } : {}) };
      }
      if (/\.(docx|xlsx|pptx)$/i.test(file.name)) {
        const bytes = await readBytes(file.id, signal); checkScope();
        return excerpt(extractOfficeText(file.name, bytes) || "", file.name, args);
      }
      const mimeType = meta?.files[file.id]?.mimeType || "";
      if (/^(image|audio|video)\//.test(mimeType) || /\.(png|jpe?g|gif|webp|mp[34]|wav|zip|doc|xls)$/i.test(file.name)) throw new Error("Live reads text, text PDFs and DOCX/XLSX/PPTX. Use text chat for this file type.");
      const cached = await getCachedFile(file.id); checkScope();
      if (cached) {
        if (cached.encoding === "base64") throw new Error("This binary format cannot be read in Live.");
        return excerpt(cached.content, file.name, args);
      }
      const response = await fetch(`/api/drive/files?action=read&fileId=${encodeURIComponent(file.id)}`, { signal });
      if (!response.ok) throw new Error(`Could not read file (${response.status}).`);
      const body = await response.json() as { content?: string }; checkScope();
      if (typeof body.content !== "string") throw new Error("The file did not contain readable text.");
      return excerpt(body.content, file.name, args);
    };
    if (call.name === "read_current_file") {
      if (!context.currentFile) return { error: "No file is open in the editor. Ask which file to read, then search/list files." };
      const current = files.find(file => file.id === context.currentFile!.id);
      if (!current) return { error: "The current file is unavailable or private." };
      return read({ id: current.id, name: current.path || current.name });
    }
    if (call.name === "read_drive_file") {
      const file = files.find(file => file.id === args.fileId);
      if (!file) return { error: "File is not in the current workspace or is private. Search/list files first." };
      return read({ id: file.id, name: file.path || file.name });
    }
    if (call.name === "list_drive_files" || call.name === "search_drive_files") {
      if (args.folder !== undefined && typeof args.folder !== "string") throw new Error("Folder must be a path string.");
      const folder = String(args.folder || "").replace(/^\/+|\/+$/g, "");
      const scoped = folder ? files.filter(file => (file.path || file.name).startsWith(`${folder}/`)) : files;
      if (call.name === "list_drive_files") return { files: scoped.slice(0, 80).map(file => ({ id: file.id, name: file.path || file.name })), total: scoped.length, ...(scoped.length > 80 ? { truncated: true, hint: "Search by name or narrow the folder." } : {}) };
      if (typeof args.query !== "string" || !args.query.trim() || args.query.length > 16000) throw new Error("Enter a search query.");
      if (args.searchContent !== undefined && typeof args.searchContent !== "boolean") throw new Error("searchContent must be a boolean.");
      const cached = args.searchContent ? await getAllCachedFiles() : []; checkScope();
      const current = context.currentFile;
      if (args.searchContent && current?.content !== null && current?.content !== undefined && scoped.some(file => file.id === current.id)) {
        const index = cached.findIndex(file => file.fileId === current.id);
        const entry = { fileId: current.id, fileName: current.name, content: current.content, md5Checksum: "", modifiedTime: "", cachedAt: Date.now() };
        if (index >= 0) cached[index] = entry; else cached.push(entry);
      }
      const results = args.searchContent ? searchFileContents(scoped, cached, args.query) : searchFileNames(scoped, args.query);
      return { files: results.slice(0, 50).map(file => ({ id: file.id, name: file.location || file.name, snippet: file.snippet })), total: results.length, scope: args.searchContent ? "cached text only" : "workspace file names" };
    }
    if (call.name === "search_rag") {
      if (!rag?.setting.storeId) return { error: "Choose a synchronized RAG index before starting Live." };
      if (typeof args.query !== "string" || !args.query.trim() || args.query.length > 16000) throw new Error("Enter a RAG query.");
      const response = await fetch("/api/rag/context", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal,
        body: JSON.stringify({ query: args.query, storeIds: [rag.setting.storeId], topK: rag.topK, jevFilter: rag.setting.jevRagFilterEnabled, searchUntilMatch: rag.setting.searchUntilMatch }),
      });
      const result = await response.json() as { error?: string; contexts?: { source: string; text: string }[] }; checkScope();
      if (!response.ok) throw new Error(result.error || "RAG search failed");
      let remaining = MAX_TEXT;
      const contexts = (result.contexts || []).filter(item => !isLivePrivatePath(item.source, context.secretFolder)).slice(0, 20).map(item => {
        const text = item.text.slice(0, Math.min(6000, remaining)); remaining -= text.length; return { source: item.source, text };
      }).filter(item => item.text);
      return { index: rag.name, contexts, scope: "server-indexed content only" };
    }
    return { error: "Live only supports file reading and search." };
  };
}
