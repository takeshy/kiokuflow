import { z } from "zod";
import type { Route } from "./+types/api.openai.live";
import { validateOrigin } from "~/utils/security";
import { OPENAI_API_URL, requireOpenAIKey, openAIError } from "~/services/openai.server";

const schema = z.object({
  sdp: z.string().min(1).max(100_000),
  model: z.enum(["gpt-realtime-2.1", "gpt-realtime-2.1-mini", "gpt-realtime", "gpt-realtime-mini"]),
  voice: z.enum(["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"]),
  instructions: z.string().max(100_000).optional(),
  language: z.enum(["ja", "en"]),
});

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  validateOrigin(request);
  const { key, safetyId } = await requireOpenAIKey(request);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid Live session" }, { status: 400 });
  const { sdp, model, voice, instructions, language } = parsed.data;
  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", JSON.stringify({
    type: "realtime", model,
    instructions: instructions || "You are a helpful voice assistant. Converse naturally with the user.",
    audio: {
      input: { transcription: { model: "gpt-4o-mini-transcribe", language }, turn_detection: { type: "server_vad", create_response: true, interrupt_response: true } },
      output: { voice },
    },
  }));
  const response = await fetch(`${OPENAI_API_URL}/realtime/calls`, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "OpenAI-Safety-Identifier": safetyId },
    body: form, signal: request.signal,
  });
  if (!response.ok) return openAIError(response);
  return new Response(response.body, { headers: { "Content-Type": "application/sdp", "Cache-Control": "no-store" } });
}
