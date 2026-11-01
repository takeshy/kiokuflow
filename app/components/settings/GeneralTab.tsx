import { SHOW_WEBPAGE_BUILDER } from "~/config/feature-visibility";
import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { KeyRound, Lock, Check, Zap } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { clearCachedApiKey } from "~/services/api-key-cache";
import { invalidateIndexCache } from "~/utils/index-cache";
import {
  SectionCard,
  Label,
  SaveButton,
  NotifyDialog,
  inputClass,
  checkboxClass,
} from "~/components/settings/shared";
import type {
  UserSettings,
  ApiPlan,
  ModelType,
  Language,
  FontSize,
  Theme,
} from "~/types/settings";
import {
  getAvailableModels,
  getDefaultModelForPlan,
  isModelAllowedForPlan,
  isOpenAIModel,
  isExternalChatModel,
  parseCompatibleModel,
  COMPATIBLE_PROVIDERS,
  OPENAI_MODELS,
  SUPPORTED_LANGUAGES,
  FONT_SIZE_OPTIONS,
  THEME_OPTIONS,
} from "~/types/settings";
import { THIRD_PARTY_NOTICES } from "~/third-party-notices";
import {
  VERTEX_TOPUP_UNIT_CHOICES,
  VERTEX_TOPUP_UNIT_JPY,
  VERTEX_TOPUP_UNIT_USD,
} from "~/types/hubwork";
import { hasVertexPrice } from "~/services/ai/models";
import { CompatibleProviderSettings } from "./CompatibleProviderSettings";
import { ProviderPasswordSettings } from "./ProviderPasswordSettings";
import { useProviderPasswords } from "./ProviderPasswords";
import { JevSettings } from "./JevSettings";
import { OpenAISettings } from "./OpenAISettings";

type AiTab = "apikey" | "openai" | "vertex" | "openrouter" | "opencodego" | "jev";

interface PersonalVertexOAuthStatus {
  connected: boolean;
  connectedEmail: string | null;
  clientConfigured: boolean;
  projectId: string | null;
}

async function personalVertexApi(method: "POST" | "DELETE", body?: object): Promise<PersonalVertexOAuthStatus> {
  const response = await fetch("/api/personal-vertex/connection", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({})) as { error?: string; oauthStatus?: PersonalVertexOAuthStatus };
  if (!response.ok || !data.oauthStatus) throw new Error(data.error || `HTTP ${response.status}`);
  return data.oauthStatus;
}

