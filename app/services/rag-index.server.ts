import { extractOfficeText } from "./office-text";
export { extractOfficeText } from "./office-text";
import { resolveRerankConfig, searchAndRerankRag, type RerankMetadata } from "./rag-rerank.server";
import { retrieveHybridRagChunks } from "./rag-hybrid.server";
import { resolveRagMedia } from "./rag-jev-media.server";
import { resolveRagTopK, resolveRerankProvider, type RagSearchOverrides } from "./rag-search-options";
import type { SessionTokens } from "./session.server";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { FieldValue } from "@google-cloud/firestore";
import { getFirestore } from "./firestore.server";
import { isLocalRuntime } from "./app-runtime.server";
import { listLocalRagFiles, replaceLocalRagDocument } from "./rag-local-store.server";
import { assertRagAccess } from "./rag-access.server";
import { embeddingConfig, RAG_EMBEDDING_MODEL, type EmbeddingProvider } from "./rag-config";
import { embedRagInputs, VECTOR_DIMENSIONS } from "./rag-provider-embeddings.server";
import { getFileListFromMeta } from "./sync-meta.server";
import { readFileBytes } from "./google-drive.server";
import { getSettings } from "./user-settings.server";
import { extractPdfTextOnServer } from "./pdf-text.server";
import { deleteChunksByDocPath, deleteChunksBySetting, markRagIndexChanged } from "./rag-store.server";
import type { RagEmbeddingInput } from "./rag-embeddings.server";
import type { RagSetting, RagFileInfo } from "~/types/settings";
import { isRagEligible } from "~/constants/rag";

export { RAG_EMBEDDING_MODEL };
export { isRagEligible } from "~/constants/rag";
const ORG_ID = "personal-rag-v1";
const hash = (input: string) => createHash("sha256").update(input).digest("hex");
interface IndexHandle { owner: string; index: string; provider: EmbeddingProvider; model: string; chunkSize: number; chunkOverlap: number; backend?: "local" }
interface Options { rootFolderId?: string; signal?: AbortSignal; setting?: RagSetting; secretManagerFolder?: string }
export interface SyncResult {
  uploaded: string[]; skipped: string[]; deleted: string[]; errors: { path: string; error: string }[];
  newFiles: Record<string, RagFileInfo>; lastFullSync: number;
}
function encode(handle: IndexHandle) { return `ragv1:${Buffer.from(JSON.stringify(handle)).toString("base64url")}`; }
function parse(handle: string, rootFolderId?: string, checkBackend = true): IndexHandle {
  if (!rootFolderId || !handle.startsWith("ragv1:")) throw new Error("Re-index this RAG setting to migrate from File Search.");
  const value = JSON.parse(Buffer.from(handle.slice(6), "base64url").toString()) as IndexHandle;
  if (value.owner !== hash(rootFolderId)) throw new Error("RAG index belongs to a different workspace");
  const config = embeddingConfig({ embeddingProvider: value.provider, embeddingModel: value.model });
  if (config.provider !== value.provider || config.model !== value.model || !/^[a-f0-9]{64}$/.test(value.index)) throw new Error("Invalid RAG index");
  if (checkBackend && (value.backend === "local") !== isLocalRuntime()) throw new Error("RAG storage changed. Sync this index again in Settings.");
  return value;
}
export function isCurrentRagIndex(setting: RagSetting, rootFolderId: string, name?: string) {
  try {
    const handle = parse(setting.storeName || "", rootFolderId);
    const config = embeddingConfig(setting);
    return handle.provider === config.provider && handle.model === config.model
      && handle.chunkSize === (setting.chunkSize || 1500) && handle.chunkOverlap === (setting.chunkOverlap ?? 150)
      && (!name || handle.index === hash(`${name}\0${JSON.stringify({ ...config, chunkSize: setting.chunkSize || 1500, chunkOverlap: setting.chunkOverlap ?? 150 })}`));
  } catch { return false; }
}
export async function getOrCreateStore(_apiKey: string, name: string, options: Options = {}): Promise<string> {
  if (!options.rootFolderId) throw new Error("RAG workspace is required");
  await assertRagAccess(options.rootFolderId);
  return ragIndexId(options.rootFolderId, name, options.setting || {});
}
export function ragIndexId(rootFolderId: string, name: string, setting: Partial<RagSetting>): string {
  const config = embeddingConfig(setting);
  const chunkSize = Math.max(100, Math.min(5000, setting.chunkSize || 1500));
  const chunkOverlap = Math.max(0, Math.min(chunkSize - 1, setting.chunkOverlap ?? 150));
  return encode({ owner: hash(rootFolderId), index: hash(`${name}\0${JSON.stringify({ ...config, chunkSize, chunkOverlap })}`), ...config, chunkSize, chunkOverlap, ...(isLocalRuntime() ? { backend: "local" as const } : {}) });
}
export async function calculateChecksum(content: string | Uint8Array | ArrayBuffer): Promise<string> {
  return createHash("sha256").update(typeof content === "string" ? content : Buffer.from(content instanceof Uint8Array ? content : new Uint8Array(content))).digest("hex");
}
export function isPrivateRagPath(path: string, secretFolder = "Secrets"): boolean {
  secretFolder = secretFolder.trim().replace(/^\/+|\/+$/g, "") || "Secrets";
  const name = path.replace(/^\/+/, "");
  return name.split("/").some((part) => part.startsWith(".") || part === "..")
    || /^(settings\.json|_?encrypted-auth\.json|_sync-meta\.json)$/i.test(name)
    || /\.encrypted$/i.test(name)
    || name === secretFolder || name.startsWith(`${secretFolder}/`);
}
export function splitRagText(text: string, size: number, overlap: number): string[] {
  if (!text.trim()) return [];
  size = Math.max(100, Math.min(5000, Math.trunc(size) || 1500));
  overlap = Math.max(0, Math.min(size - 1, Math.trunc(overlap) || 0));
  const result: string[] = [];
  for (let position = 0; position < text.length;) {
    let end = Math.min(position + size, text.length);
    while (new TextEncoder().encode(text.slice(position, end)).byteLength > 7000) end = position + Math.floor((end - position) / 2);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    result.push(text.slice(position, end));
    if (result.length > 400) throw new Error("RAG file has too many chunks. Increase chunk size or reduce overlap.");
    if (end >= text.length) break;
    position = end - Math.min(overlap, end - position - 1);
  }
  return result;
}

