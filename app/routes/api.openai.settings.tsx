import type { Route } from "./+types/api.openai.settings";
import { requireAuth, setTokens, commitSession } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { decryptSavedProviderKey, encryptProviderKey, requestedProviderKey, PROVIDER_KEY_HEADERS as noStore } from "~/services/provider-key-settings.server";
import { validateOrigin } from "~/utils/security";
import { getDefaultModelForPlan, isOpenAIModel } from "~/types/settings";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  return Response.json({ unlocked: !!tokens.openaiApiKey }, { headers: noStore });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  validateOrigin(request);
  const tokens = await requireAuth(request);
  if (!tokens.accessToken || !tokens.rootFolderId || tokens.currentProjectId) {
    return Response.json({ error: "Select My Drive to configure OpenAI." }, { status: 403, headers: noStore });
  }
  const { tokens: validTokens } = await getValidTokens(request, tokens);
  const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
  const body = await request.json().catch(() => null) as {
    action?: unknown; apiKey?: unknown; password?: unknown; newPassword?: unknown;
  } | null;
  if (!body || !["save", "unlock", "lock", "remove"].includes(String(body.action))) {
    return Response.json({ error: "Invalid request" }, { status: 400, headers: noStore });
  }
  let openaiApiKey = "";
  if (body.action !== "lock") {
    const previousKey = await decryptSavedProviderKey(settings.openai, typeof body.password === "string" ? body.password : "", "OpenAI");
    if (body.action === "unlock") {
      if (!previousKey) return Response.json({ error: "Configure an OpenAI key first." }, { status: 400, headers: noStore });
      openaiApiKey = previousKey;
    } else if (body.action === "save") {
      openaiApiKey = requestedProviderKey(body.apiKey, previousKey);
      await saveSettings(validTokens.accessToken, validTokens.rootFolderId, {
        ...settings, openai: await encryptProviderKey(openaiApiKey, body),
      });
    } else if (body.action === "remove") {
      await saveSettings(validTokens.accessToken, validTokens.rootFolderId, {
        ...settings, openai: undefined,
        selectedModel: settings.selectedModel && isOpenAIModel(settings.selectedModel)
          ? getDefaultModelForPlan(settings.apiPlan) : settings.selectedModel,
      });
    }
  }
  const session = await setTokens(request, { ...validTokens, openaiApiKey });
  return Response.json({ ok: true, unlocked: !!openaiApiKey }, {
    headers: { ...noStore, "Set-Cookie": await commitSession(session) },
  });
}
