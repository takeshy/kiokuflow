import { isLocalRuntime, applyRuntimeSettings } from "~/services/app-runtime.server";
import { publicDefaultDomain } from "~/services/hubwork-accounts.server";
import { readProviderDefaultModels } from "~/utils/provider-default-models";
import { useState, useEffect } from "react";
import { normalizeSecretFolder } from "~/dashboard/secret-manager";
import { data, redirect, useLoaderData, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/settings";
import { requireAuth, getSession, commitSession, setTokens } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { resolveLanguage } from "~/i18n/resolve-language";
import { rebuildSyncMeta } from "~/services/sync-meta.server";
import { ENCRYPTED_AUTH_FILE_NAME } from "~/services/sync-diff";
import { validateMcpServerUrl } from "~/services/url-validator.server";
import { KakerattaSettingsSchema, getKakerattaRagError } from "~/types/kakeratta";
import { getOwnedPersonalAccount } from "~/services/personal-hubwork-account.server";
import { validateKakerattaUrl, stopKakerattaPoll } from "~/services/kakeratta.server";
import { GoogleGenAI } from "@google/genai";
import type {
  UserSettings,
  McpServerConfig,
  RagSetting,
  ApiPlan,
  Language,
  FontSize,
  Theme,
  ShortcutKeyBinding,
  HubworkSchedule,
} from "~/types/settings";
import {
  normalizeMcpServers,
  normalizeSelectedMcpServerIds,
  normalizeDeprecatedModelName,
  getDefaultModelForPlan,
  isModelAllowedForPlan,
} from "~/types/settings";
import { I18nProvider } from "~/i18n/context";
import { useApplySettings } from "~/hooks/useApplySettings";
import { getLocalPlugins } from "~/services/local-plugins.server";
import { updateSettingsEncryption } from "~/services/settings-encryption.server";
import { prepareProviderSettingsSave } from "~/services/provider-settings-save.server";
import { createProviderSettingsDrafts } from "~/services/provider-settings-drafts";
import { validateOrigin } from "~/utils/security";
import { buildEncryptedAuthFile, encodeMigrationToken } from "kiokuflow-sync-core/auth";
import { EnterpriseProvider } from "~/contexts/EnterpriseContext";
import type { EnterpriseSessionContext } from "~/types/enterprise";
import { PluginProvider } from "~/contexts/PluginContext";
import { isActivePremiumAccount } from "~/types/hubwork";
import { resolveSubmittedGeminiApiKey } from "~/utils/settings-api-key";
import { preserveOtherSettingsSection } from "~/utils/settings-form-sections";
import { driveMigrationSummary } from "~/services/drive-migration.server";
import { assertRagAccess, canUseRag } from "~/services/rag-access.server";
import { prepareRagIndexSave, prepareRagIndexDeletion, prepareOkfSettingsSave } from "~/services/rag-settings-save";
import {
  SettingsTemplate,
  isSettingsTabId,
  type SettingsTabId,
} from "~/templates/SettingsTemplate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskApiKey(key: string): string {
  if (key.length <= 8) return "***";
  return key.slice(0, 4) + "***" + key.slice(-4);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  // Tokenless org sessions have no Drive-backed settings to load yet.
  if (!tokens.accessToken) {
    throw redirect("/login?workspace=pending");
  }
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const driveSettings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);

  let hubworkAccount: Awaited<ReturnType<typeof import("~/services/hubwork-accounts.server").getAccountByRootFolderId>> = null;
  let hubworkLookupSucceeded = !isLocalRuntime();
  if (!isLocalRuntime()) try {
    const { getAccountByOrganization, getAccountByRootFolderId, getAccountByEmail } = await import("~/services/hubwork-accounts.server");
    hubworkAccount = validTokens.currentOrgId
      ? await getAccountByOrganization(validTokens.currentOrgId)
      : await getAccountByRootFolderId(validTokens.rootFolderId);
    // Also try matching by email for accounts created via Stripe/admin before user enabled
    if (!validTokens.currentOrgId && !hubworkAccount && validTokens.email) {
      hubworkAccount = await getAccountByEmail(validTokens.email);
    }
  } catch (error) {
    hubworkLookupSucceeded = false;
    console.warn("[settings] Failed to load Hubwork account from Firestore:", describeError(error));
  }

  // Ensure session identity and refresh token for Hubwork accounts without downgrading stored scopes.
  if (hubworkLookupSucceeded) {
    const personalAccount = await getOwnedPersonalAccount(validTokens).catch(() => null);
    if (personalAccount?.plan) {
      const { updateRefreshToken, updateAccount, encryptGeminiApiKey } = await import("~/services/hubwork-accounts.server");
      const updates: Parameters<typeof updateAccount>[1] = {};
      if (
        validTokens.rootFolderId &&
        personalAccount.rootFolderId !== validTokens.rootFolderId
      ) {
        updates.rootFolderId = validTokens.rootFolderId;
      }
      const kakerattaEnabled = isActivePremiumAccount(personalAccount) && driveSettings.kakeratta?.enabled === true && (driveSettings.kakeratta.pollEnabled !== false || driveSettings.kakeratta.timelineSync?.enabled === true);
      if (personalAccount.kakerattaEnabled !== kakerattaEnabled) updates.kakerattaEnabled = kakerattaEnabled;
      if (kakerattaEnabled && validTokens.geminiApiKey) updates.encryptedGeminiApiKey = encryptGeminiApiKey(validTokens.geminiApiKey);
      if (Object.keys(updates).length > 0) {
        await updateAccount(personalAccount.id, updates).catch(() => {});
      }

      if (validTokens.refreshToken) {
        await updateRefreshToken(personalAccount.id, validTokens.refreshToken).catch(() => {});
      }
    }
  }
  const settings = applyRuntimeSettings({
    ...driveSettings,
    ragAvailable: await canUseRag(validTokens.rootFolderId),
    hubwork: hubworkAccount?.plan
      ? {
          ...driveSettings.hubwork,
          accountId: hubworkAccount.id,
          orgId: hubworkAccount.orgId,
          plan: hubworkAccount.plan,
          currency: hubworkAccount.currency,
          accountSlug: hubworkAccount.accountSlug,
          defaultDomain: publicDefaultDomain(hubworkAccount),
          customDomain: hubworkAccount.customDomain || driveSettings.hubwork?.customDomain,
          billingStatus: hubworkAccount.billingStatus,
          accountStatus: hubworkAccount.accountStatus,
          domainStatus: hubworkAccount.domainStatus || driveSettings.hubwork?.domainStatus,
        }
      : driveSettings.hubwork,
  });

  // Persist plan/billingStatus into Drive settings.json so _index loader can
  // read it without querying Firestore on every page load.
  if (hubworkAccount?.plan && driveSettings.hubwork) {
    const drivePlan = driveSettings.hubwork.plan;
    const driveBilling = driveSettings.hubwork.billingStatus;
    const driveCurrency = driveSettings.hubwork.currency;
    if (drivePlan !== hubworkAccount.plan || driveBilling !== hubworkAccount.billingStatus || driveCurrency !== hubworkAccount.currency) {
      const updatedHubwork = {
        ...driveSettings.hubwork,
        plan: hubworkAccount.plan,
        currency: hubworkAccount.currency,
        billingStatus: hubworkAccount.billingStatus,
      };
      saveSettings(validTokens.accessToken, validTokens.rootFolderId, {
        ...driveSettings,
        hubwork: updatedHubwork,
      }).catch(() => {});
    }
  } else if (hubworkLookupSucceeded && !hubworkAccount?.plan && driveSettings.hubwork?.plan) {
    // Clean up stale plan from Drive settings when Firestore account no longer exists
    const { plan: _stale, billingStatus: _staleBilling, ...rest } = driveSettings.hubwork;
    saveSettings(validTokens.accessToken, validTokens.rootFolderId, {
      ...driveSettings,
      hubwork: Object.keys(rest).length > 0 ? rest : undefined,
    }).catch(() => {});
  }

  // Organizations: resolve the enterprise selection and whether the user
  // belongs to any org. Gated on isFirestoreAvailable so self-hosted /
  // credential-less environments never touch Firestore.
  let enterprise: EnterpriseSessionContext = {
    uid: null,
    email: null,
    currentOrgId: null,
    currentProjectId: null,
    selection: null,
    selectionStatus: "no-session",
  };
  let hasOrganizations = false;
  // Non-null when Firestore is configured but the lookup failed (most often a
  // missing collection-group index). Shown to users who are entitled to the
  // organization tab, so the cause is visible instead of the tab silently
  // vanishing — never to ordinary users, who have nothing to do with orgs.
  let enterpriseError: string | null = null;
  try {
    const { isFirestoreAvailable } = await import("~/services/firestore.server");
    if (isFirestoreAvailable()) {
      const { resolveEnterpriseContext } = await import("~/services/enterprise-context.server");
      enterprise = await resolveEnterpriseContext(request);
      if (enterprise.uid) {
        const { listAccessibleOrganizationsForUser } = await import("~/services/projects.server");
        const { isSuperAdmin } = await import("~/services/super-admin.server");
        hasOrganizations =
          isSuperAdmin(enterprise.email ?? undefined) ||
          (await listAccessibleOrganizationsForUser(enterprise.uid)).length > 0;
      }
    }
  } catch (error) {
    enterpriseError = describeError(error);
    console.warn("[settings] Failed to resolve enterprise context:", enterpriseError);
  }

  // The organization tab belongs to Business (and granted) accounts, plus
  // anyone who already belongs to an org — an invited member is on their own
  // plan, so plan alone must not gate them out — plus service admins.
  const businessAccount =
    !!hubworkAccount &&
    hubworkAccount.accountStatus === "enabled" &&
    (hubworkAccount.plan === "business" || hubworkAccount.plan === "granted");
  const { isSuperAdmin: isServiceAdmin } = await import("~/services/super-admin.server");
  const showEnterpriseTab =
    hasOrganizations || businessAccount || isServiceAdmin(validTokens.email);

  // Merge local plugins (dev only)
  const localPlugins = getLocalPlugins();
  const localIds = new Set(localPlugins.map((p) => p.id));
  const mergedPlugins = [
    ...localPlugins,
    ...(settings.plugins || []).filter((p) => !localIds.has(p.id)),
  ];
  const mergedSettings = { ...settings, plugins: mergedPlugins };
  const acceptLanguage = request.headers.get("Accept-Language");
  const effectiveLanguage = resolveLanguage(mergedSettings.language, acceptLanguage);

  return data(
    {
      settings: { ...mergedSettings, language: effectiveLanguage },
      hasApiKey: !!validTokens.geminiApiKey,
      hasUnsupportedRagApiKey: false,
      maskedKey: validTokens.geminiApiKey ? maskApiKey(validTokens.geminiApiKey) : null,
      rootFolderId: validTokens.rootFolderId,
      enterprise,
      hasOrganizations,
      showEnterpriseTab,
      enterpriseError: showEnterpriseTab ? enterpriseError : null,
      legacyMigrationAvailable: !!(await driveMigrationSummary(validTokens)),
    },
    { headers: setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined }
  );
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  // Build a base session that already includes refreshed tokens (if any).
  // Action cases that modify the session should build on top of this.
  const baseSession = setCookieHeader
    ? await setTokens(request, validTokens)
    : await getSession(request);
  const jsonWithCookie = async (data: unknown, init: ResponseInit = {}) => {
    const headers = new Headers(init.headers);
    // If tokens were refreshed but no action-specific Set-Cookie was provided,
    // commit the base session so refreshed tokens are persisted.
    if (setCookieHeader && !headers.has("Set-Cookie")) {
      headers.set("Set-Cookie", await commitSession(baseSession));
    }
    return Response.json(data, { ...init, headers });
  };
  const formData = await request.formData();
  const _action = formData.get("_action") as string;
  const scopedRagSave = ["saveRagIndex", "deleteRagIndex", "saveOkf"].includes(_action);
  if (scopedRagSave) validateOrigin(request);
  try {
    const currentSettings = await getSettings(validTokens.accessToken, validTokens.rootFolderId, { fresh: scopedRagSave });
    switch (_action) {
      case "saveKakeratta": {
        const config = KakerattaSettingsSchema.parse(JSON.parse(String(formData.get("kakeratta") ?? "{}")));
        if (isLocalRuntime() && currentSettings.kakeratta) config.timelineSync = currentSettings.kakeratta.timelineSync;
        validateKakerattaUrl(config);
        if (!isLocalRuntime() && config.enabled && config.timelineSync.enabled) {
          const account = await getOwnedPersonalAccount(validTokens);
          if (!account || !isActivePremiumAccount(account)) return jsonWithCookie({ success: false, message: "Timeline synchronization requires your own active Premium plan." }, { status: 403 });
        }
        const previousSync = currentSettings.kakeratta?.timelineSync;
        config.timelineSync.enabledAt = config.timelineSync.enabled
          ? previousSync?.enabled && previousSync.name === config.timelineSync.name ? previousSync.enabledAt : new Date().toISOString()
          : previousSync?.enabledAt ?? "";
        const ragError = getKakerattaRagError(config, isLocalRuntime() ? { ...currentSettings, usePersonalVertex: false } : currentSettings);
        if (ragError) return jsonWithCookie({ success: false, message: ragError }, { status: 400 });
        stopKakerattaPoll(validTokens.rootFolderId);
        const { activateDirectConnection } = await import("~/services/kakeratta-direct-store.server");
        await activateDirectConnection(validTokens.rootFolderId, config.url, config.headers);
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, { ...currentSettings, kakeratta: config });
        const { isFirestoreAvailable } = await import("~/services/firestore.server");
        if (isFirestoreAvailable()) {
          const { updateAccount, updateRefreshToken, encryptGeminiApiKey } = await import("~/services/hubwork-accounts.server");
          const account = await getOwnedPersonalAccount(validTokens);
          if (account && isActivePremiumAccount(account)) {
            if (config.enabled && (config.pollEnabled || config.timelineSync.enabled) && validTokens.refreshToken) await updateRefreshToken(account.id, validTokens.refreshToken);
            await updateAccount(account.id, {
              rootFolderId: validTokens.rootFolderId,
              kakerattaEnabled: config.enabled && (config.pollEnabled || config.timelineSync.enabled),
              ...(config.enabled && validTokens.geminiApiKey ? { encryptedGeminiApiKey: encryptGeminiApiKey(validTokens.geminiApiKey) } : {}),
            });
          }
        }
        return jsonWithCookie({ success: true, message: "Kakeratta settings saved." });
      }
      case "saveGeneral": {
        if (formData.has("providerDrafts")) validateOrigin(request);
        preserveOtherSettingsSection(formData, currentSettings);
        const apiPlan = (formData.get("apiPlan") as ApiPlan) || currentSettings.apiPlan;
        // GeneralTab hides the whole Gemini block (the model <select> included)
        // on an organization mount, so an absent field means "not editable
        // here", not "cleared". Without the fallback, saving any other General
        // setting from an org mount would silently reset the user's chosen
        // model to the plan default below.
        const selectedModel = formData.has("selectedModel")
          ? normalizeDeprecatedModelName(formData.get("selectedModel")) ?? null
          : normalizeDeprecatedModelName(currentSettings.selectedModel) ?? null;
        const systemPrompt = (formData.get("systemPrompt") as string) || "";
        // Password managers may autofill the API-key password input when the user
        // only intends to save another setting (for example, the default model).
        // For an existing setup, only treat the field as an API-key change after
        // the user explicitly edited it in this form.
        const apiKeyEdited = formData.get("apiKeyEdited") === "true";
        const geminiApiKey = resolveSubmittedGeminiApiKey(
          formData.get("geminiApiKey"),
          !!currentSettings.encryptedApiKey,
          apiKeyEdited,
        );
        const language = (formData.get("language") as Language) || currentSettings.language;
        const fontSize = Number(formData.get("fontSize")) as FontSize || currentSettings.fontSize;
        const theme = (formData.get("theme") as Theme) || currentSettings.theme || "system";
        const showManagementFolders = formData.get("showManagementFolders") === "on";
        const maxSavedChatHistories = Math.max(0, Number.parseInt(String(formData.get("maxSavedChatHistories") ?? "100"), 10) || 0);
        const manualChatSaveFolder = String(formData.get("manualChatSaveFolder") ?? "").trim().replace(/^\/+|\/+$/g, "");
        if (manualChatSaveFolder.split("/").some((part) => part === "." || part === "..")) {
          return jsonWithCookie({ success: false, message: "Invalid manual chat save folder" });
        }
        const secretManagerFolder = normalizeSecretFolder(String(formData.get("secretManagerFolder") ?? currentSettings.secretManagerFolder ?? "Secrets"));
        if (formData.has("secretManagerFolder") && !secretManagerFolder) {
          return jsonWithCookie({ success: false, message: language === "ja"
            ? "シークレットフォルダを指定してください。"
            : "Specify a secrets folder." });
        }
        const okfRoot = String(formData.get("okfRoot") ?? currentSettings.okfRoot ?? "Knowledge").trim().replace(/^\/+|\/+$/g, "") || "Knowledge";
        if (okfRoot.split("/").some((part) => part === "." || part === "..")) return jsonWithCookie({ success: false, message: "Invalid OKF folder" });
        const dashboardEnabled = formData.get("dashboardEnabled") === "on";
        const workflowEnabled = formData.get("workflowEnabled") === "on";
        const ragFeatureEnabled = formData.get("ragFeatureEnabled") === "on";
        if (ragFeatureEnabled && !currentSettings.ragFeatureEnabled) await assertRagAccess(validTokens.rootFolderId);
        const webpageBuilderEnabled = isLocalRuntime() ? currentSettings.webpageBuilderEnabled : formData.get("webpageBuilderEnabled") === "on";
        // Same absent-vs-cleared distinction as selectedModel above: the whole
        // AI provider block is hidden on an org mount, so a missing field
        // means "not editable here". Reading it as false would turn personal
        // Vertex off every time an org member saved an unrelated setting.
        const usePersonalVertex = isLocalRuntime() ? currentSettings.usePersonalVertex === true : formData.has("usePersonalVertex")
          ? formData.get("usePersonalVertex") === "on"
          : currentSettings.usePersonalVertex === true;
        const personalVertexSource = formData.get("personalVertexSource") === "own" ? "own" : "prepaid";
        const personalVertexProjectId = ((formData.get("personalVertexProjectId") as string) || "").trim();
        const personalVertexLocation = ((formData.get("personalVertexLocation") as string) || "global").trim();
        const vertexResourcePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
        if (personalVertexSource === "own" && (!vertexResourcePattern.test(personalVertexProjectId) || !vertexResourcePattern.test(personalVertexLocation))) {
          return jsonWithCookie({ success: false, message: "invalidPersonalVertexSettings" });
        }

        // Encryption-related fields
        const password = (formData.get("password") as string) || "";
        const confirmPassword = (formData.get("confirmPassword") as string) || "";
        const currentPassword = (formData.get("currentPassword") as string) || "";
        const newPassword = (formData.get("newPassword") as string) || "";
        const encryptChatHistory = formData.get("encryptChatHistory") === "on";
        const encryptWorkflowHistory = formData.get("encryptWorkflowHistory") === "on";

        // Validate API key by calling Gemini API
        if (geminiApiKey) {
          try {
            const ai = new GoogleGenAI({ apiKey: geminiApiKey });
            const validationModel = getDefaultModelForPlan(apiPlan);
            await ai.models.get({ model: validationModel });
          } catch {
            return jsonWithCookie({ success: false, message: "invalidApiKey" });
          }
        }

        const updatedSettings: UserSettings = {
          ...currentSettings,
          apiPlan,
          providerDefaultModels: currentSettings.providerDefaultModels,
          selectedModel: selectedModel && isModelAllowedForPlan(apiPlan, selectedModel, !!currentSettings.openai?.encryptedApiKey, currentSettings.compatibleProviders, currentSettings.openai)
            ? selectedModel
            : getDefaultModelForPlan(apiPlan),
          systemPrompt,
          language,
          fontSize,
          theme,
          showManagementFolders,
          maxSavedChatHistories,
          manualChatSaveFolder,
          secretManagerFolder,
          okfRoot,
          dashboardEnabled,
          workflowEnabled,
          ragFeatureEnabled,
          webpageBuilderEnabled,
          usePersonalVertex,
          personalVertexSource,
          personalVertexProjectId,
          personalVertexLocation,
        };

        // Update file encryption toggles
        updatedSettings.encryption = {
          ...updatedSettings.encryption,
          encryptChatHistory,
          encryptWorkflowHistory,
        };

        let effectiveApiKey: string;
        try {
          const encrypted = await updateSettingsEncryption(currentSettings, {
            geminiApiKey, password, confirmPassword, currentPassword, newPassword,
          });
          effectiveApiKey = encrypted.effectiveApiKey;
          updatedSettings.encryptedApiKey = encrypted.encryptedApiKey;
          updatedSettings.apiKeySalt = encrypted.apiKeySalt;
          updatedSettings.openai = encrypted.openai;
          updatedSettings.jev = encrypted.jev;
          updatedSettings.compatibleProviders = encrypted.compatibleProviders;
          updatedSettings.encryption = {
            ...encrypted.encryption, encryptChatHistory, encryptWorkflowHistory,
          };
        } catch (error) {
          return jsonWithCookie({ success: false, message: describeError(error) });
        }

        const providers = await prepareProviderSettingsSave(updatedSettings, validTokens, formData.get("providerDrafts"), request.signal);
        Object.assign(updatedSettings, providers.settings);
        updatedSettings.selectedModel = selectedModel && isModelAllowedForPlan(apiPlan, selectedModel, !!updatedSettings.openai?.encryptedApiKey, updatedSettings.compatibleProviders, updatedSettings.openai)
          ? selectedModel : getDefaultModelForPlan(apiPlan);
        updatedSettings.providerDefaultModels = readProviderDefaultModels(formData, updatedSettings);

        // Validate cookie capacity before writing any provider changes to Drive.
        const nextSession = await setTokens(request, { ...validTokens, ...providers.keys, ...(effectiveApiKey ? { geminiApiKey: effectiveApiKey } : {}), apiPlan, selectedModel: updatedSettings.selectedModel });
        nextSession.set("language", language);
        const nextCookie = await commitSession(nextSession).catch(async error => {
          if (error instanceof Response) {
            const body = await error.json().catch(() => null) as { error?: string } | null;
            throw new Error(body?.error || "Could not save the provider session.");
          }
          throw error;
        });
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);

        if (effectiveApiKey) {
          // Refresh the encrypted API key in Hubwork Firestore only if the user
          // already has scheduled workflows (Scheduler needs it). When no
          // schedules exist, no copy is kept in Firestore.
          if (!isLocalRuntime() && (currentSettings.hubwork?.schedules?.length ?? 0) > 0) {
            try {
              const { updateAccount, encryptGeminiApiKey } = await import("~/services/hubwork-accounts.server");
              const hwAccount = await getOwnedPersonalAccount(validTokens);
              if (hwAccount && isActivePremiumAccount(hwAccount)) {
                await updateAccount(hwAccount.id, { encryptedGeminiApiKey: encryptGeminiApiKey(effectiveApiKey) });
              }
            } catch { /* best-effort */ }
          }
        }
        return jsonWithCookie(
          { success: true, message: "General settings saved.", apiKeyUpdated: !!effectiveApiKey, providerDrafts: createProviderSettingsDrafts(updatedSettings) },
          { headers: { "Set-Cookie": nextCookie } }
        );
      }

      case "saveMcp": {
        const mcpJson = formData.get("mcpServers") as string;
        let mcpServers: McpServerConfig[];
        try {
          mcpServers = mcpJson ? JSON.parse(mcpJson) : [];
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid MCP servers JSON." });
        }

        mcpServers = normalizeMcpServers(mcpServers);

        for (const server of mcpServers) {
          try {
            if (!server?.url || typeof server.url !== "string") {
              return jsonWithCookie({ success: false, message: "Each MCP server must include a valid URL." });
            }
            validateMcpServerUrl(server.url);
          } catch (error) {
            return jsonWithCookie({
              success: false,
              message: error instanceof Error
                ? `Invalid URL for MCP server "${server?.name || "unknown"}": ${error.message}`
                : "Invalid MCP server URL.",
            });
          }
        }

        const updatedSettings: UserSettings = { ...currentSettings, mcpServers };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        stopKakerattaPoll(validTokens.rootFolderId);
        return jsonWithCookie({ success: true, message: "MCP server settings saved." });
      }

      case "saveRagIndex": {
        await assertRagAccess(validTokens.rootFolderId);
        let prepared;
        try {
          prepared = prepareRagIndexSave(currentSettings,
            String(formData.get("originalName") ?? ""), String(formData.get("name") ?? ""),
            JSON.parse(String(formData.get("ragSetting") ?? "null")));
        } catch (error) {
          return jsonWithCookie({ success: false, message: describeError(error) });
        }
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, prepared.settings);
        return jsonWithCookie({ success: true, message: currentSettings.language === "ja" ? "保存しました。" : "Index settings saved.", ragSettingName: prepared.name, ragSetting: prepared.setting });
      }

      case "deleteRagIndex": {
        await assertRagAccess(validTokens.rootFolderId);
        let prepared;
        try { prepared = prepareRagIndexDeletion(currentSettings, String(formData.get("name") ?? "")); }
        catch (error) { return jsonWithCookie({ success: false, message: describeError(error) }); }
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, prepared.settings);
        // Remove chunks only after the scoped settings deletion succeeds.
        if (prepared.removedIndexes.length) {
          const { deleteStore } = await import("~/services/rag-index.server");
          for (const index of prepared.removedIndexes) {
            try { await deleteStore(index, validTokens.rootFolderId); }
            catch (error) { console.warn("[settings] Failed to delete RAG index:", describeError(error)); }
          }
        }
        return jsonWithCookie({ success: true, message: currentSettings.language === "ja" ? "削除しました。" : "Index deleted." });
      }

      case "saveOkf": {
        let updatedSettings;
        try { updatedSettings = prepareOkfSettingsSave(currentSettings, String(formData.get("okfRoot") ?? "")); }
        catch (error) { return jsonWithCookie({ success: false, message: describeError(error) }); }
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true, message: currentSettings.language === "ja" ? "保存しました。" : "Knowledge folder saved.", okfRoot: updatedSettings.okfRoot });
      }

      case "saveRag": {
        await assertRagAccess(validTokens.rootFolderId);
        const ragTopK = Math.min(20, Math.max(1, Number(formData.get("ragTopK")) || 5));
        const ragSettingsJson = formData.get("ragSettings") as string;
        let ragSettings: Record<string, RagSetting>;
        try {
          ragSettings = ragSettingsJson
            ? JSON.parse(ragSettingsJson)
            : currentSettings.ragSettings;
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid RAG settings JSON." });
        }
        const { embeddingConfig } = await import("~/services/rag-config");
        for (const setting of Object.values(ragSettings)) {
          const config = embeddingConfig(setting);
          setting.embeddingProvider = config.provider;
          setting.embeddingModel = config.model;
          setting.topK = Math.min(20, Math.max(1, Math.trunc(Number(setting.topK ?? currentSettings.ragTopK) || 5)));
          setting.jevRagFilterEnabled = setting.jevRagFilterEnabled !== false;
          setting.searchUntilMatch = setting.searchUntilMatch === true;
          setting.isExternal = false;
          setting.storeIds = [];
          setting.chunkSize = Math.max(100, Math.min(5000, Number(setting.chunkSize) || 1500));
          setting.chunkOverlap = Math.max(0, Math.min(setting.chunkSize - 1, Number(setting.chunkOverlap ?? 150) || 0));
        }
        const removedIndexes: string[] = [];
        for (const [name, old] of Object.entries(currentSettings.ragSettings)) {
          if (!ragSettings[name] && !Object.values(ragSettings).some((setting) => setting.storeName === old.storeName)) {
            for (const index of [old.storeName, ...(old.retiredIndexes || [])]) if (index) removedIndexes.push(index);
          }
        }
        const selectedRagSetting = (formData.get("selectedRagSetting") as string) || null;
        const ragRegistrationOnPush = formData.get("ragRegistrationOnPush") === "on";
        const okfRoot = ((formData.get("okfRoot") as string) || "").trim().replace(/^\/+|\/+$/g, "") || "Knowledge";

        const updatedSettings: UserSettings = {
          ...currentSettings,
          ragTopK,
          ragSettings,
          selectedRagSetting,
          ragRegistrationOnPush,
          okfRoot,
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        // Delete chunks only after settings no longer reference them, so a failed
        // save never leaves settings pointing at a deleted index.
        if (removedIndexes.length) {
          const { deleteStore } = await import("~/services/rag-index.server");
          for (const index of removedIndexes) {
            try { await deleteStore(index, validTokens.rootFolderId); }
            catch (error) { console.warn("[settings] Failed to delete RAG index:", describeError(error)); }
          }
        }
        return jsonWithCookie({ success: true, message: "RAG settings saved." });
      }



      case "saveCommands": {
        const commandsJson = formData.get("slashCommands") as string;
        let slashCommands;
        try {
          slashCommands = commandsJson ? JSON.parse(commandsJson) : [];
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid commands JSON." });
        }
        const normalizedMcpServers = normalizeMcpServers(currentSettings.mcpServers || []);
        const normalizedCommands = (slashCommands as typeof currentSettings.slashCommands).map((cmd) => ({
          ...cmd,
          model: normalizeDeprecatedModelName(cmd.model),
          enabledMcpServers: (() => {
            const normalizedIds = normalizeSelectedMcpServerIds(
              cmd.enabledMcpServers,
              normalizedMcpServers
            );
            return normalizedIds.length > 0 ? normalizedIds : null;
          })(),
        }));
        const updatedSettings: UserSettings = {
          ...currentSettings,
          mcpServers: normalizedMcpServers,
          slashCommands: normalizedCommands,
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true, message: "Command settings saved." });
      }

      case "rebuildTree": {
        await rebuildSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
        return jsonWithCookie({ success: true, message: "Sync meta rebuilt." });
      }

      case "saveShortcuts": {
        const shortcutsJson = formData.get("shortcutKeys") as string;
        let shortcutKeys: ShortcutKeyBinding[];
        try {
          shortcutKeys = shortcutsJson ? JSON.parse(shortcutsJson) : [];
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid shortcuts JSON." });
        }
        const updatedSettings: UserSettings = { ...currentSettings, shortcutKeys };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true, message: "Shortcut settings saved." });
      }

      case "generateMigrationToken": {
        let account: Awaited<ReturnType<typeof import("~/services/hubwork-accounts.server").getAccountByRootFolderId>> = null;
        if (!isLocalRuntime()) try {
          const { getAccountByRootFolderId, getAccountByEmail } = await import("~/services/hubwork-accounts.server");
          account = await getAccountByRootFolderId(validTokens.rootFolderId);
          if (!account && validTokens.email) {
            account = await getAccountByEmail(validTokens.email);
          }
        } catch (error) {
          console.warn("[settings] Failed to load Hubwork account for migration token:", describeError(error));
          return jsonWithCookie({ success: false, message: "Could not verify Premium plan for external sync tokens." }, { status: 503 });
        }
        // The token below carries THIS user's Drive access token and root
        // folder id, so it only ever syncs My Drive — refuse to mint one from
        // inside an organization project, where it would silently hand out
        // personal Drive access from a shared workspace.
        if (validTokens.currentOrgId && validTokens.currentProjectId) {
          return jsonWithCookie({ success: false, message: "External sync tokens are for My Drive. Switch to My Drive to generate one." }, { status: 400 });
        }
        // The entitlement follows the account that bought a plan, not the
        // organization someone belongs to: an org membership covers the shared
        // project, while syncing a personal Drive needs a personal Lite (or
        // Business) subscription of one's own.
        const entitled = isLocalRuntime() || (!!account && isActivePremiumAccount(account));
        if (!entitled) {
          return jsonWithCookie({ success: false, message: "A Premium plan is required to generate external sync tokens." }, { status: 403 });
        }

        // Generate external sync token (XOR-encoded accessToken + rootFolderId)
        const migrationToken = encodeMigrationToken({
          accessToken: validTokens.accessToken,
          rootFolderId: validTokens.rootFolderId,
        });

        // If encryption is set up, also export _encrypted-auth.json to Drive
        const enc = currentSettings.encryption;
        if (enc?.enabled && enc.publicKey && enc.encryptedPrivateKey && enc.salt) {
          const url = new URL(request.url);
          const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
          const apiOrigin = `${proto}://${url.host}`;
          const authFile = await buildEncryptedAuthFile(
            { refreshToken: validTokens.refreshToken, apiOrigin },
            { publicKey: enc.publicKey, encryptedPrivateKey: enc.encryptedPrivateKey, salt: enc.salt },
          );
          const authFileContent = JSON.stringify(authFile, null, 2);
          const { findFileByExactName, createFile, updateFile } = await import("~/services/google-drive.server");
          const existingFile = await findFileByExactName(
            validTokens.accessToken, ENCRYPTED_AUTH_FILE_NAME, validTokens.rootFolderId
          );
          if (existingFile) {
            await updateFile(validTokens.accessToken, existingFile.id, authFileContent, "application/json");
          } else {
            await createFile(
              validTokens.accessToken, ENCRYPTED_AUTH_FILE_NAME, authFileContent,
              validTokens.rootFolderId, "application/json"
            );
          }
        }

        return jsonWithCookie({
          success: true,
          migrationToken,
        });
      }

      case "hubwork-spreadsheet-labels": {
        // Merge labels into existing spreadsheets without changing the list.
        const labelsJson = formData.get("labels") as string;
        let labels: Record<string, string>;
        try {
          labels = JSON.parse(labelsJson || "{}");
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid labels data" });
        }
        const existingSS = currentSettings.hubwork?.spreadsheets || [];
        const updated = existingSS.map((s) => labels[s.id] ? { ...s, label: labels[s.id] } : s);
        const updatedSettings = {
          ...currentSettings,
          hubwork: { ...currentSettings.hubwork, spreadsheets: updated } as typeof currentSettings.hubwork,
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true, message: "Labels updated" });
      }

      case "hubwork-accounts": {
        const spreadsheetsJson = formData.get("spreadsheets") as string;
        const accountsJson = formData.get("accounts") as string;
        const newSpreadsheetId = formData.get("newSpreadsheetId") as string | null;
        let spreadsheets: import("~/types/settings").HubworkSpreadsheet[];
        let accounts: Record<string, import("~/types/settings").HubworkAccountType>;
        try {
          spreadsheets = JSON.parse(spreadsheetsJson || "[]");
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid spreadsheets data" });
        }
        try {
          accounts = JSON.parse(accountsJson || "{}");
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid accounts data" });
        }
        const validSpreadsheets = spreadsheets.filter((s) => s.id?.trim());
        // Preserve existing values only when the field was not sent at all.
        // An explicit empty value ([] or {}) means intentional deletion.
        const finalSpreadsheets = spreadsheetsJson != null ? validSpreadsheets : currentSettings.hubwork?.spreadsheets;
        let finalAccounts: Record<string, import("~/types/settings").HubworkAccountType> | undefined = accountsJson != null ? accounts : (currentSettings.hubwork?.accounts ?? {});

        // Auto-create "accounts" account type for a newly created spreadsheet
        if (newSpreadsheetId) {
          finalAccounts = {
            ...finalAccounts,
            accounts: { identity: { spreadsheetId: newSpreadsheetId, sheet: "accounts", emailColumn: "email" } },
          };
        }

        // Remove account types whose identity or data sources reference a deleted spreadsheet
        if (finalAccounts && finalSpreadsheets) {
          const ssIds = new Set(finalSpreadsheets.map((s) => s.id));
          const defaultSsId = finalSpreadsheets[0]?.id;
          const cleaned: Record<string, import("~/types/settings").HubworkAccountType> = {};
          for (const [key, at] of Object.entries(finalAccounts)) {
            const identityRef = at.identity.spreadsheetId || defaultSsId;
            if (!identityRef || !ssIds.has(identityRef)) continue;
            // Also strip data sources referencing deleted spreadsheets
            if (at.data) {
              const cleanedData: Record<string, import("~/types/settings").HubworkDataSource> = {};
              for (const [dk, ds] of Object.entries(at.data)) {
                const dsRef = ds.spreadsheetId || defaultSsId;
                if (dsRef && ssIds.has(dsRef)) cleanedData[dk] = ds;
              }
              at.data = Object.keys(cleanedData).length > 0 ? cleanedData : undefined;
            }
            cleaned[key] = at;
          }
          finalAccounts = Object.keys(cleaned).length > 0 ? cleaned : undefined;
        }
        const updatedSettings = {
          ...currentSettings,
          hubwork: {
            ...currentSettings.hubwork,
            spreadsheets: finalSpreadsheets,
            accounts: finalAccounts,
          } as typeof currentSettings.hubwork,
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true, message: "Account types saved" });
      }

      case "hubwork-schedules": {
        if (isLocalRuntime()) return jsonWithCookie({ success: false, message: "Scheduled workflows are unavailable in local mode." }, { status: 404 });
        const schedulesJson = formData.get("schedules") as string;
        let schedules: HubworkSchedule[];
        try {
          schedules = JSON.parse(schedulesJson || "[]");
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid schedules data" });
        }
        schedules = schedules.map((schedule) => ({
          ...schedule,
          concurrencyPolicy: schedule.concurrencyPolicy === "forbid" ? "forbid" : "allow",
        }));

        // When schedules are present, the Scheduler needs a server-side copy of
        // the Gemini API key. Require the key to be unlocked in this session so
        // that we can encrypt and persist it alongside the schedules.
        if (schedules.length > 0 && !validTokens.geminiApiKey) {
          return jsonWithCookie({ success: false, message: "scheduleApiKeyRequired" });
        }

        const updatedSettings = {
          ...currentSettings,
          hubwork: { ...currentSettings.hubwork, schedules } as typeof currentSettings.hubwork,
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);

        // Rebuild Firestore schedule index and synchronize the encrypted API
        // key with the new schedule count: write when schedules exist, delete
        // when none remain. accountId is not reliably in Drive settings (it's
        // injected by the loader), so resolve from Firestore directly via
        // rootFolderId or email.
        try {
          const { getAccountByRootFolderId, getAccountByEmail, rebuildScheduleIndex, updateAccount, encryptGeminiApiKey, clearEncryptedGeminiApiKey } = await import("~/services/hubwork-accounts.server");
          let hubworkAccount = await getAccountByRootFolderId(validTokens.rootFolderId);
          if (!hubworkAccount && validTokens.email) {
            hubworkAccount = await getAccountByEmail(validTokens.email);
          }
          if (hubworkAccount && (hubworkAccount.plan === "pro" || hubworkAccount.plan === "business" || hubworkAccount.plan === "granted")) {
            await rebuildScheduleIndex(hubworkAccount.id, schedules);
            if (schedules.length > 0 && validTokens.geminiApiKey) {
              await updateAccount(hubworkAccount.id, {
                encryptedGeminiApiKey: encryptGeminiApiKey(validTokens.geminiApiKey),
              });
            } else if (schedules.length === 0) {
              await clearEncryptedGeminiApiKey(hubworkAccount.id);
            }
          }
        } catch (e) {
          console.warn("[settings] Schedules saved to Drive, but failed to sync Firestore schedule index or encrypted API key:", e);
        }
        return jsonWithCookie({ success: true, message: "Schedules saved" });
      }

      case "saveHomeDashboard": {
        const homeDashboard = (formData.get("homeDashboard") as string) || null;
        const updatedSettings: UserSettings = {
          ...currentSettings,
          homeDashboard,
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true });
      }

      default:
        return jsonWithCookie({ success: false, message: "Unknown action." });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return jsonWithCookie({ success: false, message });
  }
}

