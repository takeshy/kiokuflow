import { z } from "zod";
import type { UserSettings } from "~/types/settings";
import type { SessionTokens } from "./session.server";
import { discoverOpenAIModels } from "./openai.server";
import { compatibleSessionId, discoverCompatibleModels } from "./compatible-provider.server";
import { encryptApiKeyWithPublicKey } from "./api-key-crypto";
import { jevDecide } from "./jev-rag.server";

const draft = z.object({ apiKey: z.string().max(1024).refine(value => !/[\r\n]/.test(value)), enabledModels: z.array(z.string().min(1).max(256)).max(500), useOpenRouter: z.boolean().optional() });
const schema = z.object({ openai: draft.optional(), openrouter: draft.optional(), opencodego: draft.optional(), jev: draft.optional() }).strict();

/** Prepare all providers before any write: one failed check must not partially save the form. */
export async function prepareProviderSettingsSave(settings: UserSettings, tokens: SessionTokens, serialized: FormDataEntryValue | null, signal?: AbortSignal) {
  const keys = { openaiApiKey: tokens.openaiApiKey, jevApiKey: tokens.jevApiKey, compatibleApiKeys: { ...tokens.compatibleApiKeys } };
  if (!serialized) return { settings, keys };
  let value: unknown;
  try { value = typeof serialized === "string" ? JSON.parse(serialized) : null; } catch { throw new Error("Invalid provider settings."); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid provider settings.");
  if (tokens.currentProjectId && Object.keys(parsed.data).length) throw new Error("Select My Drive to edit provider keys.");
  const next = { ...settings, compatibleProviders: { ...settings.compatibleProviders } };
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
  const encrypt = async (key: string) => {
    if (!settings.encryption.publicKey) throw new Error("一般設定で暗号化用の鍵を作成してください。 / Create encryption keys in General first.");
    return encryptApiKeyWithPublicKey(key, settings.encryption.publicKey);
  };
  const requireKey = (key: string | undefined, provider: string) => {
    if (!key?.trim()) throw new Error(`${provider}: APIキーを入力するか、一般設定でロック解除してください。 / Enter the key or unlock it in General.`);
    return key.trim();
  };
  try {
    if (parsed.data.openai) {
      const value = parsed.data.openai;
      const key = requireKey(value.apiKey || keys.openaiApiKey, "OpenAI");
      const models = await discoverOpenAIModels(key, boundedSignal);
      const available = new Set(models.map(model => model.id));
      const enabledModels = [...new Set(value.enabledModels)];
      if (enabledModels.some(id => !available.has(id))) throw new Error("OpenAI: 選択モデルが利用できません。一覧を再取得してください。 / Refresh the model catalogue.");
      const encrypted = value.apiKey || !settings.openai ? await encrypt(key) : settings.openai;
      next.openai = { ...encrypted, availableModels: models, enabledModels };
      keys.openaiApiKey = key;
    }
    // Prepare Router before Jev so both connections can be configured in one Save.
    for (const provider of ["openrouter", "opencodego"] as const) {
      const value = parsed.data[provider]; if (!value) continue;
      const key = requireKey(value.apiKey || keys.compatibleApiKeys[provider], provider);
      const models = await discoverCompatibleModels(provider, key, compatibleSessionId(tokens.rootFolderId, "settings-save"), boundedSignal);
      const available = new Set(models.map(model => model.id));
      const enabledModels = [...new Set(value.enabledModels)];
      if (enabledModels.some(id => !available.has(id))) throw new Error(`${provider}: 選択モデルが利用できません。一覧を再取得してください。 / Refresh the model catalogue.`);
      const previous = settings.compatibleProviders?.[provider];
      const encrypted = value.apiKey || !previous ? await encrypt(key) : previous;
      next.compatibleProviders[provider] = { ...encrypted, availableModels: models, enabledModels };
      keys.compatibleApiKeys[provider] = key;
    }
    if (parsed.data.jev) {
      const value = parsed.data.jev;
      const useOpenRouter = value.useOpenRouter ?? settings.jev?.useOpenRouter ?? false;
      if (useOpenRouter && !next.compatibleProviders.openrouter?.encryptedApiKey) throw new Error("OpenRouterのAPIキーを設定してください。 / Configure an OpenRouter key first.");
      const key = requireKey(useOpenRouter ? keys.compatibleApiKeys.openrouter : value.apiKey || keys.jevApiKey, useOpenRouter ? "OpenRouter (Jev)" : "Jev");
      const answers = await jevDecide({ apiKey: key, useOpenRouter }, "接続確認", { check: { type: "choice", instructions: "接続確認です。keepを選択してください。", criteria: { keep: "接続確認", exclude: "その他" } } }, undefined, boundedSignal);
      if (answers.check.choice !== "keep") throw new Error("Jev connection verification failed.");
      next.jev = { ...settings.jev, ...(!useOpenRouter && (value.apiKey || !settings.jev?.encryptedApiKey) ? await encrypt(key) : {}), useOpenRouter };
      if (!useOpenRouter) keys.jevApiKey = key;
    }
  } catch (error) {
    if (error instanceof Response) {
      const body = await error.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error || `Provider verification failed: HTTP ${error.status}`);
    }
    throw error;
  }
  return { settings: next, keys };
}
