import type { Route } from "./+types/api.ai-providers.$provider.settings";
import { requireAuth, setTokens, commitSession } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { decryptSavedProviderKey, prepareCommonKeySettings, encryptProviderKey, requestedProviderKey, PROVIDER_KEY_HEADERS as headers } from "~/services/provider-key-settings.server";
import { validateOrigin } from "~/utils/security";
import { getDefaultModelForPlan, parseCompatibleModel } from "~/types/settings";
import { compatibleSessionId, discoverCompatibleModels, requireCompatibleProvider } from "~/services/compatible-provider.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const provider = requireCompatibleProvider(params.provider);
  const tokens = await requireAuth(request);
  if (tokens.currentProjectId || !tokens.rootFolderId) return Response.json({ error: "Select My Drive." }, { status: 403, headers });
  return Response.json({ unlocked: !!tokens.compatibleApiKeys?.[provider] }, { headers });
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  validateOrigin(request);
  const provider = requireCompatibleProvider(params.provider);
  const tokens = await requireAuth(request);
  if (tokens.currentProjectId || !tokens.rootFolderId || !tokens.accessToken) return Response.json({ error: "Select My Drive." }, { status: 403, headers });
  const { tokens: validTokens } = await getValidTokens(request, tokens);
  const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
  const body = await request.json().catch(() => null);
  if (!body || !["verify", "save", "unlock", "lock", "remove"].includes(body.action)) return Response.json({ error: "Invalid action" }, { status: 400, headers });
  const config = settings.compatibleProviders?.[provider];
  const keys = { ...validTokens.compatibleApiKeys };
  try {
    if (body.action === "remove") {
      const providers = { ...settings.compatibleProviders }; delete providers[provider]; delete keys[provider];
      await saveSettings(validTokens.accessToken, validTokens.rootFolderId, { ...settings, compatibleProviders: providers, selectedModel: parseCompatibleModel(settings.selectedModel || "")?.provider === provider ? getDefaultModelForPlan(settings.apiPlan) : settings.selectedModel });
    } else if (body.action === "lock") delete keys[provider];
    else {
      const previous = body.action === "unlock" || (!body.apiKey && !keys[provider] && body.password) ? await decryptSavedProviderKey(config, typeof body.password === "string" ? body.password : "", "provider", headers, settings.encryption) : "";
      const key = requestedProviderKey(body.apiKey, previous || keys[provider] || "");
      if (!key || key.length > 1024 || /[\r\n]/.test(key)) return Response.json({ error: "Enter an API key or unlock the saved key." }, { status: 400, headers });
      if (body.action === "verify" || body.action === "save") {
        const replacingKey = typeof body.apiKey === "string" && !!body.apiKey.trim();
        const commonSettings = body.action === "save" && (replacingKey || !config?.encryptedApiKey) ? await prepareCommonKeySettings(settings, body) : settings;
        const models = await discoverCompatibleModels(provider, key, compatibleSessionId(tokens.rootFolderId, "verify"), request.signal);
        if (body.action === "verify") return Response.json({ models }, { headers });
        const available = new Set(models.map(model => model.id));
        const enabledModels: string[] = Array.isArray(body.enabledModels) ? [...new Set(body.enabledModels.filter((id: unknown): id is string => typeof id === "string" && available.has(id)))] as string[] : config?.enabledModels.filter(id => available.has(id)) || [];
        if (!enabledModels.length) return Response.json({ error: "Select at least one model." }, { status: 400, headers });
        const encrypted = !replacingKey && config?.encryptedApiKey ? { encryptedApiKey: config.encryptedApiKey, salt: config.salt } : await encryptProviderKey(key, commonSettings);
        const selected = parseCompatibleModel(settings.selectedModel || "");
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, {
          ...commonSettings,
          compatibleProviders: { ...settings.compatibleProviders, [provider]: { ...encrypted, availableModels: models, enabledModels } },
          selectedModel: selected?.provider === provider && !enabledModels.includes(selected.model) ? `${provider}:${enabledModels[0]}` : settings.selectedModel,
        });
        keys[provider] = key;
      } else if (body.action === "unlock") {
        if (!previous) return Response.json({ error: "Configure the provider first." }, { status: 400, headers });
        keys[provider] = previous;

      }
    }
    const session = await setTokens(request, { ...validTokens, compatibleApiKeys: keys });
    return Response.json({ ok: true, unlocked: !!keys[provider] }, { headers: { ...headers, "Set-Cookie": await commitSession(session) } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502, headers });
  }
}
