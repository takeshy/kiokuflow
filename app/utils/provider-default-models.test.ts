import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "~/types/settings";
import { activeSettingsProvider, getProviderDefaultModels, readProviderDefaultModels } from "./provider-default-models";

const configured: UserSettings = { ...DEFAULT_USER_SETTINGS, selectedModel: "gemini-3.8-flash", openai: { encryptedApiKey: "cipher", salt: "salt" }, compatibleProviders: { openrouter: { encryptedApiKey: "cipher", salt: "salt", enabledModels: ["vendor/model", "vendor/other"], availableModels: [] } } };

test("editing an inactive OpenAI default survives saving and reopening without switching the active provider", () => {
  const models = getProviderDefaultModels(configured);
  models.openai = "gpt-6.1-terra";
  const form = new FormData(); form.set("providerDefaultModels", JSON.stringify(models));
  const saved = { ...configured, providerDefaultModels: readProviderDefaultModels(form, configured) };
  assert.equal(saved.selectedModel, "gemini-3.8-flash"); assert.equal(activeSettingsProvider(saved), "apikey");
  assert.equal(getProviderDefaultModels(saved).openai, "gpt-6.1-terra");
  assert.equal(getProviderDefaultModels(saved).apikey, "gemini-3.8-flash");
});

test("switching the active provider uses its remembered model; legacy active models remain authoritative", () => {
  const settings = { ...configured, providerDefaultModels: { openai: "gpt-6.1-terra" as const } };
  const model = getProviderDefaultModels(settings).openai;
  const switched = { ...settings, selectedModel: model || null };
  assert.equal(activeSettingsProvider(switched), "openai"); assert.equal(getProviderDefaultModels(switched).openai, "gpt-6.1-terra");
  const legacy = { ...configured, selectedModel: "gpt-5.5" as const, providerDefaultModels: { openai: "gpt-6.1-sol" as const } };
  assert.equal(getProviderDefaultModels(legacy).openai, "gpt-5.5");
});

test("general and legacy forms preserve provider defaults, including providers not present in a partial submission", () => {
  const settings = { ...configured, providerDefaultModels: { openai: "gpt-6.1-terra" as const, openrouter: "openrouter:vendor/other" as const } };
  assert.deepEqual(readProviderDefaultModels(new FormData(), settings), settings.providerDefaultModels);
  const form = new FormData(); form.set("providerDefaultModels", JSON.stringify({ openai: "gpt-5.5" }));
  assert.deepEqual(readProviderDefaultModels(form, settings), { openai: "gpt-5.5", openrouter: "openrouter:vendor/other" });
});

test("provider default models reject wrong provider families, disabled compatible models and malformed maps", () => {
  for (const input of [null, [], { openai: "gemini-3.8-flash" }, { openai: "gpt-unknown-model" }, { openrouter: "opencodego:vendor/model" }, { openrouter: "openrouter:disabled/model" }, { apikey: "gpt-6.1-sol" }]) {
    const form = new FormData(); form.set("providerDefaultModels", JSON.stringify(input));
    assert.throws(() => readProviderDefaultModels(form, configured), /Invalid/);
  }
});

test("a disabled compatible model falls back to an enabled model while an unconfigured provider stays empty", () => {
  const settings = { ...configured, providerDefaultModels: { openrouter: "openrouter:removed/model" as const } };
  const defaults = getProviderDefaultModels(settings);
  assert.equal(defaults.openrouter, "openrouter:vendor/model"); assert.equal(defaults.opencodego, "");
});
