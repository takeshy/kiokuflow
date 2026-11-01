import { createHash } from "node:crypto";
import { requireAuth } from "./session.server";

export const OPENAI_API_URL = "https://api.openai.com/v1";

/** Keys stay in the authenticated, encrypted session; never in browser storage or JSON responses. */
export async function requireOpenAIKey(request: Request) {
  const tokens = await requireAuth(request);
  if (tokens.currentProjectId || !tokens.rootFolderId) {
    throw Response.json({ error: "OpenAI is available on My Drive. Organization projects use Vertex AI." }, { status: 403 });
  }
  if (!tokens.openaiApiKey) {
    throw Response.json({ error: "OpenAI key is locked. Unlock it in Settings > General.", code: "OPENAI_KEY_LOCKED" }, { status: 401 });
  }
  return {
    key: tokens.openaiApiKey,
    safetyId: createHash("sha256").update(tokens.rootFolderId).digest("hex"),
  };
}

export async function openAIError(response: Response): Promise<Response> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return Response.json({ error: body?.error?.message || `OpenAI HTTP ${response.status}` }, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}
