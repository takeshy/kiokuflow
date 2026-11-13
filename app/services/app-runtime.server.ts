import type { UserSettings } from "~/types/settings";

/** Server configuration only. Never infer Premium access from a request host. */
export function isLocalRuntime(): boolean {
  const mode = process.env.KIOKUFLOW_RUNTIME;
  if (mode === "local") return true;
  if (mode === "hosted") return false;
  if (mode) throw new Error("KIOKUFLOW_RUNTIME must be local or hosted.");
  // GCP runtimes advertise their metadata endpoint. A developer's ADC alone
  // must never turn a standalone installation into the hosted service.
  return !(process.env.K_SERVICE || process.env.GCE_METADATA_HOST || process.env.GCE_METADATA_IP);
}

/** UI capabilities are transient; preserve the saved hosted configuration. */
export function applyRuntimeSettings(settings: UserSettings): UserSettings {
  const localMode = isLocalRuntime();
  return { ...settings, localMode, ...(localMode ? {
    usePersonalVertex: false, webpageBuilderEnabled: false,
    ...(settings.kakeratta ? { kakeratta: { ...settings.kakeratta, timelineSync: { ...settings.kakeratta.timelineSync, enabled: false } } } : {}),
  } : {}) };
}
