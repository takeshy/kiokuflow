import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RAG_SETTING, DEFAULT_USER_SETTINGS, DEFAULT_RAG_STORE_KEY, type RagSetting, type UserSettings } from "~/types/settings";
import { prepareRagIndexSave, prepareRagIndexDeletion, prepareOkfSettingsSave } from "./rag-settings-save";

function fixture(): UserSettings {
  return structuredClone({ ...DEFAULT_USER_SETTINGS, okfRoot: "Knowledge", selectedRagSetting: "second", ragSettings: {
    first: { ...DEFAULT_RAG_SETTING, storeId: "first-handle", storeName: "first-handle", retiredIndexes: ["old-first"], topK: 5,
      files: { "latest.md": { status: "registered", uploadedAt: 42, checksum: "latest" } }, lastFullSync: 42 },
    second: { ...DEFAULT_RAG_SETTING, storeId: "second-handle", storeName: "second-handle", topK: 8 },
  } } as UserSettings);
}

test("saving one RAG preserves other settings and the latest server sync metadata", () => {
  const current = fixture();
  const before = structuredClone(current);
  const stale = { ...current.ragSettings.first, topK: 7, rerankProvider: "gemini", hybridSearch: false, searchUntilMatch: true,
    files: {}, storeId: "stale", storeName: "stale", retiredIndexes: ["injected"], lastFullSync: 1, targetFolders: [" Notes ", ""], excludePatterns: [] } as RagSetting;
  const { settings, setting } = prepareRagIndexSave(current, "first", "first", stale);
  assert.equal(settings.ragSettings.second, current.ragSettings.second);
  assert.equal(settings.okfRoot, "Knowledge");
  assert.equal(settings.selectedRagSetting, "second");
  assert.equal(settings.ragTopK, current.ragTopK);
  assert.equal(setting.files, current.ragSettings.first.files);
  assert.equal(setting.lastFullSync, 42);
  assert.equal(setting.storeId, "first-handle");
  assert.deepEqual(setting.retiredIndexes, ["old-first"]);
  assert.equal(setting.topK, 7);
  assert.equal(setting.rerankProvider, "gemini");
  assert.equal(setting.hybridSearch, false);
  assert.equal(setting.searchUntilMatch, true);
  assert.deepEqual(setting.targetFolders, ["Notes"]);
  assert.deepEqual(current, before);
});

test("independent saves merge into current settings despite stale drafts", () => {
  const original = fixture();
  const firstDraft = { ...original.ragSettings.first, topK: 10 };
  const secondDraft = { ...original.ragSettings.second, topK: 12, rerankProvider: "jev" as const };
  const first = prepareRagIndexSave(original, "first", "first", firstDraft).settings;
  const okf = prepareOkfSettingsSave(first, "NewKnowledge");
  const second = prepareRagIndexSave(okf, "second", "second", secondDraft).settings;
  assert.equal(second.ragSettings.first.topK, 10);
  assert.equal(second.ragSettings.second.topK, 12);
  assert.equal(second.ragSettings.second.rerankProvider, "jev");
  assert.equal(second.okfRoot, "NewKnowledge");
});

test("an invalid other RAG does not block this RAG or OKF", () => {
  const current = fixture();
  current.ragSettings.second.excludePatterns = ["["];
  const result = prepareRagIndexSave(current, "first", "first", { ...current.ragSettings.first, topK: 6 });
  assert.equal(result.settings.ragSettings.second, current.ragSettings.second);
  assert.equal(prepareOkfSettingsSave(current, "Other").okfRoot, "Other");
  assert.throws(() => prepareRagIndexSave(current, "second", "second", current.ragSettings.second), /Invalid exclusion/);
});

test("new and renamed RAGs preserve other indexes and reject collisions", () => {
  const current = fixture();
  const renamed = prepareRagIndexSave(current, "second", "renamed", current.ragSettings.second);
  assert.equal(renamed.settings.selectedRagSetting, "renamed");
  assert.equal(renamed.settings.ragSettings.first, current.ragSettings.first);
  assert.equal(renamed.setting.storeId, "second-handle");
  assert.equal(renamed.settings.ragSettings.second, undefined);
  const added = prepareRagIndexSave(current, "", "new", { ...DEFAULT_RAG_SETTING, files: current.ragSettings.first.files, storeId: "injected" });
  assert.deepEqual(added.setting.files, {});
  assert.equal(added.setting.storeId, null);
  assert.deepEqual(Object.keys(added.settings.ragSettings), ["first", "second", "new"]);
  assert.throws(() => prepareRagIndexSave(current, "first", "second", current.ragSettings.first), /already exists/);
  assert.throws(() => prepareRagIndexSave(current, "missing", "new", current.ragSettings.first), /not found/);
  assert.throws(() => prepareRagIndexSave(current, "", "__proto__", DEFAULT_RAG_SETTING), /valid index name/);
});

test("deletion removes only unshared handles of one RAG and keeps OKF", () => {
  const current = fixture();
  current.ragSettings.second.retiredIndexes = ["old-first"];
  const result = prepareRagIndexDeletion(current, "first");
  assert.deepEqual(result.removedIndexes, ["first-handle"]);
  assert.equal(result.settings.ragSettings.second, current.ragSettings.second);
  assert.equal(result.settings.selectedRagSetting, "second");
  assert.equal(result.settings.okfRoot, "Knowledge");
  assert.ok(current.ragSettings.first);
  assert.throws(() => prepareRagIndexDeletion(current, "missing"), /not found/);
});

test("automatic registration changes only when adding or deleting the built-in index", () => {
  const current = fixture();
  current.ragRegistrationOnPush = false;
  const added = prepareRagIndexSave(current, "", DEFAULT_RAG_STORE_KEY, DEFAULT_RAG_SETTING).settings;
  assert.equal(added.ragRegistrationOnPush, true);
  const other = prepareRagIndexSave(added, "first", "first", added.ragSettings.first).settings;
  assert.equal(other.ragRegistrationOnPush, true);
  assert.throws(() => prepareRagIndexSave(added, DEFAULT_RAG_STORE_KEY, "renamed", DEFAULT_RAG_SETTING), /cannot be renamed/);
  const deleted = prepareRagIndexDeletion(other, DEFAULT_RAG_STORE_KEY).settings;
  assert.equal(deleted.ragRegistrationOnPush, false);
  assert.equal(deleted.ragSettings.first, other.ragSettings.first);
});

test("OKF Save changes only its folder and validates relative paths", () => {
  const current = fixture();
  const result = prepareOkfSettingsSave(current, " /Knowledge/New/ ");
  assert.deepEqual(result, { ...current, okfRoot: "Knowledge/New" });
  assert.equal(result.ragSettings, current.ragSettings);
  assert.equal(prepareOkfSettingsSave(current, " / ").okfRoot, "Knowledge");
  assert.throws(() => prepareOkfSettingsSave(current, "Knowledge/../Secrets"), /Invalid OKF/);
});
