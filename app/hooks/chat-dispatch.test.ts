import assert from "node:assert/strict";
import test from "node:test";
import { availableChatModels } from "./chat-dispatch";
import { DEFAULT_USER_SETTINGS, getAvailableModels, isExternalChatModel, type UserSettings } from "~/types/settings";
import { VERTEX_MODELS } from "~/services/ai/models";

const configured: UserSettings = {
  ...DEFAULT_USER_SETTINGS,
  openai: { encryptedApiKey: "cipher", salt: "salt", enabledModels: ["gpt-6.1-sol", "gpt-6.1-terra"], availableModels: [] },
  compatibleProviders: {
    openrouter: { encryptedApiKey: "cipher", salt: "salt", enabledModels: ["vendor/first", "vendor/second"], availableModels: [] },
    opencodego: { encryptedApiKey: "cipher", salt: "salt", enabledModels: ["glm-5.3"], availableModels: [] },
  },
};

test("chat only offers the active provider even when every provider has saved credentials", () => {
  for (const apiPlan of ["free", "paid"] as const) {
    for (const [selectedModel, expected] of [
      ["gpt-6.1-terra", ["gpt-6.1-sol", "gpt-6.1-terra"]],
      ["openrouter:vendor/second", ["openrouter:vendor/first", "openrouter:vendor/second"]],
      ["opencodego:glm-5.3", ["opencodego:glm-5.3"]],
    ] as const) {
      const settings = { ...configured, apiPlan, selectedModel };
      assert.deepEqual(availableChatModels(null, apiPlan, settings).map((model) => model.name), expected);
    }
    const gemini = { ...configured, apiPlan, selectedModel: getAvailableModels(apiPlan)[0].name };
    assert.deepEqual(availableChatModels(null, apiPlan, gemini), getAvailableModels(apiPlan));
    assert.deepEqual(availableChatModels(null, apiPlan, { ...gemini, selectedModel: null }), getAvailableModels(apiPlan));
  }
});

test("an active provider with no enabled models or credentials has no cross-provider fallback", () => {
  const openai: UserSettings = { ...configured, selectedModel: "gpt-6.1-terra", openai: { ...configured.openai!, enabledModels: [] } };
  assert.deepEqual(availableChatModels(null, "paid", openai), []);
  assert.deepEqual(availableChatModels(null, "paid", { ...openai, openai: undefined }), []);
  for (const provider of ["openrouter", "opencodego"] as const) {
    const settings: UserSettings = { ...configured, selectedModel: `${provider}:missing`, compatibleProviders: { ...configured.compatibleProviders, [provider]: { ...configured.compatibleProviders![provider]!, enabledModels: [] } } };
    assert.deepEqual(availableChatModels(null, "paid", settings), []);
    assert.deepEqual(availableChatModels(null, "paid", { ...settings, compatibleProviders: {} }), []);
  }
});

test("personal Vertex and organization projects keep Gemini/Vertex model restrictions", () => {
  const settings: UserSettings = { ...configured, selectedModel: "gpt-6.1-terra", usePersonalVertex: true };
  const personal = availableChatModels(null, "paid", settings);
  assert.ok(personal.length > 0);
  assert.ok(personal.every((model) => !isExternalChatModel(model.name)));
  const allowed = Object.values(VERTEX_MODELS)[0];
  const project = { projectId: "project", orgId: "org", allowedModels: [allowed, "gpt-6.1-terra"] };
  assert.deepEqual(availableChatModels(project, "free", configured).map((model) => model.name), [allowed]);
  assert.equal(availableChatModels({ ...project, allowedModels: [] }, "free", configured).length, Object.values(VERTEX_MODELS).length);
});
