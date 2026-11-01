import type { ProjectAccessContext } from "~/types/enterprise";
import type { SessionTokens } from "./session.server";
import { assertRagAccess } from "./rag-access.server";
import { getSettingsForTenantStrict } from "./user-settings-tenant.server";
import { getSettings } from "./user-settings.server";
import { generateEmbedding } from "./rag-embeddings.server";
import { searchSimilarChunks } from "./rag-store.server";
import { getJevConfig, searchAndJudgeRag } from "./jev-rag.server";
import { resolveRagTopK, type RagSearchOverrides } from "./rag-search-options";
import { resolveRagMedia } from "./rag-jev-media.server";
import { readObject } from "./gcs-storage.server";

export async function retrieveProjectRag(ctx: ProjectAccessContext, tokens: SessionTokens, settingName: string, query: string, options: RagSearchOverrides = {}) {
  await assertRagAccess("", ctx.orgId);
  options.signal?.throwIfAborted();
  const settings = await getSettingsForTenantStrict(ctx);
  const setting = settings.ragSettings[settingName];
  if (!setting) throw new Response("Unknown RAG setting", { status: 400 });
  const credentials = tokens.accessToken && tokens.rootFolderId ? await getSettings(tokens.accessToken, tokens.rootFolderId) : settings;
  const config = (options.jevFilter ?? setting.jevRagFilterEnabled ?? true) ? getJevConfig(credentials, tokens) : null;
  const embedding = await generateEmbedding(query, ctx.tenant, { taskType: "RETRIEVAL_QUERY" });
  options.signal?.throwIfAborted();
  const result = await searchAndJudgeRag({ query, topK: resolveRagTopK({ topK: options.topK ?? setting.topK }, settings.ragTopK), config, untilMatch: options.searchUntilMatch ?? setting.searchUntilMatch ?? false, signal: options.signal,
    search: async count => embedding ? (await searchSimilarChunks(ctx.orgId, ctx.projectId, settingName, embedding, count)).map(hit => ({ ...hit.chunk, distance: hit.distance })) : [],
    resolveContent: candidate => resolveRagMedia(candidate, async () => (await readObject(ctx, candidate.docPath)).bytes, options.signal),
  });
  return { ...result, uncheckedCount: result.uncheckedIds.length, results: result.results.map(chunk => ({ ...chunk, ...(result.jevFiltered ? { jevVerified: !result.uncheckedIds.includes(chunk.chunkId) } : {}) })) };
}
