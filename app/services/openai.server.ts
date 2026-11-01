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


/** Fetch only the account's model catalogue; never start a billed generation. */
export async function discoverOpenAIModels(key: string, signal?: AbortSignal): Promise<import("~/types/settings").OpenAIModelEntry[]> {
  const { isOpenAIChatModel } = await import("~/types/settings");
  const response = await fetch(`${OPENAI_API_URL}/models`, { headers: { Authorization: `Bearer ${key}` }, signal });
  if (!response.ok) throw await openAIError(response);
  const payload = await response.json() as { data?: unknown };
  if (!Array.isArray(payload.data)) throw new Error("OpenAI returned an invalid model catalogue.");
  const entries = payload.data.flatMap((value: unknown) => {
    if (!value || typeof value !== "object") return [];
    const model = value as Record<string, unknown>;
    if (typeof model.id !== "string" || model.id.length > 128 || !isOpenAIChatModel(model.id)) return [];
    if (typeof model.shutdown_date === "string" && Date.parse(model.shutdown_date) <= Date.now()) return [];
    return [{ id: model.id, name: model.id, ...(typeof model.created === "number" && Number.isFinite(model.created) && Math.abs(model.created) < 8.64e12 ? { created: model.created } : {}), ...(typeof model.owned_by === "string" ? { ownedBy: model.owned_by } : {}) }];
  });
  return [...new Map(entries.reverse().map(model => [model.id, model])).values()].sort((a, b) => a.id.localeCompare(b.id));
}
