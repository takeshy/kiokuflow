import { z } from "zod";
import type { Route } from "./+types/api.openai.responses";
import { hasRemoteProviderReference, validateOrigin } from "~/utils/security";
import { isOpenAIModel } from "~/types/settings";
import { OPENAI_API_URL, requireOpenAIKey, openAIError } from "~/services/openai.server";

// Only expose text/tool responses. Client-supplied URLs, credentials, remote
// MCP servers, background tasks and persistence are never forwarded.
const schema = z.object({
  model: z.string().max(128).refine(isOpenAIModel),
  input: z.array(z.record(z.string(), z.unknown())).min(1),
  instructions: z.string().optional(),
  tools: z.array(z.union([
    z.object({ type: z.literal("function"), name: z.string(), description: z.string().optional(), parameters: z.record(z.string(), z.unknown()), strict: z.literal(false) }),
    z.object({ type: z.literal("web_search") }),
  ])).optional(),
  reasoning: z.object({ effort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]), summary: z.literal("auto") }).optional(),
  tool_choice: z.literal("none").optional(),
});

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  validateOrigin(request);
  const { key, safetyId } = await requireOpenAIKey(request);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || hasRemoteProviderReference(parsed.data.input)) return Response.json({ error: "Invalid OpenAI request" }, { status: 400 });
  const response = await fetch(`${OPENAI_API_URL}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...parsed.data, stream: true, store: false, include: ["reasoning.encrypted_content"], safety_identifier: safetyId }),
    signal: request.signal,
  });
  if (!response.ok) return openAIError(response);
  return new Response(response.body, { headers: {
    "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no",
  } });
}
