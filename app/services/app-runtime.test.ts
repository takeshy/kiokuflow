import assert from "node:assert/strict";
import test from "node:test";
import { applyRuntimeSettings, isLocalRuntime } from "./app-runtime.server";
import { isFirestoreAvailable, getFirestore } from "./firestore.server";
import { DEFAULT_USER_SETTINGS } from "~/types/settings";
import { KakerattaSettingsSchema } from "~/types/kakeratta";

test("standalone mode ignores ADC and config-only cloud settings; hosted execution is explicit", t => {
  const keys = ["KIOKUFLOW_RUNTIME", "K_SERVICE", "GCE_METADATA_HOST", "GCE_METADATA_IP", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  for (const key of keys) delete process.env[key];
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/configured/adc.json";
  process.env.GOOGLE_CLOUD_PROJECT = "development-project";
  assert.equal(isLocalRuntime(), true);
  assert.equal(isFirestoreAvailable(), false);
  assert.throws(getFirestore, /disabled in local mode/);
  process.env.K_SERVICE = "hosted-service";
  assert.equal(isLocalRuntime(), false);
  process.env.KIOKUFLOW_RUNTIME = "local";
  assert.equal(isLocalRuntime(), true);
  assert.equal(isFirestoreAvailable(), false);
  process.env.KIOKUFLOW_RUNTIME = "hosted";
  assert.equal(isLocalRuntime(), false);
  process.env.KIOKUFLOW_RUNTIME = "invalid";
  assert.throws(isLocalRuntime, /local or hosted/);
});

test("runtime capabilities hide hosted-only features without changing saved configuration", t => {
  const prior = process.env.KIOKUFLOW_RUNTIME;
  t.after(() => { if (prior === undefined) delete process.env.KIOKUFLOW_RUNTIME; else process.env.KIOKUFLOW_RUNTIME = prior; });
  const saved = { ...DEFAULT_USER_SETTINGS, usePersonalVertex: true, webpageBuilderEnabled: true, kakeratta: KakerattaSettingsSchema.parse({ enabled: true, timelineSync: { enabled: true } }) };
  process.env.KIOKUFLOW_RUNTIME = "local";
  const local = applyRuntimeSettings(saved);
  assert.equal(local.localMode, true);
  assert.equal(local.usePersonalVertex, false);
  assert.equal(local.webpageBuilderEnabled, false);
  assert.equal(local.kakeratta?.timelineSync.enabled, false);
  assert.equal(saved.usePersonalVertex, true);
  assert.equal(saved.kakeratta.timelineSync.enabled, true);
  process.env.KIOKUFLOW_RUNTIME = "hosted";
  assert.equal(applyRuntimeSettings({ ...saved, localMode: true }).localMode, false, "saved/client flags cannot grant local privileges in hosted mode");
  assert.equal(applyRuntimeSettings(saved).usePersonalVertex, true);
});
