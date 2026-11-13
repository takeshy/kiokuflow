import type { Route } from "./+types/api.openai.settings";
import { requireAuth, setTokens, commitSession } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { decryptSavedProviderKey, prepareCommonKeySettings, encryptProviderKey, requestedProviderKey, PROVIDER_KEY_HEADERS as noStore } from "~/services/provider-key-settings.server";
import { validateOrigin } from "~/utils/security";
import { discoverOpenAIModels } from "~/services/openai.server";
import { discoverRagEmbeddingModels } from "~/services/rag-providers.server";
import { getDefaultModelForPlan, isOpenAIModel, type UserSettings, type OpenAISettingsConfig, type OpenAIModelEntry, type ModelType } from "~/types/settings";

function selectedModelSettings(settings: UserSettings, openai: OpenAISettingsConfig, models: OpenAIModelEntry[], selection: unknown) {
  if (!Array.isArray(selection) || selection.some(id => typeof id !== "string")) throw Response.json({ error: "Invalid enabled models" }, { status: 400, headers: noStore });
  const available = new Set(models.map(model => model.id));
  const enabled = [...new Set(selection as string[])];
  if (!enabled.length || enabled.some(id => !available.has(id))) throw Response.json({ error: "Select available chat models after fetching the catalogue." }, { status: 400, headers: noStore });
  const first = enabled[0] as ModelType;
  return { ...settings, openai: { ...openai, availableModels: models, enabledModels: enabled },
    selectedModel: settings.selectedModel && isOpenAIModel(settings.selectedModel) && !enabled.includes(settings.selectedModel) ? first : settings.selectedModel,
    providerDefaultModels: { ...settings.providerDefaultModels, openai: settings.providerDefaultModels?.openai && enabled.includes(settings.providerDefaultModels.openai) ? settings.providerDefaultModels.openai : settings.selectedModel && isOpenAIModel(settings.selectedModel) && enabled.includes(settings.selectedModel) ? settings.selectedModel : first },
  };
}

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
    action?: unknown; apiKey?: unknown; password?: unknown; newPassword?: unknown; enabledModels?: unknown;
  } | null;
  if (!body || !["verify", "saveModels", "save", "saveEmbeddingKey", "unlock", "lock", "remove"].includes(String(body.action))) {
    return Response.json({ error: "Invalid request" }, { status: 400, headers: noStore });
  }
  if (body.action === "saveEmbeddingKey") {
    // Keep the usual chat save contract intact. This path initializes an
    // embedding-only connection without selecting or enabling chat models.
    if (settings.openai && settings.openai.enabledModels?.length !== 0) return Response.json({ error: "Use the API key and models save action to update a chat connection." }, { status: 400, headers: noStore });
    try {
      const key = requestedProviderKey(body.apiKey, validTokens.openaiApiKey || "");
      if (!key || key.length > 1024 || /[\r\n]/.test(key)) return Response.json({ error: "Enter a valid OpenAI API key." }, { status: 400, headers: noStore });
      const models = await discoverRagEmbeddingModels("openai", key, AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]));
      if (!models.some(model => model.supported)) return Response.json({ error: "No supported embedding models were listed for this key." }, { status: 400, headers: noStore });
      const common = await prepareCommonKeySettings(settings, body);
      const encrypted = await encryptProviderKey(key, common);
      await saveSettings(validTokens.accessToken, validTokens.rootFolderId, { ...common, openai: { ...encrypted, enabledModels: [], availableModels: [] } });
      const session = await setTokens(request, { ...validTokens, openaiApiKey: key });
      return Response.json({ ok: true, unlocked: true }, { headers: { ...noStore, "Set-Cookie": await commitSession(session) } });
    } catch (error) {
      if (error instanceof Response) return error;
      return Response.json({ error: error instanceof Error ? error.message : "Could not save the embedding key." }, { status: 502, headers: noStore });
    }
  }
  if (body.action === "verify") {
    const key = requestedProviderKey(body.apiKey, validTokens.openaiApiKey || "") || await decryptSavedProviderKey(settings.openai, typeof body.password === "string" ? body.password : "", "OpenAI", noStore, settings.encryption);
    if (!key || key.length > 1024 || /[\r\n]/.test(key)) return Response.json({ error: "Enter an API key or unlock the saved key in General." }, { status: 400, headers: noStore });
    try { return Response.json({ models: await discoverOpenAIModels(key, request.signal) }, { headers: noStore }); }
    catch (error) { if (error instanceof Response) return error; return Response.json({ error: error instanceof Error ? error.message : "Could not fetch models" }, { status: 502, headers: noStore }); }
  }
  if (body.action === "saveModels") {
    if (!settings.openai) return Response.json({ error: "Configure an OpenAI key first." }, { status: 400, headers: noStore });
    if (!validTokens.openaiApiKey) return Response.json({ error: "Unlock the saved OpenAI key in General to refresh model selections." }, { status: 401, headers: noStore });
    try {
      const models = await discoverOpenAIModels(validTokens.openaiApiKey, request.signal);
      await saveSettings(validTokens.accessToken, validTokens.rootFolderId, selectedModelSettings(settings, settings.openai, models, body.enabledModels));
      return Response.json({ ok: true, unlocked: true }, { headers: noStore });
    } catch (error) { if (error instanceof Response) return error; return Response.json({ error: error instanceof Error ? error.message : "Could not save models" }, { status: 502, headers: noStore }); }
  }
  if (body.action === "save" && (!Array.isArray(body.enabledModels) || !body.enabledModels.length)) return Response.json({ error: "Fetch model information and select at least one model before saving." }, { status: 400, headers: noStore });
  let openaiApiKey = "";
  if (body.action !== "lock") {
    const previousKey = body.action === "unlock" ? await decryptSavedProviderKey(settings.openai, typeof body.password === "string" ? body.password : "", "OpenAI", noStore, settings.encryption) : validTokens.openaiApiKey || "";
    if (body.action === "unlock") {
      if (!previousKey) return Response.json({ error: "Configure an OpenAI key first." }, { status: 400, headers: noStore });
      openaiApiKey = previousKey;
    } else if (body.action === "save") {
      openaiApiKey = requestedProviderKey(body.apiKey, previousKey);
      const replacingKey = typeof body.apiKey === "string" && !!body.apiKey.trim();
      const commonSettings = replacingKey || !settings.openai ? await prepareCommonKeySettings(settings, body) : settings;
      const openai = !replacingKey && settings.openai ? settings.openai : { ...settings.openai, ...await encryptProviderKey(openaiApiKey, commonSettings) };
      const updated = selectedModelSettings(commonSettings, openai, await discoverOpenAIModels(openaiApiKey, request.signal), body.enabledModels);
      await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updated);
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
