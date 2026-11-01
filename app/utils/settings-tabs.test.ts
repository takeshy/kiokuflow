import assert from "node:assert/strict";
import test from "node:test";
import { isSettingsTabId, settingsTabGroup } from "./settings-tabs";

test("existing integration and shortcut deep links select their grouped navigation", () => {
  for (const tab of ["integrations", "kakeratta", "bluesky", "commands", "shortcuts"] as const) assert.equal(isSettingsTabId(tab), true);
  assert.equal(settingsTabGroup("kakeratta"), "integrations");
  assert.equal(settingsTabGroup("bluesky"), "integrations");
  assert.equal(settingsTabGroup("shortcuts"), "commands");
  assert.equal(settingsTabGroup("commands"), "commands");
  assert.equal(isSettingsTabId("unknown"), false);
  assert.equal(isSettingsTabId(null), false);
});

test("unrelated settings keep their original navigation identities", () => {
  for (const tab of ["ai", "general", "enterprise", "sync", "mcp", "rag", "plugins", "hubwork"] as const) assert.equal(settingsTabGroup(tab), tab);
});