async function prepare(path: string, bytes: Uint8Array, handle: IndexHandle): Promise<{ text: string; input: RagEmbeddingInput }[]> {
  if (/\.(png|jpe?g)$/i.test(path)) {
    if (handle.provider === "openai" || handle.model === "gemini-embedding-001") throw new Error("This embedding model supports text only. Choose Gemini Embedding 2 for images.");
    const mimeType = /\.png$/i.test(path) ? "image/png" : "image/jpeg";
    return [{ text: `[Image: ${path}] Use read_drive_file to inspect this matched image.`, input: { inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } } }];
  }
  let text: string;
  if (/\.pdf$/i.test(path)) {
    const pdf = await extractPdfTextOnServer(bytes, (totalPages) => ({ from: 1, to: totalPages }));
    text = pdf.pages.map((page) => `[Page ${page.number}]\n${page.text}`).join("\n\n");
    if (!pdf.pages.some((page) => page.text.trim())) {
      if (handle.provider === "openai" || handle.model === "gemini-embedding-001") throw new Error("This PDF has no text layer. Choose Gemini Embedding 2 for scanned PDFs.");
      const book = await PDFDocument.load(bytes);
      const chunks: { text: string; input: RagEmbeddingInput }[] = [];
      for (let page = 0; page < book.getPageCount(); page += 6) {
        const excerpt = await PDFDocument.create();
        const last = Math.min(page + 6, book.getPageCount());
        for (const copied of await excerpt.copyPages(book, Array.from({ length: last - page }, (_, i) => page + i))) excerpt.addPage(copied);
        chunks.push({ text: `[PDF: ${path}, pages ${page + 1}-${last}] Use read_drive_file for these pages.`, input: { inlineData: { mimeType: "application/pdf", data: Buffer.from(await excerpt.save()).toString("base64") } } });
      }
      return chunks;
    }
  } else text = extractOfficeText(path, bytes) ?? new TextDecoder().decode(bytes);
  return splitRagText(text, handle.chunkSize, handle.chunkOverlap).map((text) => ({ text, input: text }));
}
const indexOps = { assertRagAccess, embedRagInputs, getFirestore };
// Firestore caps a commit at 500 writes and 10 MiB; stay well below both.
const MAX_BATCH_OPS = 400;
const MAX_BATCH_BYTES = 4 * 1024 * 1024;
export async function registerSingleFile(apiKey: string, storeName: string, fileName: string, content: string | Uint8Array | ArrayBuffer, _existingFileId: string | null, options: Options = {}, ops = indexOps): Promise<{ checksum: string; fileId: string }> {
  const handle = parse(storeName, options.rootFolderId);
  await ops.assertRagAccess(options.rootFolderId!);
  if (isPrivateRagPath(fileName, options.secretManagerFolder) || !isRagEligible(fileName)) throw new Error("File is not eligible for RAG");
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content instanceof Uint8Array ? content : new Uint8Array(content);
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("RAG file exceeds 20 MB");
  const checksum = await calculateChecksum(bytes);
  const chunks = await prepare(fileName, bytes, handle);
  if (!chunks.length || chunks.length > 400) throw new Error("RAG file is empty or has too many chunks (maximum 400)");
  const vectors = await ops.embedRagInputs(chunks.map((chunk) => chunk.input), { apiKey, provider: handle.provider, model: handle.model, signal: options.signal });
  options.signal?.throwIfAborted();
  if (isLocalRuntime()) {
    await replaceLocalRagDocument({ orgId: ORG_ID, projectId: handle.owner, settingName: handle.index }, fileName, chunks.map((chunk, i) => ({
      chunkId: hash(`${handle.owner}\0${handle.index}\0${fileName}\0${checksum}\0${i}`), orgId: ORG_ID, projectId: handle.owner, settingName: handle.index,
      docPath: fileName, chunkIndex: i, text: chunk.text, embedding: vectors[i],
      metadata: { fileName, contentType: "text/plain", md5Checksum: checksum, embeddingProvider: handle.provider, embeddingModel: handle.model }, updatedAt: Date.now(),
    })));
    return { checksum, fileId: `${storeName}/doc/${Buffer.from(fileName).toString("base64url")}` };
  }
  const db = ops.getFirestore();
  const collection = db.collection("ragChunks");
  // Embedding happens before any write, so an embedding failure leaves the previous
  // document intact. A large file can exceed Firestore's per-commit size limit, so
  // new chunks go out in size-bounded batches under checksum-specific ids, and the
  // previous version is removed only after every new chunk is stored.
  const ids = new Set<string>();
  let batch = db.batch(); let pending = 0; let pendingBytes = 0;
  const flush = async () => {
    if (pending) {
      markRagIndexChanged(batch, ORG_ID, handle.owner, handle.index, db);
      await batch.commit();
    }
    batch = db.batch(); pending = 0; pendingBytes = 0;
  };
  for (let i = 0; i < chunks.length; i++) {
    const id = hash(`${handle.owner}\0${handle.index}\0${fileName}\0${checksum}\0${i}`); ids.add(id);
    const size = VECTOR_DIMENSIONS * 8 + Buffer.byteLength(chunks[i].text) + 1024;
    if (pending >= MAX_BATCH_OPS || pendingBytes + size > MAX_BATCH_BYTES) await flush();
    batch.set(collection.doc(id), { orgId: ORG_ID, projectId: handle.owner, settingName: handle.index, docPath: fileName, chunkIndex: i, text: chunks[i].text, embedding: FieldValue.vector(vectors[i]), metadata: { fileName, contentType: "text/plain", md5Checksum: checksum, embeddingProvider: handle.provider, embeddingModel: handle.model }, updatedAt: FieldValue.serverTimestamp() });
    pending++; pendingBytes += size;
  }
  await flush();
  const old = await collection.where("orgId", "==", ORG_ID).where("projectId", "==", handle.owner).where("settingName", "==", handle.index).where("docPath", "==", fileName).get();
  for (const doc of old.docs) {
    if (ids.has(doc.id)) continue;
    if (pending >= MAX_BATCH_OPS) await flush();
    batch.delete(doc.ref); pending++;
  }
  await flush();
  return { checksum, fileId: `${storeName}/doc/${Buffer.from(fileName).toString("base64url")}` };
}
export async function deleteSingleFileFromRag(_apiKey: string, documentId: string, options: Options = {}): Promise<boolean> {
  // Legacy remote stores are left untouched; only workspace-owned Firestore data is removed.
  if (!documentId.startsWith("ragv1:")) return true;
  const [storeName, encodedPath] = documentId.split("/doc/");
  const handle = parse(storeName, options.rootFolderId, false);
  if ((handle.backend === "local") !== isLocalRuntime()) return true;
  if (!encodedPath) throw new Error("Invalid RAG document");
  await deleteChunksByDocPath(ORG_ID, handle.owner, handle.index, Buffer.from(encodedPath, "base64url").toString());
  return true;
}
export async function deleteStore(storeName: string, rootFolderId: string): Promise<void> {
  if (!storeName.startsWith("ragv1:")) return;
  const handle = parse(storeName, rootFolderId, false);
  if ((handle.backend === "local") !== isLocalRuntime()) return;
  await deleteChunksBySetting(ORG_ID, handle.owner, handle.index);
}
export async function uploadDriveFile(apiKey: string, accessToken: string, fileId: string, fileName: string, storeName: string, options: Options = {}): Promise<string> {
  return (await registerSingleFile(apiKey, storeName, fileName, await readFileBytes(accessToken, fileId), null, options)).fileId;
}
export async function smartSync(apiKey: string, accessToken: string, setting: RagSetting, rootFolderId: string, onProgress?: (current: number, total: number, fileName: string, action: "upload" | "skip" | "delete") => void, options: Options = {}): Promise<SyncResult> {
  const handle = parse(setting.storeName || "", rootFolderId);
  await assertRagAccess(rootFolderId);
  const { files } = await getFileListFromMeta(accessToken, rootFolderId);
  const settings = await getSettings(accessToken, rootFolderId);
  const current = files.filter((file) => !isPrivateRagPath(file.name, settings.secretManagerFolder) && isRagEligible(file.name)
    && (!(setting.targetFolders || []).length || (setting.targetFolders || []).some((prefix) => file.name === prefix || file.name.startsWith(`${prefix.replace(/\/$/, "")}/`)))
    && !(setting.excludePatterns || []).some((pattern) => new RegExp(pattern).test(file.name)));
  const result: SyncResult = { uploaded: [], skipped: [], deleted: [], errors: [], newFiles: { ...setting.files }, lastFullSync: Date.now() };
  const localFiles = isLocalRuntime() ? new Map((await listLocalRagFiles({ orgId: ORG_ID, projectId: handle.owner, settingName: handle.index })).map(file => [file.docPath, file.checksum])) : undefined;
  let count = 0;
  for (const file of current) {
    options.signal?.throwIfAborted();
    try {
      const bytes = await readFileBytes(accessToken, file.id);
      const checksum = await calculateChecksum(bytes);
      if (setting.files[file.name]?.checksum === checksum && setting.files[file.name]?.status === "registered" && (!localFiles || localFiles.get(file.name) === checksum)) { result.skipped.push(file.name); onProgress?.(++count, current.length, file.name, "skip"); continue; }
      const registered = await registerSingleFile(apiKey, setting.storeName!, file.name, bytes, null, { ...options, rootFolderId, secretManagerFolder: settings.secretManagerFolder });
      result.newFiles[file.name] = { ...registered, uploadedAt: Date.now(), status: "registered" };
      result.uploaded.push(file.name); onProgress?.(++count, current.length, file.name, "upload");
    } catch (error) {
      options.signal?.throwIfAborted();
      result.errors.push({ path: file.name, error: error instanceof Error ? error.message : String(error) });
      result.newFiles[file.name] = { checksum: "", uploadedAt: Date.now(), fileId: setting.files[file.name]?.fileId || null, status: "pending" };
    }
  }
  const { listSyncedDocPaths } = await import("./rag-store.server");
  const indexedPaths = await listSyncedDocPaths(ORG_ID, handle.owner, handle.index);
  for (const path of new Set([...Object.keys(setting.files), ...indexedPaths])) {
    if (current.some((file) => file.name === path)) continue;
    await deleteChunksByDocPath(ORG_ID, handle.owner, handle.index, path);
    delete result.newFiles[path]; result.deleted.push(path); onProgress?.(count, current.length, path, "delete");
  }
  if (!result.errors.length) {
    for (const old of setting.retiredIndexes || []) {
      if (old !== setting.storeName) await deleteStore(old, rootFolderId);
    }
    setting.retiredIndexes = [];
  }
  return result;
}
/** Chat-route wrapper: skips empty queries and turns failures into a message the client can show. */
export async function retrievePersonalRagForChat(tokens: Parameters<typeof retrievePersonalRag>[0], storeIds: string[] | undefined, messages: { role: string; content?: string }[], topK: number | undefined, signal?: AbortSignal) {
  const query = [...messages].reverse().find((message) => message.role === "user")?.content?.trim();
  if (!storeIds?.length || !query) return { rag: null };
  try { return { rag: await retrievePersonalRag(tokens, storeIds, query, topK, { signal }) }; }
  catch (error) {
    signal?.throwIfAborted();
    return { rag: null, error: error instanceof Response ? await error.text() : error instanceof Error ? error.message : "RAG retrieval failed" };
  }
}
export async function retrievePersonalRag(tokens: Pick<SessionTokens, "rootFolderId" | "accessToken" | "geminiApiKey" | "openaiApiKey" | "jevApiKey" | "compatibleApiKeys">, storeIds: string[], query: string, topK?: number, overrides: RagSearchOverrides = {}) {
  await assertRagAccess(tokens.rootFolderId);
  const settings = await getSettings(tokens.accessToken, tokens.rootFolderId);
  const hits: ({ source: string; text: string; distance: number; retrievalScore?: number; retrievalSource?: string; jevVerified?: boolean } & RerankMetadata)[] = [];
  const warnings: string[] = [];
  let candidateLimitReached = false;
  let uncheckedCount = 0;
  let judgedCount = 0;
  let jevFiltered = false;
  let files: ReturnType<typeof getFileListFromMeta> | undefined;
  const signal = overrides.signal;
  for (const id of [...new Set(storeIds)].slice(0, 10)) {
    signal?.throwIfAborted();
    const setting = Object.values(settings.ragSettings).find((setting) => setting.storeId === id || setting.storeName === id);
    if (!setting || !isCurrentRagIndex(setting, tokens.rootFolderId)) throw new Error("RAG setting changed or uses legacy File Search. Re-index it in Settings.");
    const handle = parse(id, tokens.rootFolderId);
    if (isLocalRuntime() && Object.values(setting.files).some(file => file.status === "registered") && !(await listLocalRagFiles({ orgId: ORG_ID, projectId: handle.owner, settingName: handle.index })).length) throw new Error("This server has no local RAG data for the selected index. Sync it again in Settings.");
    const apiKey = handle.provider === "openai" ? tokens.openaiApiKey : tokens.geminiApiKey;
    if (!apiKey) throw new Error(`Unlock the ${handle.provider} API key to search this RAG index.`);
    const provider = overrides.jevFilter === false ? "off" : overrides.rerankProvider ?? resolveRerankProvider(setting);
    const config = resolveRerankConfig(provider, settings, tokens);
    const limit = resolveRagTopK({ topK: overrides.topK ?? topK ?? setting.topK }, settings.ragTopK);
    // Embedding once, regardless of how many candidate batches the reranker evaluates.
    const [vector] = await embedRagInputs([query], { apiKey, provider: handle.provider, model: handle.model, query: true, signal });
    const result = await searchAndRerankRag({ query, provider, topK: limit, untilMatch: overrides.searchUntilMatch ?? setting.searchUntilMatch ?? false, config, signal,
      search: async (count) => retrieveHybridRagChunks(ORG_ID, handle.owner, handle.index, query, vector, count, overrides.hybridSearch ?? setting.hybridSearch ?? true, candidate => !isPrivateRagPath(candidate.docPath, settings.secretManagerFolder)),
      accept: candidate => !isPrivateRagPath(candidate.docPath, settings.secretManagerFolder),
      resolveContent: async (candidate) => resolveRagMedia(candidate, async () => {
        files ??= getFileListFromMeta(tokens.accessToken, tokens.rootFolderId);
        const file = (await files).files.find(file => file.name === candidate.docPath);
        if (!file) throw new Error("Indexed media is no longer in this workspace.");
        return readFileBytes(tokens.accessToken, file.id);
      }, signal),
    });
    candidateLimitReached ||= result.candidateLimitReached;
    uncheckedCount += result.uncheckedIds.length; judgedCount += result.judgedCount; jevFiltered ||= result.jevFiltered;
    warnings.push(...result.warnings);
    for (const hit of result.results) hits.push({ source: hit.docPath, text: hit.text, distance: hit.distance, retrievalScore: hit.retrievalScore, retrievalSource: hit.retrievalSource, rerankScore: hit.rerankScore, rerankSkippedReason: hit.rerankSkippedReason, ...(result.jevFiltered ? { jevVerified: !result.uncheckedIds.includes(hit.chunkId) } : {}) });
  }
  // Per-index ranking includes protected media positions; do not undo it with a
  // global vector-distance sort after reranking.
  return { sources: [...new Set(hits.map(hit => hit.source))], contexts: hits, warnings, jevFiltered, judgedCount, uncheckedCount, candidateLimitReached };
}
