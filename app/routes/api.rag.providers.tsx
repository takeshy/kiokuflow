import { z } from "zod";
import type { Route } from "./+types/api.rag.providers";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import { getSettingsForTenantStrict } from "~/services/user-settings-tenant.server";
import { requireProjectAccess } from "~/services/project-acl.server";
import { describeRagConnections, discoverRagEmbeddingModels } from "~/services/rag-providers.server";
import { resolveRerankConfig, verifyRerankConnection } from "~/services/rag-rerank.server";
import { validateOrigin } from "~/utils/security";

const schema = z.object({ action: z.enum(["verify", "embedding-models"]), provider: z.enum(["gemini", "jev", "openai"]), projectId: z.string().min(1).max(400).optional(), connectionId: z.string().length(64).optional() });
const noStore = { "Cache-Control": "no-store" };

async function context(request: Request, projectId?: string) {
  const { tokens, setCookieHeader } = await getValidTokens(request, await requireAuth(request));
  // Match project retrieval: personal credentials when linked, otherwise the project's settings.
  const project = projectId ? await requireProjectAccess(request, projectId, "viewer", { isMutation: request.method !== "GET" }) : null;
  const settings = tokens.accessToken && tokens.rootFolderId ? await getSettings(tokens.accessToken, tokens.rootFolderId)
    : project ? await getSettingsForTenantStrict(project) : null;
  if (!settings) throw Response.json({ error: "Select a workspace to configure RAG connections." }, { status: 403, headers: noStore });
  return { tokens, settings, connections: describeRagConnections(settings, tokens), headers: { ...noStore, ...(setCookieHeader ? { "Set-Cookie": setCookieHeader } : {}) } };
}

export async function loader({ request }: Route.LoaderArgs) {
  const ctx = await context(request, new URL(request.url).searchParams.get("projectId") || undefined);
  return Response.json(ctx.connections, { headers: ctx.headers });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  validateOrigin(request);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.action === "verify" ? parsed.data.provider === "openai" : parsed.data.provider === "jev")) return Response.json({ error: "Invalid RAG provider request" }, { status: 400, headers: noStore });
  const { action, provider, projectId, connectionId } = parsed.data;
  const ctx = await context(request, projectId);
  const connection = action === "verify" ? ctx.connections.reranking[provider as "gemini" | "jev"] : ctx.connections.embedding[provider as "gemini" | "openai"];
  if (connectionId && connectionId !== connection.id) return Response.json({ error: "Connection changed. Refresh its status and try again." }, { status: 409, headers: ctx.headers });
  if (connection.state !== "ready") return Response.json({ connection, error: connection.state === "locked" ? "Unlock this key in Settings > General." : "Configure this key in Settings > AI providers." }, { status: 401, headers: ctx.headers });
  try {
    if (action === "embedding-models") {
      const embeddingProvider = provider as "gemini" | "openai";
      const models = await discoverRagEmbeddingModels(embeddingProvider, (embeddingProvider === "gemini" ? ctx.tokens.geminiApiKey : ctx.tokens.openaiApiKey)!, AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]));
      return Response.json({ models, connectionId: connection.id }, { headers: ctx.headers });
    }
    const config = resolveRerankConfig(provider as "gemini" | "jev", ctx.settings, ctx.tokens);
    if (!config) return Response.json({ error: "The selected reranking connection is unavailable." }, { status: 401, headers: ctx.headers });
    await verifyRerankConnection(config, request.signal);
    return Response.json({ ok: true, connectionId: connection.id }, { headers: ctx.headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "RAG connection request failed" }, { status: 502, headers: ctx.headers });
  }
}