export function GeneralTab({
  settings,
  hasApiKey,
  maskedKey,
  onLanguageChange,
  hideGeminiSettings = false,
  section = "general",
  onOpenGeneral,
}: {
  settings: UserSettings;
  hasApiKey: boolean;
  maskedKey: string | null;
  onLanguageChange: (lang: Language) => void;
  hideGeminiSettings?: boolean;
  section?: "general" | "ai";
  onOpenGeneral?: () => void;
}) {
  const showAi = section === "ai";
  const { password: encryptionPassword } = useProviderPasswords();
  const fetcher = useFetcher();
  const loading = fetcher.state !== "idle";
  const { t, language } = useI18n();

  const [apiPlan, setApiPlan] = useState<ApiPlan>(settings.apiPlan);
  const [selectedModel, setSelectedModel] = useState<ModelType | "">(
    settings.selectedModel || ""
  );
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [showManagementFolders, setShowManagementFolders] = useState(settings.showManagementFolders ?? false);
  const [maxSavedChatHistories, setMaxSavedChatHistories] = useState(settings.maxSavedChatHistories ?? 100);
  const [manualChatSaveFolder, setManualChatSaveFolder] = useState(settings.manualChatSaveFolder ?? "");
  const [dashboardEnabled, setDashboardEnabled] = useState(settings.dashboardEnabled ?? false);
  const [workflowEnabled, setWorkflowEnabled] = useState(settings.workflowEnabled ?? false);
  const [ragFeatureEnabled, setRagFeatureEnabled] = useState(settings.ragFeatureEnabled ?? false);
  const [webpageBuilderEnabled, setWebpageBuilderEnabled] = useState(settings.webpageBuilderEnabled ?? false);
  const [personalVertexSource, setPersonalVertexSource] = useState<"prepaid" | "own">(settings.personalVertexSource === "own" ? "own" : "prepaid");
  const [personalVertexProjectId, setPersonalVertexProjectId] = useState(settings.personalVertexProjectId || "");
  const [personalVertexLocation, setPersonalVertexLocation] = useState(settings.personalVertexLocation || "global");
  const [personalVertexOAuth, setPersonalVertexOAuth] = useState<PersonalVertexOAuthStatus | null>(null);
  const [personalVertexBusy, setPersonalVertexBusy] = useState(false);
  const [personalVertexNotice, setPersonalVertexNotice] = useState<string | null>(null);
  const [personalBalance, setPersonalBalance] = useState<number | null>(null);
  // null until the balance endpoint answers; false on a self-hosted install
  // with no Firestore, where there is no prepaid balance to sell or spend.
  const [vertexAvailable, setVertexAvailable] = useState<boolean | null>(null);
  const [topupHistory, setTopupHistory] = useState<Array<{ id: string; usd: number; createdAt: number }> | null>(null);
  const [fontSize, setFontSize] = useState<FontSize>(settings.fontSize);
  const [theme, setTheme] = useState<Theme>(settings.theme || "system");
  const availableModels = getAvailableModels(apiPlan);
  // RAG entitlement is independent of the chat provider and Gemini API tier.
  const ragBlockedByVertex = !settings.ragAvailable;

  // Top-ups are sold in the currency of the UI language, so the amount is one
  // choice instead of two.
  const topUpCurrency = language === "ja" ? "jpy" : "usd";
  const formatTopUpAmount = (units: number) =>
    topUpCurrency === "jpy"
      ? `+¥${(units * VERTEX_TOPUP_UNIT_JPY).toLocaleString("ja-JP")}`
      : `+$${units * VERTEX_TOPUP_UNIT_USD}`;

  // Personal Vertex spends a prepaid balance, so it can only offer models the
  // usage recorder knows a price for.
  const vertexModels = availableModels.filter((model) => hasVertexPrice(model.name));

  // Sensitive field state (controlled to survive re-renders after fetcher submission)
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [apiKeyEdited, setApiKeyEdited] = useState(false);

  // Encryption state
  const [encryptChatHistory, setEncryptChatHistory] = useState(settings.encryption.encryptChatHistory);
  const [encryptWorkflowHistory, setEncryptWorkflowHistory] = useState(settings.encryption.encryptWorkflowHistory);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // An encrypted key is stored in settings.json. NOT the same as `hasApiKey`,
  // which is the loader's view of the DECRYPTED key in this session — that one
  // is empty until the user unlocks, and on any new session. Mixing the two
  // made the panel claim "API Key & Encryption configured" while the field
  // below invited the user to enter a key they had already saved.
  const hasStoredApiKey = !!settings.encryptedApiKey;
  const isEncryptionSetup = hasStoredApiKey || !!settings.encryption.encryptedPrivateKey;

  // AI provider sub-tab. The balance arrives after mount, so it cannot take
  // part in the initial value — only the saved opt-in can.
  const hasVertexBalance = personalBalance != null && personalBalance > 0;
  const [aiTab, setAiTab] = useState<AiTab>(
    settings.usePersonalVertex === true ? "vertex" : parseCompatibleModel(settings.selectedModel || "")?.provider || (isOpenAIModel(settings.selectedModel || "") ? "openai" : "apikey"),
  );
  const [activeProvider, setActiveProvider] = useState<AiTab>(aiTab);
  const [providerModels, setProviderModels] = useState<Record<AiTab, ModelType | "">>({
    apikey: settings.selectedModel && !isExternalChatModel(settings.selectedModel) ? settings.selectedModel : "",
    vertex: settings.selectedModel && !isExternalChatModel(settings.selectedModel) ? settings.selectedModel : "",
    openai: settings.selectedModel && isOpenAIModel(settings.selectedModel) ? settings.selectedModel : "gpt-6.1-sol",
    jev: "",
    openrouter: parseCompatibleModel(settings.selectedModel || "")?.provider === "openrouter" ? settings.selectedModel || "" : "",
    opencodego: parseCompatibleModel(settings.selectedModel || "")?.provider === "opencodego" ? settings.selectedModel || "" : "",
  });
  const modelForProvider = (provider: AiTab): ModelType | "" => {
    const candidate = provider === aiTab ? selectedModel : providerModels[provider];
    if (provider === "openrouter" || provider === "opencodego") {
      const enabled = settings.compatibleProviders?.[provider]?.enabledModels || [];
      return enabled.some(model => candidate === `${provider}:${model}`) ? candidate : enabled[0] ? `${provider}:${enabled[0]}` : "";
    }
    return candidate;
  };
  const selectAiTab = (next: AiTab) => {
    if (next === aiTab) return;
    setProviderModels((models) => ({ ...models, [aiTab]: selectedModel }));
    setAiTab(next);
    setSelectedModel(providerModels[next] || ((next === "openrouter" || next === "opencodego") && settings.compatibleProviders?.[next]?.enabledModels[0] ? `${next}:${settings.compatibleProviders[next]!.enabledModels[0]}` : ""));
  };


  useEffect(() => {
    if (activeProvider === "openai" && !settings.openai?.encryptedApiKey) setActiveProvider("apikey");
  }, [activeProvider, settings.openai?.encryptedApiKey]);

  useEffect(() => {
    if (aiTab !== "openrouter" && aiTab !== "opencodego") return;
    const enabled = settings.compatibleProviders?.[aiTab]?.enabledModels || [];
    if (enabled.length && !enabled.some(model => selectedModel === `${aiTab}:${model}`)) setSelectedModel(`${aiTab}:${enabled[0]}`);
  }, [aiTab, selectedModel, settings.compatibleProviders]);

  useEffect(() => {
    if (activeProvider !== "openrouter" && activeProvider !== "opencodego") return;
    if (!settings.compatibleProviders?.[activeProvider]?.encryptedApiKey) setActiveProvider("apikey");
  }, [activeProvider, settings.compatibleProviders]);

  // When plan changes, reset model if it's not available
  useEffect(() => {
    if (aiTab === "jev" || aiTab === "openai" || aiTab === "openrouter" || aiTab === "opencodego") return;
    if (selectedModel && !isModelAllowedForPlan(apiPlan, selectedModel as ModelType)) {
      setSelectedModel(getDefaultModelForPlan(apiPlan));
    }
  }, [apiPlan, selectedModel, aiTab]);

  // Load personal Vertex balance and history (always, so the sub-tab can
  // show data even before the user switches to it)
  useEffect(() => {
    if (!showAi || hideGeminiSettings) return;
    fetch("/api/personal-vertex/balance")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) { setVertexAvailable(false); return; }
        setVertexAvailable(data.available !== false);
        if (data.balanceUsd != null) setPersonalBalance(data.balanceUsd);
      })
      .catch(() => setVertexAvailable(false));
    fetch("/api/personal-vertex/history")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.events) setTopupHistory(data.events); })
      .catch(() => {});
  }, [showAi, hideGeminiSettings]);

  useEffect(() => {
    if (!showAi || hideGeminiSettings) return;
    fetch("/api/personal-vertex/connection")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setPersonalVertexOAuth(data?.oauthStatus ?? null))
      .catch(() => setPersonalVertexOAuth(null));
  }, [showAi, hideGeminiSettings]);

  const uploadPersonalVertexOAuthJson = async (file: File) => {
    setPersonalVertexBusy(true);
    setPersonalVertexNotice(null);
    try {
      const callbackUrl = `${window.location.origin}/auth/vertex/callback`;
      const document = JSON.parse(await file.text()) as { web?: { client_id?: string; client_secret?: string; project_id?: string; redirect_uris?: string[] }; installed?: unknown };
      if (!document.web && document.installed) throw new Error(t("settings.general.vertexOauthDesktopError").replace("{url}", callbackUrl));
      const web = document.web;
      if (!web?.client_id || !web.client_secret || !web.project_id || !Array.isArray(web.redirect_uris)) {
        throw new Error(t("settings.general.vertexOauthJsonError"));
      }
      const status = await personalVertexApi("POST", { clientId: web.client_id, clientSecret: web.client_secret, projectId: web.project_id, redirectUris: web.redirect_uris });
      setPersonalVertexOAuth(status);
      // The OAuth client usually lives in the same project the user wants to
      // run Vertex on, so prefill the execution project when it is still empty.
      if (!personalVertexProjectId.trim()) setPersonalVertexProjectId(web.project_id);
      setPersonalVertexNotice(t("settings.general.vertexOauthJsonSaved"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPersonalVertexBusy(false);
    }
  };

  const disconnectPersonalVertex = async () => {
    setPersonalVertexBusy(true);
    setPersonalVertexNotice(null);
    try {
      setPersonalVertexOAuth(await personalVertexApi("DELETE"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPersonalVertexBusy(false);
    }
  };

  // Show an error dialog or success banner, keeping settings-only passwords in memory.
  // Use a ref for `t` so the effect only re-runs when fetcher.data changes,
  // preventing stale error data from being reprocessed when `t` updates.
  const tRef = useRef(t);
  tRef.current = t;
  const fetcherData = fetcher.data as { success?: boolean; message?: string; apiKeyUpdated?: boolean } | undefined;
  useEffect(() => {
    if (!fetcherData) return;
    if (fetcherData.success) {
      // Clear sensitive fields on success
      setGeminiApiKey("");
      setApiKeyEdited(false);
      invalidateIndexCache();
      if (fetcherData.apiKeyUpdated) clearCachedApiKey();
    } else if (fetcherData.message) {
      const key = `settings.general.${fetcherData.message}` as Parameters<typeof t>[0];
      const translated = tRef.current(key);
      setErrorMessage(translated !== key ? translated : fetcherData.message);
    }
  }, [fetcherData]);


  return (
    <SectionCard>
      {/* Success banner */}
      {fetcherData?.success && (
        <div className="mb-6 p-3 rounded-md border text-sm bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300">
          <div className="flex items-center gap-2">
            <Check size={16} />
            {t("settings.general.generalSaved")}
          </div>
        </div>
      )}

      {/* Error dialog (modal) */}
      {errorMessage && (
        <NotifyDialog message={errorMessage} variant="error" onClose={() => setErrorMessage(null)} />
      )}

      <fetcher.Form method="post" onSubmit={event => {
        if (showAi && geminiApiKey && !encryptionPassword) {
          event.preventDefault();
          setErrorMessage(language === "ja" ? "一般設定で共通の暗号化パスワードを設定・確認してください。" : "Set or verify the common encryption password in General settings.");
        }
      }}>
        <input type="hidden" name="_action" value="saveGeneral" />
        <input type="hidden" name="settingsSection" value={section} />
        <input type="hidden" name="apiKeyEdited" value={apiKeyEdited ? "true" : "false"} />

        {showAi && !hideGeminiSettings && <>
        <div className="mb-6">
          <Label htmlFor="activeAiProvider">{t("settings.ai.activeProvider")}</Label>
          <select id="activeAiProvider" value={activeProvider} onChange={(event) => setActiveProvider(event.target.value as AiTab)} className={inputClass}>
            <option value="apikey">Gemini</option>
            <option value="openai" disabled={!settings.openai?.encryptedApiKey}>OpenAI</option>
            {(["openrouter", "opencodego"] as const).map(provider => <option key={provider} value={provider} disabled={!settings.compatibleProviders?.[provider]?.enabledModels.length}>{COMPATIBLE_PROVIDERS[provider].name}</option>)}
            {(vertexAvailable !== false || activeProvider === "vertex" || aiTab === "vertex") && <option value="vertex">Vertex AI</option>}
          </select>
          <p className="mt-1 text-xs text-gray-500">{t("settings.ai.activeProviderHint")}</p>
        </div>
        <input type="hidden" name="selectedModel" value={modelForProvider(activeProvider)} />
        <input type="hidden" name="apiPlan" value={apiPlan} />
        {/* AI Provider Sub-Tabs */}
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <KeyRound size={16} />
          {t("settings.general.aiProvider")}
        </h3>
        <div role="tablist" aria-label={t("settings.general.aiProvider")} className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700" onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
          const current = tabs.findIndex((tab) => tab === document.activeElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
        }}>
          <button
            type="button"
            role="tab" id="ai-provider-apikey" aria-controls="ai-panel-apikey" aria-selected={aiTab === "apikey"} tabIndex={aiTab === "apikey" ? 0 : -1}
            onClick={() => selectAiTab("apikey")}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${aiTab === "apikey" ? "border-blue-500 font-medium text-blue-600" : "border-transparent text-gray-500"}`}
          >
            {t("settings.general.tabApikey")}
          </button>
          <button
            type="button"
            role="tab" id="ai-provider-openai" aria-controls="ai-panel-openai" aria-selected={aiTab === "openai"} tabIndex={aiTab === "openai" ? 0 : -1}
            onClick={() => selectAiTab("openai")}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${aiTab === "openai" ? "border-blue-500 font-medium text-blue-600" : "border-transparent text-gray-500"}`}
          >OpenAI</button>
          <button type="button" role="tab" id="ai-provider-jev" aria-controls="ai-panel-jev" aria-selected={aiTab === "jev"} tabIndex={aiTab === "jev" ? 0 : -1} onClick={() => selectAiTab("jev")} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${aiTab === "jev" ? "border-blue-500 font-medium text-blue-600" : "border-transparent text-gray-500"}`}>Jev</button>
          {(["openrouter", "opencodego"] as const).map(provider => <button key={provider} type="button" role="tab" id={`ai-provider-${provider}`} aria-controls={`ai-panel-${provider}`} aria-selected={aiTab === provider} tabIndex={aiTab === provider ? 0 : -1} onClick={() => selectAiTab(provider)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${aiTab === provider ? "border-blue-500 font-medium text-blue-600" : "border-transparent text-gray-500"}`}>{COMPATIBLE_PROVIDERS[provider].name}</button>)}
          {(vertexAvailable !== false || activeProvider === "vertex" || aiTab === "vertex") && (
            <button
              type="button"
              role="tab" id="ai-provider-vertex" aria-controls="ai-panel-vertex" aria-selected={aiTab === "vertex"} tabIndex={aiTab === "vertex" ? 0 : -1}
              onClick={() => selectAiTab("vertex")}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${aiTab === "vertex" ? "border-blue-500 font-medium text-blue-600" : "border-transparent text-gray-500"}`}
            >
              <Zap size={12} className="inline mr-1" />
              {t("settings.general.tabVertex")}
              {hasVertexBalance && personalBalance != null && (
                <span className="ml-1 text-xs text-gray-400">${personalBalance.toFixed(2)}</span>
              )}
            </button>
          )}
        </div>
        <input type="hidden" name="usePersonalVertex" value={activeProvider === "vertex" ? "on" : ""} />
        <input type="hidden" name="personalVertexSource" value={personalVertexSource} />
        <input type="hidden" name="personalVertexProjectId" value={personalVertexProjectId} />
        <input type="hidden" name="personalVertexLocation" value={personalVertexLocation} />

        {aiTab === "apikey" && <div role="tabpanel" id="ai-panel-apikey" aria-labelledby="ai-provider-apikey">
        {!isEncryptionSetup && (
          <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
            {t("settings.general.apiKeyOptional")}
          </p>
        )}

        {/* API Key */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="geminiApiKey">{t("settings.general.apiKey")}</Label>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t("settings.general.apiKeyGetLink")} ↗
            </a>
          </div>
          {hasApiKey ? (
            <p className="text-xs text-green-600 dark:text-green-400 mb-1">
              Current key: <code className="font-mono">{maskedKey}</code>
            </p>
          ) : hasStoredApiKey ? (
            /* Saved but not unlocked in this session, so there is no masked
               value to show — say it is saved rather than looking empty. */
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t("settings.general.apiKeySavedLocked")}
            </p>
          ) : null}
          <input
            type="password"
            id="geminiApiKey"
            disabled={!encryptionPassword}
            name="geminiApiKey"
            value={geminiApiKey}
            onChange={(e) => {
              setGeminiApiKey(e.target.value);
              setApiKeyEdited(true);
            }}
            autoComplete="off"
            placeholder={hasStoredApiKey ? t("settings.general.apiKeyKeep") : t("settings.general.apiKeyPlaceholder")}
            className={inputClass}
          />
        </div>

        <input type="hidden" name="currentPassword" value={encryptionPassword || ""} />
        <div className="mb-6">
          {!encryptionPassword && <p className="mb-2 text-sm text-gray-500">{t("settings.ai.setupEncryption")}</p>}
          {onOpenGeneral && <button type="button" onClick={onOpenGeneral} className="text-sm text-blue-600 hover:underline">{language === "ja" ? "一般設定でパスワードを管理" : "Manage password in General"}</button>}
        </div>

        <hr className="my-6 border-gray-200 dark:border-gray-700" />

        {/* API Plan */}
        <div className="mb-6">
          <Label>{t("settings.general.apiPlan")}</Label>
          <div className="flex gap-6 mt-1">
            {(["paid", "free"] as ApiPlan[]).map((plan) => (
              <label key={plan} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="radio"
                  name="geminiApiPlan"
                  value={plan}
                  checked={apiPlan === plan}
                  onChange={() => setApiPlan(plan)}
                  className="text-blue-600 focus:ring-blue-500"
                />
                {plan === "paid" ? t("settings.general.paid") : t("settings.general.free")}
              </label>
            ))}
          </div>
        </div>

        {/* Model */}
        <div className="mb-6">
          <Label htmlFor="selectedModel">{t("settings.general.defaultModel")}</Label>
          <select
            id="selectedModel"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value as ModelType)}
            className={inputClass}
          >
            <option value="">{t("settings.general.usePlanDefault")} ({getDefaultModelForPlan(apiPlan)})</option>
            {availableModels.map((m) => (
              <option key={m.name} value={m.name}>
                {m.displayName} -- {m.description}
              </option>
            ))}
          </select>
        </div>
        </div>}

        {aiTab === "openai" && <div role="tabpanel" id="ai-panel-openai" aria-labelledby="ai-provider-openai">
          <OpenAISettings settings={settings} onOpenGeneral={onOpenGeneral} />
          <div className="mb-6">
            <Label htmlFor="openaiSelectedModel">{t("settings.general.defaultModel")}</Label>
            <select id="openaiSelectedModel" value={selectedModel} disabled={!settings.openai?.encryptedApiKey} onChange={(event) => setSelectedModel(event.target.value as ModelType)} className={inputClass}>
              {OPENAI_MODELS.map((model) => <option key={model.name} value={model.name}>{model.displayName}</option>)}
            </select>
          </div>
        </div>}

        {aiTab === "jev" && <div role="tabpanel" id="ai-panel-jev" aria-labelledby="ai-provider-jev"><JevSettings settings={settings} onOpenGeneral={onOpenGeneral} /></div>}
        {(aiTab === "openrouter" || aiTab === "opencodego") && <div role="tabpanel" id={`ai-panel-${aiTab}`} aria-labelledby={`ai-provider-${aiTab}`}>
          <CompatibleProviderSettings key={aiTab} provider={aiTab} settings={settings} onOpenGeneral={onOpenGeneral} />
          <div className="mb-6">
            <Label htmlFor="compatibleSelectedModel">{t("settings.general.defaultModel")}</Label>
            <select id="compatibleSelectedModel" className={inputClass} value={selectedModel} disabled={!settings.compatibleProviders?.[aiTab]?.enabledModels.length} onChange={event => setSelectedModel(event.target.value as ModelType)}>
              {!settings.compatibleProviders?.[aiTab]?.enabledModels.length && <option value="">{language === "ja" ? "モデルを取得・選択して保存してください" : "Fetch, select, and save models first"}</option>}
              {settings.compatibleProviders?.[aiTab]?.enabledModels.map(model => <option key={model} value={`${aiTab}:${model}`}>{model}</option>)}
            </select>
          </div>
        </div>}

        {aiTab === "vertex" && (
          <div role="tabpanel" id="ai-panel-vertex" aria-labelledby="ai-provider-vertex" className="mb-6">
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              {t("settings.general.enableVertexAiDescription")}
            </p>
            {/* "Vertex only": every AI feature follows this tab, so the user
                should know the stored key is inert rather than a fallback. */}
            <p className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
              {t("settings.general.vertexOnlyNote")}
            </p>
            <div className="mb-4 flex gap-2">
              <button type="button" onClick={() => setPersonalVertexSource("prepaid")} className={`${personalVertexSource === "prepaid" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-300"} rounded-lg border px-3 py-2 text-sm dark:bg-gray-900`}>
                {t("settings.general.vertexPrepaid")}
              </button>
              <button type="button" onClick={() => setPersonalVertexSource("own")} className={`${personalVertexSource === "own" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-300"} rounded-lg border px-3 py-2 text-sm dark:bg-gray-900`}>
                {t("settings.general.vertexOwn")}
              </button>
            </div>
            {personalVertexSource === "own" && (
              <div className="mb-4 space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <div>
                  <Label htmlFor="personalVertexProjectId">{t("settings.general.vertexProjectId")}</Label>
                  <input id="personalVertexProjectId" className={inputClass} value={personalVertexProjectId} onChange={(event) => setPersonalVertexProjectId(event.target.value)} placeholder="my-gcp-project" />
                </div>
                <div>
                  <Label htmlFor="personalVertexLocation">{t("settings.general.vertexLocation")}</Label>
                  <input id="personalVertexLocation" className={inputClass} value={personalVertexLocation} onChange={(event) => setPersonalVertexLocation(event.target.value)} placeholder="global" />
                </div>
                <p className="text-xs text-gray-500">{t("settings.general.vertexOwnBillingNote")}</p>
                {/* Same two-step flow as the desktop app: the user's own OAuth
                    client JSON first, then Google consent with that client.
                    The service's OAuth client is never used for a project
                    the service does not own, so Connect stays disabled until
                    a client is stored. */}
                <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-4 dark:border-blue-700 dark:bg-blue-950/30">
                  <h4 className="font-semibold text-blue-900 dark:text-blue-100">{t("settings.general.vertexOauthJsonTitle")}</h4>
                  <p className="mt-1 text-xs text-gray-500">{t("settings.general.vertexOauthJsonDescription")}</p>
                  {personalVertexOAuth?.clientConfigured && personalVertexOAuth.projectId && (
                    <p className="mt-2 text-xs text-gray-500">{t("settings.general.vertexOauthClientProject").replace("{project}", personalVertexOAuth.projectId)}</p>
                  )}
                  {personalVertexNotice && <p className="mt-2 text-xs text-green-600">{personalVertexNotice}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                    <label className={`inline-block cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 ${personalVertexBusy ? "pointer-events-none opacity-50" : ""}`}>
                      {t("settings.general.vertexOauthJsonSelect")}
                      <input type="file" accept="application/json,.json" className="hidden" disabled={personalVertexBusy} onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void uploadPersonalVertexOAuthJson(file);
                      }} />
                    </label>
                    {personalVertexOAuth?.connected ? (
                      <>
                        <span className="text-green-600">{t("settings.general.vertexConnected").replace("{email}", personalVertexOAuth.connectedEmail || "")}</span>
                        <button type="button" className="text-red-600 hover:underline" disabled={personalVertexBusy} onClick={() => void disconnectPersonalVertex()}>{t("settings.general.vertexDisconnect")}</button>
                      </>
                    ) : personalVertexOAuth?.clientConfigured ? (
                      <a href="/auth/vertex/start?personal=1" className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">{t("settings.general.vertexConnect")}</a>
                    ) : (
                      <span className="text-xs text-gray-500">{t("settings.general.vertexOauthClientRequired")}</span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-gray-500">{t("settings.general.vertexOauthRedirectUri").replace("{url}", typeof window === "undefined" ? "/auth/vertex/callback" : `${window.location.origin}/auth/vertex/callback`)}</p>
                </div>
              </div>
            )}
            {/* Model — the API key tab's selector is unmounted here, and the
                model decides how fast the prepaid balance drains, so the
                choice has to be reachable from this tab too. Only models the
                budget can be charged for are offered. */}
            <div className="mb-4">
              <Label htmlFor="vertexSelectedModel">{t("settings.general.defaultModel")}</Label>
              <select
                id="vertexSelectedModel"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as ModelType)}
                className={inputClass}
              >
                <option value="">{t("settings.general.usePlanDefault")} ({getDefaultModelForPlan(apiPlan)})</option>
                {vertexModels.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.displayName} -- {m.description}
                  </option>
                ))}
              </select>
            </div>
            {personalVertexSource === "prepaid" && <>
            {/* Balance */}
            <div className="mb-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t("settings.general.vertexBalance")}</span>
                <span className={`text-lg font-bold ${hasVertexBalance ? "text-gray-900 dark:text-gray-100" : "text-red-600 dark:text-red-400"}`}>
                  {personalBalance == null
                    ? "—"
                    : personalBalance < 0
                      ? `-$${Math.abs(personalBalance).toFixed(2)}`
                      : `$${personalBalance.toFixed(2)}`}
                </span>
              </div>
              {!hasVertexBalance && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                  {t("settings.general.vertexBalanceEmpty")}
                </p>
              )}
            </div>
            {/* Top-up form — one amount dropdown. The currency follows the UI
                language rather than asking, which made a two-dropdown form out
                of a single choice. */}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input form="vertex-topup" type="hidden" name="plan" value="personal-vertex-topup" />
              <input form="vertex-topup" type="hidden" name="currency" value={topUpCurrency} />
              <select form="vertex-topup" name="units" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900" defaultValue="1">
                {VERTEX_TOPUP_UNIT_CHOICES.map((n) => (
                  <option key={n} value={n}>{formatTopUpAmount(n)}</option>
                ))}
              </select>
              <button form="vertex-topup" type="submit" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                {t("settings.general.buyVertexCredit")}
              </button>
            </div>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              {t("settings.general.vertexTopupCreditNote")}
            </p>
            {/* Purchase history */}
            {topupHistory && topupHistory.length > 0 && (
              <details className="rounded-lg border border-gray-200 dark:border-gray-700">
                <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300">
                  {t("settings.general.purchaseHistory")}
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="p-2">{t("settings.general.historyDate")}</th>
                        <th className="p-2">{t("settings.general.historyAmount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topupHistory.map((event) => (
                        <tr key={event.id} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="p-2 text-gray-600 dark:text-gray-400">
                            {new Date(event.createdAt).toLocaleString(language === "ja" ? "ja-JP" : "en-US")}
                          </td>
                          <td className="p-2 font-medium">+${event.usd.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
            </>}
          </div>
        )}

        {aiTab === "vertex" && (
          <hr className="my-6 border-gray-200 dark:border-gray-700" />
        )}
        </>}

        {!showAi && <>
        <div className="mb-6 rounded-md border border-gray-200 p-4 dark:border-gray-700">
          <h3 className="mb-3 text-sm font-semibold">{t("settings.general.chatSettings")}</h3>
          <Label htmlFor="maxSavedChatHistories">{t("settings.general.maxSavedChatHistories")}</Label>
          <input
            id="maxSavedChatHistories"
            name="maxSavedChatHistories"
            type="number"
            min={0}
            step={1}
            value={maxSavedChatHistories}
            onChange={(e) => setMaxSavedChatHistories(Math.max(0, Number.parseInt(e.target.value, 10) || 0))}
            className={inputClass}
          />
          <p className="mb-3 text-xs text-gray-500">{t("settings.general.maxSavedChatHistoriesDescription")}</p>
          <Label htmlFor="manualChatSaveFolder">{t("settings.general.manualChatSaveFolder")}</Label>
          <input
            id="manualChatSaveFolder"
            name="manualChatSaveFolder"
            value={manualChatSaveFolder}
            onChange={(e) => setManualChatSaveFolder(e.target.value)}
            placeholder={t("settings.general.driveRoot")}
            className={inputClass}
          />
          <p className="text-xs text-gray-500">{t("settings.general.manualChatSaveFolderDescription")}</p>
        </div>

        <div className="mb-6">
          <Label htmlFor="okfRoot">{language === "ja" ? "OKFナレッジフォルダ" : "OKF knowledge folder"}</Label>
          <input id="okfRoot" name="okfRoot" defaultValue={settings.okfRoot || "Knowledge"} className={inputClass} />
        </div>

        <div className="mb-6">
          <Label htmlFor="systemPrompt">{t("settings.general.systemPrompt")}</Label>
          <textarea
            id="systemPrompt"
            name="systemPrompt"
            rows={4}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder={t("settings.general.systemPromptPlaceholder")}
            className={inputClass + " resize-y"}
          />
        </div>

        {/* Show management folders */}
        <div className="mb-6 flex items-center gap-3">
          <input
            type="checkbox"
            id="showManagementFolders"
            name="showManagementFolders"
            checked={showManagementFolders}
            onChange={(e) => setShowManagementFolders(e.target.checked)}
            className={checkboxClass}
          />
          <div>
            <Label htmlFor="showManagementFolders">{t("settings.general.showManagementFolders")}</Label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("settings.general.showManagementFoldersDescription")}
            </p>
          </div>
        </div>

        {/* Optional advanced features */}
        <div className="mb-6 rounded-md border border-gray-200 p-4 dark:border-gray-700">
          <h3 className="mb-1 text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t("settings.general.advancedFeatures")}
          </h3>
          <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
            {t("settings.general.advancedFeaturesDescription")}
          </p>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="dashboardEnabled"
                name="dashboardEnabled"
                checked={dashboardEnabled}
                onChange={(e) => setDashboardEnabled(e.target.checked)}
                className={checkboxClass}
              />
              <div>
                <Label htmlFor="dashboardEnabled">{t("settings.general.enableDashboard")}</Label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("settings.general.enableDashboardDescription")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="workflowEnabled"
                name="workflowEnabled"
                checked={workflowEnabled}
                onChange={(e) => setWorkflowEnabled(e.target.checked)}
                className={checkboxClass}
              />
              <div>
                <Label htmlFor="workflowEnabled">{t("settings.general.enableWorkflow")}</Label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("settings.general.enableWorkflowDescription")}
                </p>
              </div>
            </div>
            <div className={`flex items-center gap-3 ${ragBlockedByVertex ? "opacity-60" : ""}`}>
              <input
                type="checkbox"
                id="ragFeatureEnabled"
                name="ragFeatureEnabled"
                checked={ragBlockedByVertex ? false : ragFeatureEnabled}
                disabled={ragBlockedByVertex}
                onChange={(e) => setRagFeatureEnabled(e.target.checked)}
                className={checkboxClass}
              />
              <div>
                <Label htmlFor="ragFeatureEnabled">{t("settings.general.enableRag")}</Label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {ragBlockedByVertex
                    ? (language === "ja" ? "RAGは有料プラン限定です。" : "RAG requires an active paid GemiHub plan.")
                    : t("settings.general.enableRagDescription")}
                </p>
              </div>
            </div>
            {SHOW_WEBPAGE_BUILDER ? (
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="webpageBuilderEnabled"
                name="webpageBuilderEnabled"
                checked={webpageBuilderEnabled}
                onChange={(e) => setWebpageBuilderEnabled(e.target.checked)}
                className={checkboxClass}
              />
              <div>
                <Label htmlFor="webpageBuilderEnabled">{t("settings.general.enableWebpageBuilder")}</Label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("settings.general.enableWebpageBuilderDescription")}
                </p>
              </div>
            </div>
            ) : (
              <input type="hidden" name="webpageBuilderEnabled" value={webpageBuilderEnabled ? "on" : ""} />
            )}
          </div>
        </div>

        <hr className="my-6 border-gray-200 dark:border-gray-700" />
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
          <Lock size={16} />
          {t("settings.general.encryptionSection")}
        </h3>

        {!hideGeminiSettings && <ProviderPasswordSettings settings={settings} />}

        <div className="mb-4">
          <Label htmlFor="secretManagerFolder">{t("secretManager.folder")}</Label>
          <input
            id="secretManagerFolder"
            name="secretManagerFolder"
            defaultValue={settings.secretManagerFolder ?? "Secrets"}
            required
            placeholder="Secrets"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("secretManager.folderHint")}</p>
        </div>

        <div className="mb-4 flex items-center gap-3">
          <input
            type="checkbox"
            id="encryptChatHistory"
            name="encryptChatHistory"
            checked={encryptChatHistory}
            onChange={(e) => setEncryptChatHistory(e.target.checked)}
            className={checkboxClass}
          />
          <Label htmlFor="encryptChatHistory">{t("settings.encryption.encryptChat")}</Label>
        </div>
        <div className="mb-6 flex items-center gap-3">
          <input
            type="checkbox"
            id="encryptWorkflowHistory"
            name="encryptWorkflowHistory"
            checked={encryptWorkflowHistory}
            onChange={(e) => setEncryptWorkflowHistory(e.target.checked)}
            className={checkboxClass}
          />
          <Label htmlFor="encryptWorkflowHistory">{t("settings.encryption.encryptWorkflow")}</Label>
        </div>

        <hr className="my-6 border-gray-200 dark:border-gray-700" />

        {/* Language */}
        <div className="mb-6">
          <Label htmlFor="language">{t("settings.general.language")}</Label>
          <select
            id="language"
            name="language"
            value={language}
            onChange={(e) => onLanguageChange(e.target.value as Language)}
            className={inputClass + " max-w-[300px]"}
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>

        {/* Font Size */}
        <div className="mb-6">
          <Label htmlFor="fontSize">{t("settings.general.fontSize")}</Label>
          <select
            id="fontSize"
            name="fontSize"
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value) as FontSize)}
            className={inputClass + " max-w-[300px]"}
          >
            {FONT_SIZE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Theme */}
        <div className="mb-6">
          <Label htmlFor="theme">{t("settings.general.theme")}</Label>
          <select
            id="theme"
            name="theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            className={inputClass + " max-w-[300px]"}
          >
            {THEME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        </>}

        <SaveButton loading={loading} />
      </fetcher.Form>
      {showAi && aiTab === "vertex" && personalVertexSource === "prepaid" && <form id="vertex-topup" method="POST" action="/hubwork/api/stripe/checkout" />}
      {!showAi && <details className="mt-6 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
        <summary className="cursor-pointer text-sm font-semibold text-gray-800 dark:text-gray-200">
          {language === "ja" ? "第三者ライセンス通知" : "Third-party notices"}
        </summary>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-600 dark:text-gray-400">
          {THIRD_PARTY_NOTICES}
        </pre>
      </details>}
    </SectionCard>
  );
}

export function AiProvidersTab(props: Omit<Parameters<typeof GeneralTab>[0], "section">) {
  return <GeneralTab {...props} section="ai" />;
}
