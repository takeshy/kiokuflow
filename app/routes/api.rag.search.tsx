import { z } from "zod";
import { assertRagAccess } from "~/services/rag-access.server";
import type { Route } from "./+types/api.rag.search";
import {
  ProjectAccessError,
  requireProjectAccess,
} from "~/services/project-acl.server";
import { retrieveProjectRag } from "~/services/project-rag-search.server";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import {
  getAdjacentChunks,
  listIndexedFiles,
  type RagChunk,
} from "~/services/rag-store.server";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const searchSchema = z.object({
  projectId: z.string().min(1).max(200),
  query: z.string().trim().min(1).max(16000),
  ragSettingName: z.string().min(1).max(200),
  topK: z.number().int().min(1).max(20).optional(),
  jevFilter: z.boolean().optional(),
  rerankProvider: z.enum(["off", "gemini", "jev"]).optional(),
  hybridSearch: z.boolean().optional(),
  searchUntilMatch: z.boolean().optional(),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function serializeChunk(chunk: RagChunk) {
  return {
    chunkId: chunk.chunkId,
    docPath: chunk.docPath,
    fileName: chunk.metadata.fileName,
    contentType: chunk.metadata.contentType,
    contentKind: chunk.metadata.contentKind ?? "text",
    mimeType: chunk.metadata.mimeType,
    pageLabel: chunk.metadata.pageLabel,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const parsed = searchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid RAG search request" }, 400);
  const { projectId, query, topK, ragSettingName, jevFilter, rerankProvider, hybridSearch, searchUntilMatch } = parsed.data;

  try {
    const ctx = await requireProjectAccess(request, projectId, "viewer", { isMutation: true });
    const { tokens, setCookieHeader } = await getValidTokens(request, await requireAuth(request));
    const result = await retrieveProjectRag(ctx, tokens, ragSettingName, query.trim(), { topK, jevFilter, rerankProvider, hybridSearch, searchUntilMatch, signal: request.signal });
    const response = json({ ...result, results: result.results.map(chunk => ({ ...serializeChunk(chunk), distance: chunk.distance, retrievalScore: chunk.retrievalScore, retrievalSource: chunk.retrievalSource, rerankScore: chunk.rerankScore, rerankSkippedReason: chunk.rerankSkippedReason, jevVerified: chunk.jevVerified })) });
    if (setCookieHeader) response.headers.set("Set-Cookie", setCookieHeader);
    return response;
  } catch (e) {
    if (e instanceof Response) return json({ error: await e.text() }, e.status);
    if (e instanceof ProjectAccessError) {
      return json({ error: e.message }, e.status);
    }
    const message = e instanceof Error ? e.message : "RAG search failed";
    const status = message.includes("index") || message.includes("requires an index") ? 503 : 500;
    return json({ error: message }, status);
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  const ragSettingName = url.searchParams.get("ragSettingName") ?? "";
  const mode = url.searchParams.get("mode") ?? "files";
  if (!projectId) return json({ error: "projectId is required" }, 400);
  if (!ragSettingName) return json({ error: "ragSettingName is required" }, 400);

  try {
    const ctx = await requireProjectAccess(request, projectId, "viewer");
    await assertRagAccess("", ctx.orgId);
    if (mode === "adjacent") {
      const docPath = url.searchParams.get("docPath") ?? "";
      const chunkIndex = Number(url.searchParams.get("chunkIndex"));
      const direction = url.searchParams.get("direction");
      if (!docPath) return json({ error: "docPath is required" }, 400);
      if (!Number.isInteger(chunkIndex)) return json({ error: "chunkIndex is required" }, 400);
      if (direction !== "prev" && direction !== "next") {
        return json({ error: "direction must be prev or next" }, 400);
      }

      const around = await getAdjacentChunks(
        ctx.orgId,
        ctx.projectId,
        ragSettingName,
        docPath,
        chunkIndex,
        direction === "prev" ? 1 : 0,
        direction === "next" ? 1 : 0,
      );
      const chunk = direction === "prev" ? around.before.at(-1) : around.after[0];
      return json({ chunk: chunk ? serializeChunk(chunk) : null });
    }

    const files = await listIndexedFiles(ctx.orgId, ctx.projectId, ragSettingName);
    return json({ files });
  } catch (e) {
    if (e instanceof Response) return json({ error: await e.text() }, e.status);
    if (e instanceof ProjectAccessError) {
      return json({ error: e.message }, e.status);
    }
    return json({ error: e instanceof Error ? e.message : "Failed to list indexed files" }, 500);
  }
}
