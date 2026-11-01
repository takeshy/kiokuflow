import assert from "node:assert/strict";
import test from "node:test";
import { preserveOtherSettingsSection } from "./settings-form-sections";
import { DEFAULT_USER_SETTINGS } from "~/types/settings";

test("saving AI credentials preserves custom general settings and encryption options", () => {
  const settings = { ...DEFAULT_USER_SETTINGS, systemPrompt: "Custom instructions", maxSavedChatHistories: 250, manualChatSaveFolder: "Chats/archive", theme: "dark" as const, dashboardEnabled: true, ragFeatureEnabled: true, encryption: { ...DEFAULT_USER_SETTINGS.encryption, encryptChatHistory: true } };
  const form = new FormData();
  form.set("settingsSection", "ai");
  form.set("selectedModel", "gpt-6.1-sol");
  form.set("usePersonalVertex", "");
  preserveOtherSettingsSection(form, settings);
  assert.equal(form.get("selectedModel"), "gpt-6.1-sol");
  assert.equal(form.get("systemPrompt"), "Custom instructions");
  assert.equal(form.get("maxSavedChatHistories"), "250");
  assert.equal(form.get("manualChatSaveFolder"), "Chats/archive");
  assert.equal(form.get("theme"), "dark");
  assert.equal(form.get("dashboardEnabled"), "on");
  assert.equal(form.get("ragFeatureEnabled"), "on");
  assert.equal(form.get("encryptChatHistory"), "on");
});

test("saving general settings preserves the user's own Vertex connection and permits disabling features", () => {
  const settings = { ...DEFAULT_USER_SETTINGS, usePersonalVertex: true, personalVertexSource: "own" as const, personalVertexProjectId: "customer-project", personalVertexLocation: "us-central1", dashboardEnabled: true };
  const form = new FormData();
  form.set("settingsSection", "general");
  form.set("systemPrompt", "Updated instructions");
  preserveOtherSettingsSection(form, settings);
  assert.equal(form.get("usePersonalVertex"), "on");
  assert.equal(form.get("personalVertexSource"), "own");
  assert.equal(form.get("personalVertexProjectId"), "customer-project");
  assert.equal(form.get("personalVertexLocation"), "us-central1");
  assert.equal(form.get("systemPrompt"), "Updated instructions");
  assert.equal(form.has("dashboardEnabled"), false);
  assert.equal(form.has("geminiApiKey"), false);
});

test("legacy settings submissions retain their original form semantics", () => {
  const form = new FormData();
  form.set("selectedModel", "gemini-3.8-flash");
  preserveOtherSettingsSection(form, DEFAULT_USER_SETTINGS);
  assert.deepEqual([...form], [["selectedModel", "gemini-3.8-flash"]]);
});
