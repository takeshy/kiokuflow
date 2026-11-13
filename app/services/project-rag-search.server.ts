import type { ProjectAccessContext } from "~/types/enterprise";
import type { SessionTokens } from "./session.server";
import { assertRagAccess } from "./rag-access.server";
import { getSettingsForTenantStrict } from "./user-settings-tenant.server";
import { getSettings } from "./user-settings.server";
import { generateEmbedding } from "./rag-embeddings.server";
import { retrieveHybridRagChunks } from "./rag-hybrid.server";
import { resolveRerankConfig, searchAndRerankRag } from "./rag-rerank.server";
import { resolveRagTopK, resolveRerankProvider, type RagSearchOverrides } from "./rag-search-options";
import { resolveRagMedia } from "./rag-jev-media.server";
import { readObject } from "./gcs-storage.server";

export async function retrieveProjectRag(ctx: ProjectAccessContext, tokens: SessionTokens, settingName: string, query: string, options: RagSearchOverrides = {}) {
  await assertRagAccess("", ctx.orgId);
  options.signal?.throwIfAborted();
  const settings = await getSettingsForTenantStrict(ctx);
  const setting = settings.ragSettings[settingName];
  if (!setting) throw new Response("Unknown RAG setting", { status: 400 });
  const credentials = tokens.accessToken && tokens.rootFolderId ? await getSettings(tokens.accessToken, tokens.rootFolderId) : settings;
  const provider = options.jevFilter === false ? "off" : options.rerankProvider ?? resolveRerankProvider(setting);
  const config = resolveRerankConfig(provider, credentials, tokens);
  const embedding = await generateEmbedding(query, ctx.tenant, { taskType: "RETRIEVAL_QUERY" });
  options.signal?.throwIfAborted();
  const result = await searchAndRerankRag({ query, provider, topK: resolveRagTopK({ topK: options.topK ?? setting.topK }, settings.ragTopK), config, untilMatch: options.searchUntilMatch ?? setting.searchUntilMatch ?? false, signal: options.signal,
    search: async count => embedding ? retrieveHybridRagChunks(ctx.orgId, ctx.projectId, settingName, query, embedding, count, options.hybridSearch ?? setting.hybridSearch ?? true) : [],
    resolveContent: candidate => resolveRagMedia(candidate, async () => (await readObject(ctx, candidate.docPath)).bytes, options.signal),
  });
  return { ...result, uncheckedCount: result.uncheckedIds.length, results: result.results.map(chunk => ({ ...chunk, ...(result.jevFiltered ? { jevVerified: !result.uncheckedIds.includes(chunk.chunkId) } : {}) })) };
}
