import type { Route } from "./+types/api.search";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { searchFiles } from "~/services/google-drive.server";
import { retrievePersonalRag } from "~/services/rag-index.server";
import { z } from "zod";
import { validateOrigin } from "~/utils/security";

const searchSchema = z.object({
  query: z.string().trim().min(1).max(16000),
  mode: z.enum(["rag", "drive"]),
  ragStoreIds: z.array(z.string().max(4000)).max(10).optional(),
  jevFilter: z.boolean().optional(),
  rerankProvider: z.enum(["off", "gemini", "jev"]).optional(),
  hybridSearch: z.boolean().optional(),
  searchUntilMatch: z.boolean().optional(),
  topK: z.number().int().min(1).max(20).optional(),
});

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  validateOrigin(request);

  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(setCookieHeader ? { "Set-Cookie": setCookieHeader } : {}),
  };

  headers["Cache-Control"] = "no-store";
  const parsed = searchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid search request" }, { status: 400, headers });
  if (validTokens.currentProjectId || !validTokens.rootFolderId || !validTokens.accessToken) return Response.json({ error: "Use project search for an organization workspace." }, { status: 403, headers });
  const { query, mode, ragStoreIds, topK } = parsed.data;

  try {
    if (mode === "rag") {
      if (!ragStoreIds?.length) return Response.json({ error: "Choose a RAG index" }, { status: 400, headers });
      const rag = await retrievePersonalRag(validTokens, ragStoreIds, query, topK, { ...parsed.data, signal: request.signal });
      return Response.json({ mode: "rag", warnings: rag.warnings, jevFiltered: rag.jevFiltered, judgedCount: rag.judgedCount, uncheckedCount: rag.uncheckedCount, candidateLimitReached: rag.candidateLimitReached, results: rag.sources.map((title) => ({ title, retrievalScore: Math.max(...rag.contexts.filter(context => context.source === title).map(context => context.retrievalScore ?? 1 - context.distance)), rerankScore: rag.contexts.find(context => context.source === title && context.rerankScore !== undefined)?.rerankScore, rerankSkippedReason: rag.contexts.find(context => context.source === title && context.rerankSkippedReason)?.rerankSkippedReason, retrievalSource: rag.contexts.find(context => context.source === title)?.retrievalSource, jevVerified: rag.jevFiltered ? rag.contexts.filter(context => context.source === title).every(context => context.jevVerified === true) : undefined, snippet: rag.contexts.filter(context => context.source === title).map(context => context.text).join("\n\n") })), aiText: rag.contexts.map((context) => `[${context.source}]\n${context.text}`).join("\n\n") }, { headers });
    }

    if (mode === "drive") {
      const files = await searchFiles(
        validTokens.accessToken,
        validTokens.rootFolderId,
        query,
        true
      );
      const results = files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
      }));
      return new Response(JSON.stringify({ mode: "drive", results }), { headers });
    }

    return new Response(JSON.stringify({ error: "Invalid mode" }), { status: 400, headers });
  } catch (e) {
    if (e instanceof Response) return Response.json({ error: await e.text() }, { status: e.status, headers });
    const message = e instanceof Error ? e.message : "Search failed";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers });
  }
}
