import { z } from "zod";
import type { Route } from "./+types/api.ai-providers.$provider.chat";
import { hasRemoteProviderReference, validateOrigin } from "~/utils/security";
import { COMPATIBLE_PROVIDERS } from "~/types/settings";
import { getSettings } from "~/services/user-settings.server";
import { compatibleHeaders, compatibleSessionId, providerError, requireCompatibleKey, requireCompatibleProvider } from "~/services/compatible-provider.server";

const schema = z.object({
  model: z.string().min(1).max(256), sessionId: z.string().min(1).max(256),
  messages: z.array(z.record(z.string(), z.unknown())).min(1),
  tools: z.array(z.object({ type: z.literal("function"), function: z.object({ name: z.string().max(64), description: z.string().optional(), parameters: z.record(z.string(), z.unknown()) }) })).optional(),
  tool_choice: z.literal("none").optional(),
  reasoning_effort: z.enum(["none", "low", "medium", "high"]).optional(),
  reasoning: z.object({ effort: z.enum(["none", "low", "medium", "high"]), exclude: z.literal(false) }).optional(),
  webSearch: z.boolean().optional(),
});
export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  validateOrigin(request);
  const provider = requireCompatibleProvider(params.provider);
  const { tokens, key } = await requireCompatibleKey(request, provider);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || hasRemoteProviderReference(parsed.data.messages)) return Response.json({ error: "Invalid provider request" }, { status: 400 });
  const settings = await getSettings(tokens.accessToken, tokens.rootFolderId);
  if (!settings.compatibleProviders?.[provider]?.enabledModels.includes(parsed.data.model)) return Response.json({ error: "Enable this model in Settings > AI providers." }, { status: 400 });
  const { sessionId, webSearch, ...body } = parsed.data;
  if (webSearch && provider !== "openrouter") return Response.json({ error: "Use a web search MCP tool with OpenCode Go." }, { status: 400 });
  const response = await fetch(`${COMPATIBLE_PROVIDERS[provider].baseUrl}/chat/completions`, {
    method: "POST", headers: compatibleHeaders(provider, key, compatibleSessionId(tokens.rootFolderId, sessionId)),
    body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true }, ...(webSearch ? { plugins: [{ id: "web" }] } : {}) }), signal: request.signal,
  });
  if (!response.ok) return providerError(response);
  return new Response(response.body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
