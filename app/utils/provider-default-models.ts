import { getConfiguredOpenAIModels, isExternalChatModel, isModelAllowedForPlan, isOpenAIModel, parseCompatibleModel, type ModelType, type UserSettings } from "~/types/settings";

export type ChatSettingsProvider = "apikey" | "openai" | "vertex" | "openrouter" | "opencodego";
export type ProviderDefaultModels = Partial<Record<ChatSettingsProvider, ModelType | "">>;

export function activeSettingsProvider(settings: UserSettings): ChatSettingsProvider {
  return settings.usePersonalVertex ? "vertex" : parseCompatibleModel(settings.selectedModel || "")?.provider || (isOpenAIModel(settings.selectedModel || "") ? "openai" : "apikey");
}

export function isProviderDefaultModel(settings: UserSettings, provider: ChatSettingsProvider, model: unknown): model is ModelType | "" {
  if (typeof model !== "string") return false;
  if (provider === "openai") return isOpenAIModel(model) && isModelAllowedForPlan(settings.apiPlan, model as ModelType, true, undefined, settings.openai);
  if (provider === "openrouter" || provider === "opencodego") {
    const parsed = parseCompatibleModel(model);
    return parsed?.provider === provider && !!settings.compatibleProviders?.[provider]?.enabledModels.includes(parsed.model);
  }
  return model === "" || (!isExternalChatModel(model) && isModelAllowedForPlan(provider === "vertex" ? "paid" : settings.apiPlan, model as ModelType));
}

/** Keep provider preferences independently of which provider currently runs chat. */
export function getProviderDefaultModels(settings: UserSettings): Record<ChatSettingsProvider, ModelType | ""> {
  const models: Record<ChatSettingsProvider, ModelType | ""> = {
    apikey: "", vertex: "", openai: getConfiguredOpenAIModels(settings.openai)[0]?.name || "",
    openrouter: settings.compatibleProviders?.openrouter?.enabledModels[0] ? `openrouter:${settings.compatibleProviders.openrouter.enabledModels[0]}` : "",
    opencodego: settings.compatibleProviders?.opencodego?.enabledModels[0] ? `opencodego:${settings.compatibleProviders.opencodego.enabledModels[0]}` : "",
  };
  for (const provider of Object.keys(models) as ChatSettingsProvider[]) {
    const saved = settings.providerDefaultModels?.[provider];
    if (isProviderDefaultModel(settings, provider, saved)) models[provider] = saved;
  }
  // Existing settings may predate per-provider preferences, or be saved by an
  // older client. The active model remains authoritative for that provider.
  const active = activeSettingsProvider(settings);
  if (settings.selectedModel && isProviderDefaultModel(settings, active, settings.selectedModel)) models[active] = settings.selectedModel;
  return models;
}

export function readProviderDefaultModels(form: FormData, settings: UserSettings): ProviderDefaultModels | undefined {
  if (!form.has("providerDefaultModels")) return settings.providerDefaultModels;
  const value: unknown = JSON.parse(String(form.get("providerDefaultModels")));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid provider model settings.");
  const models = { ...settings.providerDefaultModels };
  for (const provider of ["apikey", "vertex", "openai", "openrouter", "opencodego"] as const) {
    if (!Object.prototype.hasOwnProperty.call(value, provider)) continue;
    const model = (value as Record<string, unknown>)[provider];
    // A provider without enabled models has no editable default yet.
    if ((provider === "openrouter" || provider === "opencodego") && model === "") { models[provider] = ""; continue; }
    if (!isProviderDefaultModel(settings, provider, model)) throw new Error(`Invalid default model for ${provider}.`);
    models[provider] = model;
  }
  return models;
}