// ---------------------------------------------------------------------------
// Client loader — apply localStorage language before render to avoid hydration mismatch
// ---------------------------------------------------------------------------

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  const data = await serverLoader();
  try {
    const ls = localStorage.getItem("gemihub-language");
    if ((ls === "ja" || ls === "en") && data.settings.language !== ls) {
      return { ...data, settings: { ...data.settings, language: ls as Language } };
    }
  } catch { /* localStorage unavailable */ }
  return data;
}

clientLoader.hydrate = true as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Settings() {
  const { settings, hasApiKey, hasUnsupportedRagApiKey, maskedKey, rootFolderId, enterprise, hasOrganizations, showEnterpriseTab, enterpriseError, legacyMigrationAvailable } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SettingsTabId>("ai");

  const [currentLang, setCurrentLang] = useState<Language>(settings.language ?? "en");
  useApplySettings(currentLang, settings.fontSize, settings.theme);

  const [hubworkCallback, setHubworkCallback] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Detect redirect return params. Use useSearchParams (router-aware) so that
  // client-side navigations (e.g. review-slug Pro activation, which redirects
  // same-route via fetcher.Form without remounting Settings) also trigger the
  // callback handling. Cleanup goes through setSearchParams — not
  // window.history.replaceState — so the Router's location stays in sync with
  // the real URL; otherwise a second same-query redirect would look like "no
  // change" to the Router and this effect would never re-fire.
  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (isSettingsTabId(requestedTab)) {
      setActiveTab(settings.localMode && (requestedTab === "hubwork" || requestedTab === "enterprise") ? "ai" : requestedTab);
    }
    if (searchParams.has("mcp-oauth-return")) {
      setActiveTab("mcp");
    }
    if (!settings.localMode && (searchParams.has("hubwork_subscribed") || searchParams.has("hubwork_upgraded"))) {
      setActiveTab("hubwork");
    }
    // Mirror the URL, so hubworkCallback clears on non-callback visits instead
    // of latching to true forever after the first callback.
    setHubworkCallback(searchParams.has("hubwork_subscribed"));

    const needsCleanup =
      searchParams.has("mcp-oauth-return") ||
      searchParams.has("hubwork_subscribed") ||
      searchParams.has("hubwork_upgraded");
    if (needsCleanup) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("mcp-oauth-return");
          next.delete("hubwork_subscribed");
          next.delete("hubwork_upgraded");
          return next;
        },
        { replace: true },
      );
    }
  }, [searchParams, setSearchParams, settings.localMode]);

  return (
    <EnterpriseProvider
      selection={enterprise.selection}
      currentOrgId={enterprise.currentOrgId}
      currentProjectId={enterprise.currentProjectId}
      currentUserId={enterprise.uid}
      currentUserEmail={enterprise.email}
      hasOrganizations={hasOrganizations}
    >
    <I18nProvider language={currentLang}>
      <PluginProvider pluginConfigs={settings.plugins || []} language={currentLang} hasPremium={settings.localMode || settings.hubwork?.plan === "business" || settings.hubwork?.plan === "granted"}>
        <SettingsTemplate
          settings={settings}
          hasApiKey={hasApiKey}
          hasUnsupportedRagApiKey={hasUnsupportedRagApiKey}
          maskedKey={maskedKey}
          rootFolderId={rootFolderId}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onBack={() => {
            const prev = document.referrer;
            if (prev && new URL(prev).origin === window.location.origin) {
              navigate(-1);
            } else {
              navigate("/");
            }
          }}
          onLanguageChange={setCurrentLang}
          hubworkCallback={hubworkCallback}
          showEnterpriseTab={showEnterpriseTab}
          enterpriseError={enterpriseError}
          legacyMigrationAvailable={legacyMigrationAvailable}
        />
      </PluginProvider>
    </I18nProvider>
    </EnterpriseProvider>
  );
}
