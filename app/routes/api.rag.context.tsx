import { z } from "zod";
import type { Route } from "./+types/api.rag.context";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { retrievePersonalRag } from "~/services/rag-index.server";
import { validateOrigin } from "~/utils/security";
const schema = z.object({ query: z.string().trim().min(1).max(16_000), jevFilter: z.boolean().optional(), searchUntilMatch: z.boolean().optional(), storeIds: z.array(z.string().max(4000)).min(1).max(10), topK: z.number().int().min(1).max(20).optional() });
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  validateOrigin(request);
  const tokens = await requireAuth(request);
  if (!tokens.rootFolderId || tokens.currentProjectId) return Response.json({ error: "Select My Drive for personal RAG." }, { status: 403 });
  const { tokens: valid, setCookieHeader } = await getValidTokens(request, tokens);
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid RAG search request" }, { status: 400 });
  const headers = { "Cache-Control": "no-store", ...(setCookieHeader ? { "Set-Cookie": setCookieHeader } : {}) };
  try { return Response.json(await retrievePersonalRag(valid, body.data.storeIds, body.data.query, body.data.topK, { ...body.data, signal: request.signal }), { headers }); }
  catch (error) {
    if (error instanceof Response) return Response.json({ error: await error.text() }, { status: error.status, headers });
    return Response.json({ error: error instanceof Error ? error.message : "RAG search failed" }, { status: 400, headers });
  }
}
