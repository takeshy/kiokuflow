import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RagChunk } from "./rag-store.server";

export interface LocalRagScope { orgId: string; projectId: string; settingName: string }
type ChunkMeta = Omit<RagChunk, "embedding">;
interface DocumentFiles { docPath: string; meta: string; vectors: string; count: number; checksum?: string; updatedAt: number }
interface Manifest { version: 1; revision: string; dimension: number; scope: LocalRagScope; documents: Record<string, DocumentFiles> }
interface Loaded { revision: string; meta: ChunkMeta[]; vectors: Float32Array; norms: Float64Array; dimension: number }
const locks = new Map<string, Promise<unknown>>();
const cache = new Map<string, Loaded>();
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const directory = (scope: LocalRagScope) => join(resolve(process.env.LOCAL_RAG_DIR || "data/rag"), hash(JSON.stringify([scope.orgId, scope.projectId, scope.settingName])));
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

async function manifest(scope: LocalRagScope): Promise<Manifest | null> {
  let raw: string;
  try { raw = await readFile(join(directory(scope), "index.json"), "utf8"); }
  catch (error) { if (missing(error)) return null; throw error; }
  const value = JSON.parse(raw) as Manifest;
  if (value.version !== 1 || !value.documents || value.scope.orgId !== scope.orgId || value.scope.projectId !== scope.projectId || value.scope.settingName !== scope.settingName || !Number.isInteger(value.dimension) || value.dimension <= 0) throw new Error("Local RAG index is invalid. Sync this index again.");
  for (const doc of Object.values(value.documents)) {
    if (!/^meta-[a-f0-9-]+\.json$/.test(doc.meta) || !/^vectors-[a-f0-9-]+\.bin$/.test(doc.vectors) || !Number.isInteger(doc.count) || doc.count < 0) throw new Error("Local RAG document manifest is invalid.");
  }
  return value;
}
async function locked<T>(scope: LocalRagScope, action: () => Promise<T>): Promise<T> {
  const key = directory(scope);
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  locks.set(key, next);
  try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
}
async function commit(scope: LocalRagScope, value: Manifest) {
  const dir = directory(scope);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `index-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, join(dir, "index.json"));
    cache.delete(dir);
  } finally { await unlink(temp).catch(() => {}); }
}
async function removeFiles(dir: string, files?: DocumentFiles) {
  if (files) await Promise.all([files.meta, files.vectors].map(name => unlink(join(dir, name)).catch(error => { if (!missing(error)) console.warn("[local-rag] Could not remove retired generation", error.code); })));
}

/** JSON sidecars + Float32 binary vectors, as in Obsidian Local LLM Hub.
 * Immutable per-document generations and one atomic index pointer keep updates
 * bounded and preserve the previous document if writing its replacement fails.
 */
export async function replaceLocalRagDocument(scope: LocalRagScope, docPath: string, chunks: RagChunk[]): Promise<void> {
  if (!chunks.length) { await deleteLocalRagDocument(scope, docPath); return; }
  const dimension = chunks[0].embedding.length;
  if (!dimension || chunks.some(chunk => chunk.docPath !== docPath || chunk.orgId !== scope.orgId || chunk.projectId !== scope.projectId || chunk.settingName !== scope.settingName || chunk.embedding.length !== dimension || chunk.embedding.some(value => !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) || !chunk.embedding.some(value => Math.fround(value) !== 0))) throw new Error("Invalid local RAG document vectors or scope.");
  await locked(scope, async () => {
    const previous = await manifest(scope);
    if (previous && Object.keys(previous.documents).length && previous.dimension !== dimension) throw new Error("Local RAG embedding dimensions changed. Create a new index.");
    const dir = directory(scope), revision = randomUUID(), key = hash(docPath);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const meta = `meta-${revision}.json`, vectors = `vectors-${revision}.bin`;
    const rows = chunks.map(chunk => {
      const row: ChunkMeta = { chunkId: chunk.chunkId, orgId: chunk.orgId, projectId: chunk.projectId, settingName: chunk.settingName, docPath, chunkIndex: chunk.chunkIndex, text: chunk.text, metadata: chunk.metadata, updatedAt: chunk.updatedAt };
      return row;
    });
    const bytes = Buffer.alloc(chunks.length * dimension * 4);
    for (let i = 0; i < chunks.length; i++) for (let j = 0; j < dimension; j++) bytes.writeFloatLE(chunks[i].embedding[j], (i * dimension + j) * 4);
    try {
      const writes = await Promise.allSettled([writeFile(join(dir, meta), JSON.stringify(rows), { mode: 0o600 }), writeFile(join(dir, vectors), bytes, { mode: 0o600 })]);
      for (const write of writes) if (write.status === "rejected") throw write.reason;
      const files: DocumentFiles = { docPath, meta, vectors, count: chunks.length, checksum: chunks[0].metadata.md5Checksum, updatedAt: Math.max(...chunks.map(chunk => chunk.updatedAt)) };
      await commit(scope, { version: 1, revision, dimension, scope, documents: { ...previous?.documents, [key]: files } });
    } catch (error) { await removeFiles(dir, { meta, vectors } as DocumentFiles); throw error; }
    await removeFiles(dir, previous?.documents[key]);
  });
}
export async function deleteLocalRagDocument(scope: LocalRagScope, docPath?: string): Promise<number> {
  return locked(scope, async () => {
    const previous = await manifest(scope);
    if (!previous) return 0;
    const documents = { ...previous.documents };
    const removed = Object.entries(documents).filter(([, doc]) => docPath === undefined || doc.docPath === docPath);
    if (!removed.length) return 0;
    for (const [key] of removed) delete documents[key];
    await commit(scope, { ...previous, documents, revision: randomUUID() });
    await Promise.all(removed.map(([, files]) => removeFiles(directory(scope), files)));
    return removed.reduce((sum, [, doc]) => sum + doc.count, 0);
  });
}
export async function getLocalRagRevision(scope: LocalRagScope): Promise<string> { return (await manifest(scope))?.revision || ""; }
export async function listLocalRagFiles(scope: LocalRagScope) { return Object.values((await manifest(scope))?.documents ?? {}).map(doc => ({ docPath: doc.docPath, chunks: doc.count, updatedAt: doc.updatedAt, checksum: doc.checksum })); }

async function load(scope: LocalRagScope, retry = true): Promise<Loaded> {
  const index = await manifest(scope), dir = directory(scope);
  if (!index) return { revision: "", dimension: 0, meta: [], vectors: new Float32Array(), norms: new Float64Array() };
  const hit = cache.get(dir);
  if (hit?.revision === index.revision) { cache.delete(dir); cache.set(dir, hit); return hit; }
  const meta: ChunkMeta[] = [];
  const total = Object.values(index.documents).reduce((sum, doc) => sum + doc.count, 0);
  const vectors = new Float32Array(total * index.dimension), norms = new Float64Array(total);
  let offset = 0;
  try {
    for (const doc of Object.values(index.documents)) {
      const [json, bytes] = await Promise.all([readFile(join(dir, doc.meta), "utf8"), readFile(join(dir, doc.vectors))]);
      const rows = JSON.parse(json) as ChunkMeta[];
      if (rows.length !== doc.count || bytes.length !== doc.count * index.dimension * 4 || rows.some(row => row.docPath !== doc.docPath || row.orgId !== scope.orgId || row.projectId !== scope.projectId || row.settingName !== scope.settingName)) throw new Error("Local RAG index metadata and vectors do not match.");
      meta.push(...rows);
      for (let i = 0; i < doc.count; i++) {
        let norm = 0;
        for (let j = 0; j < index.dimension; j++) {
          const value = bytes.readFloatLE((i * index.dimension + j) * 4);
          if (!Number.isFinite(value)) throw new Error("Local RAG contains invalid vectors.");
          vectors[(offset + i) * index.dimension + j] = value; norm += value * value;
        }
        norms[offset + i] = Math.sqrt(norm);
      }
      offset += doc.count;
    }
  } catch (error) {
    if (retry && missing(error) && (await manifest(scope))?.revision !== index.revision) return load(scope, false);
    throw error;
  }
  const result = { revision: index.revision, dimension: index.dimension, meta, vectors, norms };
  cache.delete(dir);
  if (vectors.byteLength + norms.byteLength <= MAX_CACHE_BYTES) cache.set(dir, result);
  let bytes = [...cache.values()].reduce((sum, entry) => sum + entry.vectors.byteLength + entry.norms.byteLength, 0);
  while (cache.size > 8 || bytes > MAX_CACHE_BYTES) {
    const key = cache.keys().next().value!;
    const entry = cache.get(key)!; bytes -= entry.vectors.byteLength + entry.norms.byteLength; cache.delete(key);
  }
  return result;
}
export async function listLocalRagTextChunks(scope: LocalRagScope): Promise<RagChunk[]> {
  return (await load(scope)).meta.map(row => ({ ...row, metadata: { ...row.metadata }, embedding: [] }));
}
export async function searchLocalRagChunks(scope: LocalRagScope, query: number[], topK: number): Promise<{ chunk: RagChunk; distance: number }[]> {
  const data = await load(scope);
  if (!data.meta.length) return [];
  if (query.length !== data.dimension || query.some(value => !Number.isFinite(value))) throw new Error("Query embedding does not match this local RAG index.");
  const norm = Math.sqrt(query.reduce((sum, value) => sum + value * value, 0));
  if (!norm) throw new Error("Query embedding is empty.");
  const scores: { index: number; distance: number }[] = [];
  for (let i = 0; i < data.meta.length; i++) {
    let dot = 0;
    for (let j = 0; j < data.dimension; j++) dot += query[j] * data.vectors[i * data.dimension + j];
    if (data.norms[i]) scores.push({ index: i, distance: 1 - Math.max(-1, Math.min(1, dot / (norm * data.norms[i]))) });
    if (i && i % 512 === 0) await new Promise<void>(resolve => setImmediate(resolve));
  }
  return scores.sort((a, b) => a.distance - b.distance || a.index - b.index).slice(0, Math.max(1, Math.min(1000, topK))).map(hit => ({ chunk: { ...data.meta[hit.index], metadata: { ...data.meta[hit.index].metadata }, embedding: [] }, distance: hit.distance }));
}
