import { getConfiguredOpenAIModels, type OpenAIModelEntry, type UserSettings } from "~/types/settings";

export type EditableProvider = "openai" | "jev" | "openrouter" | "opencodego";
export interface ProviderSettingsDraft {
  apiKey: string;
  models: OpenAIModelEntry[];
  enabledModels: string[];
  verified: boolean;
  dirty: boolean;
  useOpenRouter: boolean;
}
export type ProviderSettingsDrafts = Record<EditableProvider, ProviderSettingsDraft>;
export interface ProviderDraftProps {
  draft: ProviderSettingsDraft;
  onChange: (draft: ProviderSettingsDraft) => void;
  onBusyChange: (busy: boolean) => void;
}

export function createProviderSettingsDrafts(settings: UserSettings): ProviderSettingsDrafts {
  const empty = (): ProviderSettingsDraft => ({ apiKey: "", models: [], enabledModels: [], verified: false, dirty: false, useOpenRouter: false });
  return {
    openai: { ...empty(), models: settings.openai?.availableModels ?? [], enabledModels: settings.openai ? getConfiguredOpenAIModels(settings.openai).map(model => model.name) : [] },
    jev: { ...empty(), useOpenRouter: settings.jev?.useOpenRouter === true },
    openrouter: { ...empty(), models: settings.compatibleProviders?.openrouter?.availableModels ?? [], enabledModels: settings.compatibleProviders?.openrouter?.enabledModels ?? [] },
    opencodego: { ...empty(), models: settings.compatibleProviders?.opencodego?.availableModels ?? [], enabledModels: settings.compatibleProviders?.opencodego?.enabledModels ?? [] },
  };
}

export function serializeProviderSettingsDrafts(drafts: ProviderSettingsDrafts): string {
  return JSON.stringify(Object.fromEntries(Object.entries(drafts).filter(([, draft]) => draft.dirty).map(([provider, draft]) => [provider, {
    apiKey: draft.apiKey, enabledModels: draft.enabledModels, ...(provider === "jev" ? { useOpenRouter: draft.useOpenRouter } : {}),
  }])));
}

/** Model pickers may use drafts, while persisted credentials remain unchanged until Save. */
export function previewProviderSettings(settings: UserSettings, drafts: ProviderSettingsDrafts): UserSettings {
  const compatibleProviders = { ...settings.compatibleProviders };
  for (const provider of ["openrouter", "opencodego"] as const) {
    if (drafts[provider].dirty) compatibleProviders[provider] = {
      encryptedApiKey: settings.compatibleProviders?.[provider]?.encryptedApiKey || (drafts[provider].apiKey ? "pending" : ""),
      salt: settings.compatibleProviders?.[provider]?.salt || "", availableModels: drafts[provider].models, enabledModels: drafts[provider].enabledModels,
    };
  }
  return { ...settings, compatibleProviders, ...(drafts.openai.dirty ? { openai: {
    encryptedApiKey: settings.openai?.encryptedApiKey || (drafts.openai.apiKey ? "pending" : ""), salt: settings.openai?.salt || "",
    availableModels: drafts.openai.models, enabledModels: drafts.openai.enabledModels,
  } } : {}) };
}
