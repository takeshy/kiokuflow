import assert from "node:assert/strict";
import test from "node:test";
import { getSettings, clearSettingsCache } from "./user-settings.server";
import { DEFAULT_USER_SETTINGS } from "~/types/settings";
import { SETTINGS_FILE_NAME } from "./sync-diff";

test("scoped settings writes read current Drive data and fail closed on read errors", async t => {
  clearSettingsCache();
  t.after(clearSettingsCache);
  let root = "Knowledge";
  let unavailable = false;
  let missing = false;
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requests++;
    const url = new URL(String(input));
    assert.equal(url.hostname, "www.googleapis.com");
    if (unavailable) return Response.json({ error: { message: "Drive denied" } }, { status: 403 });
    if (url.searchParams.get("alt") === "media") return Response.json({ ...DEFAULT_USER_SETTINGS, okfRoot: root });
    return Response.json({ files: missing ? [] : [{ id: "settings-file", name: SETTINGS_FILE_NAME, mimeType: "application/json" }] });
  });
  assert.equal((await getSettings("synthetic", "fixture-root")).okfRoot, "Knowledge");
  const cachedReads = requests;
  root = "UpdatedElsewhere";
  assert.equal((await getSettings("synthetic", "fixture-root")).okfRoot, "Knowledge");
  assert.equal(requests, cachedReads, "ordinary reads retain the cache");
  assert.equal((await getSettings("synthetic", "fixture-root", { fresh: true })).okfRoot, "UpdatedElsewhere");
  assert.ok(requests > cachedReads);
  unavailable = true;
  await assert.rejects(getSettings("synthetic", "fixture-root", { fresh: true }), /403/);
  unavailable = false;
  missing = true;
  await assert.rejects(getSettings("synthetic", "fixture-root", { fresh: true }), /not found/);
  assert.equal((await getSettings("synthetic", "fixture-root")).okfRoot, "UpdatedElsewhere", "failed fresh reads preserve the previous cache");
});
