import { createHash } from "node:crypto";
import { COMPATIBLE_PROVIDERS, parseCompatibleModel, type CompatibleProvider, type UserSettings } from "~/types/settings";
import { requireAuth } from "./session.server";
import { getSettings } from "./user-settings.server";

export function requireCompatibleProvider(value: unknown): CompatibleProvider {
  if (value !== "openrouter" && value !== "opencodego") throw Response.json({ error: "Unknown AI provider" }, { status: 404 });
  return value;
}

export function compatibleHeaders(provider: CompatibleProvider, key: string, sessionId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`, "Content-Type": "application/json",
    ...(provider === "opencodego" ? { "User-Agent": "gemihub/1.0", "x-opencode-session": sessionId } : { "X-Title": "kiokuflow" }),
  };
}

export async function requireCompatibleKey(request: Request, provider: CompatibleProvider) {
  const tokens = await requireAuth(request);
  if (tokens.currentProjectId || !tokens.rootFolderId || !tokens.accessToken) throw Response.json({ error: "Select My Drive to use this provider." }, { status: 403 });
  const key = tokens.compatibleApiKeys?.[provider];
  if (!key) throw Response.json({ error: `${COMPATIBLE_PROVIDERS[provider].name} key is locked. Unlock it in Settings > General.` }, { status: 401 });
  return { tokens, key };
}

/** `serverCompatible` option for server-side chat calls; loads settings only for compatible models. */
export async function serverCompatibleOptions(model: string, tokens: { accessToken: string; rootFolderId: string }, settings?: UserSettings | null) {
  if (!parseCompatibleModel(model)) return undefined;
  return { rootFolderId: tokens.rootFolderId, providers: (settings ?? await getSettings(tokens.accessToken, tokens.rootFolderId)).compatibleProviders };
}

export function compatibleSessionId(root: string, conversation: string): string {
  return `gemihub-${createHash("sha256").update(`${root}:${conversation}`).digest("hex")}`;
}

export async function providerError(response: Response): Promise<Response> {
  const data = await response.json().catch(() => null);
  return Response.json({ error: typeof data?.error === "string" ? data.error : data?.error?.message || `Provider HTTP ${response.status}` }, { status: response.status, headers: { "Cache-Control": "no-store" } });
}

/** Catalogs can be public, so authenticate independently before accepting a key. */
export async function discoverCompatibleModels(provider: CompatibleProvider, key: string, sessionId: string, signal?: AbortSignal) {
  const base = COMPATIBLE_PROVIDERS[provider].baseUrl;
  const headers = compatibleHeaders(provider, key, sessionId);
  const response = await fetch(`${base}/models`, { headers, signal });
  if (!response.ok) throw await providerError(response);
  const data = await response.json() as { data?: { id?: unknown; name?: unknown; architecture?: { output_modalities?: string[] } }[] };
  const models = (Array.isArray(data.data) ? data.data : []).filter((model) => typeof model.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/.test(model.id) && (!model.architecture?.output_modalities || model.architecture.output_modalities.includes("text"))).map((model) => ({ id: model.id as string, name: typeof model.name === "string" ? model.name : model.id as string }));
  if (!models.length) throw Response.json({ error: "The provider returned no chat models." }, { status: 400 });
  const verification = provider === "openrouter"
    ? await fetch(`${base}/key`, { headers, signal })
    : await fetch(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model: models[0].id, messages: [] }), signal });
  if (!verification.ok && !(provider === "opencodego" && [400, 422].includes(verification.status))) throw await providerError(verification);
  await verification.body?.cancel();
  return models;
}
