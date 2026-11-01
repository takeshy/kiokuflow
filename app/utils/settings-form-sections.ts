import type { UserSettings } from "~/types/settings";

/** Keep fields owned by the other settings panel when submitting a partial form. */
export function preserveOtherSettingsSection(form: FormData, settings: UserSettings): void {
  const section = form.get("settingsSection");
  const setDefault = (key: string, value: unknown) => {
    if (!form.has(key)) form.set(key, value == null ? "" : String(value));
  };
  if (section === "ai") {
    for (const key of ["systemPrompt", "language", "fontSize", "theme", "maxSavedChatHistories", "manualChatSaveFolder", "secretManagerFolder", "okfRoot"] as const) setDefault(key, settings[key]);
    for (const key of ["showManagementFolders", "dashboardEnabled", "workflowEnabled", "ragFeatureEnabled", "webpageBuilderEnabled"] as const) setDefault(key, settings[key] ? "on" : "");
    setDefault("encryptChatHistory", settings.encryption.encryptChatHistory ? "on" : "");
    setDefault("encryptWorkflowHistory", settings.encryption.encryptWorkflowHistory ? "on" : "");
  } else if (section === "general") {
    setDefault("apiPlan", settings.apiPlan);
    setDefault("selectedModel", settings.selectedModel);
    setDefault("usePersonalVertex", settings.usePersonalVertex ? "on" : "");
    setDefault("personalVertexSource", settings.personalVertexSource || "prepaid");
    setDefault("personalVertexProjectId", settings.personalVertexProjectId || "");
    setDefault("personalVertexLocation", settings.personalVertexLocation || "global");
  }
}
