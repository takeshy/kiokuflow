import { getRagIndexRevision, listRagTextChunks, searchSimilarChunks, type RagChunk } from "./rag-store.server";
import { createRagKeywordIndex, fuseRagRanks } from "./rag-hybrid";

const MAX_CACHED_INDEXES = 8;
const IDLE_TTL_MS = 10 * 60_000;
const lexicalIndexes = new Map<string, {
  revision: string;
  expiresAt: number;
  index: Promise<ReturnType<typeof createRagKeywordIndex<RagChunk>>>;
}>();

async function getLexicalIndex(orgId: string, projectId: string, settingName: string) {
  // One small document read detects syncs on any server instance. No corpus read
  // or retokenization is needed while this index's revision stays unchanged.
  const revision = await getRagIndexRevision(orgId, projectId, settingName);
  const key = JSON.stringify([orgId, projectId, settingName]);
  const now = Date.now();
  for (const [key, entry] of lexicalIndexes) if (entry.expiresAt <= now) lexicalIndexes.delete(key);
  let entry = lexicalIndexes.get(key);
  if (entry?.revision !== revision) {
    entry = {
      revision, expiresAt: now + IDLE_TTL_MS,
      index: listRagTextChunks(orgId, projectId, settingName).then(createRagKeywordIndex),
    };
  }
  entry.expiresAt = now + IDLE_TTL_MS;
  lexicalIndexes.delete(key);
  lexicalIndexes.set(key, entry);
  while (lexicalIndexes.size > MAX_CACHED_INDEXES) lexicalIndexes.delete(lexicalIndexes.keys().next().value!);
  try { return await entry.index; }
  catch (error) {
    if (lexicalIndexes.get(key) === entry) lexicalIndexes.delete(key);
    throw error;
  }
}

export async function retrieveHybridRagChunks(orgId: string, projectId: string, settingName: string, query: string, vector: number[], limit: number, hybrid = true, accept: (chunk: RagChunk) => boolean = () => true) {
  const [hits, index] = await Promise.all([
    searchSimilarChunks(orgId, projectId, settingName, vector, hybrid ? Math.max(30, limit) : limit),
    hybrid ? getLexicalIndex(orgId, projectId, settingName) : undefined,
  ]);
  const nearest = hits.filter(hit => accept(hit.chunk));
  if (!index) return nearest.map(hit => ({ ...hit.chunk, distance: hit.distance, retrievalScore: 1 - hit.distance, retrievalSource: "vector" as const }));
  const lexical = index.rank(query, Math.max(30, limit), accept).map(hit => hit.candidate);
  return fuseRagRanks(nearest.map(hit => hit.chunk), lexical, limit).map(hit => ({ ...hit, distance: 1 - hit.retrievalScore }));
}
