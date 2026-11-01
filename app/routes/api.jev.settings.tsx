import type { Route } from "./+types/api.jev.settings";
import { requireAuth, setTokens, commitSession } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { decryptSavedProviderKey, prepareCommonKeySettings, encryptProviderKey, requestedProviderKey, PROVIDER_KEY_HEADERS as defaultHeaders } from "~/services/provider-key-settings.server";
import { jevDecide } from "~/services/jev-rag.server";
import { validateOrigin } from "~/utils/security";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  return Response.json({ unlocked: !!tokens.jevApiKey }, { headers: defaultHeaders });
}
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  validateOrigin(request);
  const tokens = await requireAuth(request);
  if (!tokens.accessToken || !tokens.rootFolderId || tokens.currentProjectId) return Response.json({ error: "Select My Drive to configure Jev." }, { status: 403, headers: defaultHeaders });
  const { tokens: valid, setCookieHeader } = await getValidTokens(request, tokens);
  const headers = { ...defaultHeaders, ...(setCookieHeader ? { "Set-Cookie": setCookieHeader } : {}) };
  const settings = await getSettings(valid.accessToken, valid.rootFolderId);
  const body = await request.json().catch(() => null);
  if (!body || !["save", "verify", "unlock", "lock", "remove", "setMode"].includes(body.action)) return Response.json({ error: "Invalid action" }, { status: 400, headers });
  try {
    if (body.action === "setMode") {
      if (typeof body.useOpenRouter !== "boolean" || (body.useOpenRouter && !settings.compatibleProviders?.openrouter?.encryptedApiKey)) return Response.json({ error: "Configure OpenRouter first." }, { status: 400, headers });
      await saveSettings(valid.accessToken, valid.rootFolderId, { ...settings, jev: { ...settings.jev, useOpenRouter: body.useOpenRouter } });
      return Response.json({ ok: true, unlocked: !!valid.jevApiKey }, { headers });
    }
    if (body.action === "verify") {
      const useOpenRouter = settings.jev?.useOpenRouter === true;
      const key = useOpenRouter ? valid.compatibleApiKeys?.openrouter : typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : valid.jevApiKey;
      if (!key) return Response.json({ error: "Enter the key or unlock it in General settings." }, { status: 401, headers });
      await jevDecide({ apiKey: key, useOpenRouter }, "接続確認", { check: { type: "choice", instructions: "接続確認です。keepを選択してください。", criteria: { keep: "接続確認", exclude: "その他" } } }, undefined, request.signal);
      return Response.json({ ok: true, unlocked: !!valid.jevApiKey }, { headers });
    }
    let key = "";
    if (body.action !== "lock") {
      const previous = await decryptSavedProviderKey(settings.jev, typeof body.password === "string" ? body.password : "", "Jev", headers);
      if (body.action === "unlock") {
        if (!previous) return Response.json({ error: "Configure a Jev key first." }, { status: 400, headers });
        key = previous;
      } else if (body.action === "save") {
        key = requestedProviderKey(body.apiKey, previous);
        const commonSettings = await prepareCommonKeySettings(settings, body, headers);
        await saveSettings(valid.accessToken, valid.rootFolderId, { ...commonSettings, jev: { useOpenRouter: settings.jev?.useOpenRouter ?? false, ...await encryptProviderKey(key, body, headers) } });
      } else if (body.action === "remove") {
        const commonSettings = await prepareCommonKeySettings(settings, body, headers);
        await saveSettings(valid.accessToken, valid.rootFolderId, { ...commonSettings, jev: { useOpenRouter: settings.jev?.useOpenRouter ?? false } });
      }
    }
    const session = await setTokens(request, { ...valid, jevApiKey: key });
    return Response.json({ ok: true, unlocked: !!key }, { headers: { ...headers, "Set-Cookie": await commitSession(session) } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502, headers });
  }
}
