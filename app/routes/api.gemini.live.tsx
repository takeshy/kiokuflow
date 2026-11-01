import { z } from "zod";
import type { Route } from "./+types/api.gemini.live";
import { requireAuth } from "~/services/session.server";
import { validateOrigin } from "~/utils/security";
import { GEMINI_LIVE_MODELS, GEMINI_LIVE_VOICES, geminiLiveSetup } from "~/services/gemini-live-config";

const schema = z.object({
  model: z.enum(GEMINI_LIVE_MODELS), voice: z.enum(GEMINI_LIVE_VOICES),
  instructions: z.string().max(100_000), language: z.enum(["ja", "en"]),
});
const headers = { "Cache-Control": "no-store" };

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers });
  validateOrigin(request);
  const tokens = await requireAuth(request);
  if (tokens.currentProjectId || !tokens.rootFolderId) return Response.json({ error: "Gemini Live is available on My Drive with your own Gemini API key." }, { status: 403, headers });
  if (!tokens.geminiApiKey) return Response.json({ error: "Register a Gemini API key in Settings > AI providers > Gemini, then unlock it in General.", code: "GEMINI_KEY_LOCKED" }, { status: 401, headers });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid Gemini Live session" }, { status: 400, headers });
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": tokens.geminiApiKey },
      body: JSON.stringify({
        uses: 1, expireTime: new Date(Date.now() + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
        bidiGenerateContentSetup: geminiLiveSetup(parsed.data),
      }), signal: request.signal,
    });
    const body = await response.json().catch(() => null) as { name?: unknown; error?: { message?: string } } | null;
    if (!response.ok) return Response.json({ error: (body?.error?.message || `Gemini Live HTTP ${response.status}`).replaceAll(tokens.geminiApiKey, "[redacted]").slice(0, 1000) }, { status: response.status, headers });
    if (typeof body?.name !== "string" || !/^auth_tokens\/\S{1,8000}$/.test(body.name)) return Response.json({ error: "Gemini returned an invalid Live token" }, { status: 502, headers });
    return Response.json({ token: body.name }, { headers });
  } catch {
    return Response.json({ error: "Could not create a Gemini Live connection. Please try again." }, { status: 502, headers });
  }
}
