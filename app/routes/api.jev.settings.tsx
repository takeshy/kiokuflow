import type { Route } from "./+types/api.jev.settings";
import { requireAuth, setTokens, commitSession } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { decryptSavedProviderKey, prepareCommonKeySettings, encryptProviderKey, requestedProviderKey, PROVIDER_KEY_HEADERS as defaultHeaders } from "~/services/provider-key-settings.server";
import { jevDecide } from "~/services/jev-rag.server";
import { validateOrigin } from "~/utils/security";

async function verifyConnection(apiKey: string, useOpenRouter: boolean, signal: AbortSignal) {
  const answers = await jevDecide({ apiKey, useOpenRouter }, "接続確認", { check: { type: "choice", instructions: "接続確認です。keepを選択してください。", criteria: { keep: "接続確認", exclude: "その他" } } }, undefined, signal);
  if (answers.check.choice !== "keep") throw new Error("Jev connection verification failed: unexpected decision.");
}

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
    if (body.action === "save" || body.action === "setMode" || body.action === "verify") {
      if (body.newPassword) return Response.json({ error: "Change the private-key password in General." }, { status: 400, headers });
      if (body.useOpenRouter !== undefined && typeof body.useOpenRouter !== "boolean") return Response.json({ error: "Invalid Jev mode." }, { status: 400, headers });
      const useOpenRouter = body.useOpenRouter ?? settings.jev?.useOpenRouter ?? false;
      const candidateRouterKey = body.action === "verify" && typeof body.openRouterApiKey === "string" ? body.openRouterApiKey.trim() : "";
      if (useOpenRouter && !settings.compatibleProviders?.openrouter?.encryptedApiKey && !candidateRouterKey) return Response.json({ error: "Configure OpenRouter first." }, { status: 400, headers });
      const enteredKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      const key = useOpenRouter ? candidateRouterKey || valid.compatibleApiKeys?.openrouter : requestedProviderKey(enteredKey, valid.jevApiKey || "");
      if (!key) return Response.json({ error: "Enter the key or unlock it in General settings." }, { status: 401, headers });
      if (key.length > 1024 || /[\r\n]/.test(key)) return Response.json({ error: "Invalid API key." }, { status: 400, headers });
      // Confirm the exact candidate connection before changing settings or session keys.
      await verifyConnection(key, useOpenRouter, request.signal);
      if (body.action === "verify") return Response.json({ ok: true, unlocked: !!valid.jevApiKey }, { headers });
      let updated = settings;
      if (!useOpenRouter && (enteredKey || !settings.jev?.encryptedApiKey)) {
        const common = await prepareCommonKeySettings(settings, body, headers);
        updated = { ...common, jev: { useOpenRouter: false, ...await encryptProviderKey(key, common, headers) } };
      } else updated = { ...settings, jev: { ...settings.jev, useOpenRouter } };
      await saveSettings(valid.accessToken, valid.rootFolderId, updated);
      const session = await setTokens(request, { ...valid, ...(!useOpenRouter ? { jevApiKey: key } : {}) });
      return Response.json({ ok: true, unlocked: !useOpenRouter ? true : !!valid.jevApiKey }, { headers: { ...headers, "Set-Cookie": await commitSession(session) } });
    }
    let key = "";
    if (body.action !== "lock") {
      const previous = body.action === "unlock" ? await decryptSavedProviderKey(settings.jev, typeof body.password === "string" ? body.password : "", "Jev", headers, settings.encryption) : valid.jevApiKey || "";
      if (body.action === "unlock") {
        if (!previous) return Response.json({ error: "Configure a Jev key first." }, { status: 400, headers });
        key = previous;
      } else if (body.action === "remove") {
        await saveSettings(valid.accessToken, valid.rootFolderId, { ...settings, jev: { useOpenRouter: settings.jev?.useOpenRouter ?? false } });
      }
    }
    const session = await setTokens(request, { ...valid, jevApiKey: key });
    return Response.json({ ok: true, unlocked: !!key }, { headers: { ...headers, "Set-Cookie": await commitSession(session) } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502, headers });
  }
}
