export interface ManualCaptureEntry {
  fileName: string;
  chapter: string;
  storyId?: string;
}

/**
 * Source of truth for replacing every image referenced by the manual with a
 * deterministic Storybook capture. Entries without storyId are visible work,
 * not silently treated as covered.
 */
export const MANUAL_CAPTURES: ManualCaptureEntry[] = [
  { fileName: "cap.png", chapter: "intro/layout", storyId: "templates-ide-scenes--overview" },
  { fileName: "chat_rag.png", chapter: "chat/rag", storyId: "templates-ide-scenes--chat" },
  { fileName: "chat_rag_en.png", chapter: "chat/rag (English)", storyId: "templates-ide-scenes--chat-english" },
  { fileName: "conflict.png", chapter: "sync", storyId: "templates-ide-scenes--conflict" },
  { fileName: "conflict_en.png", chapter: "sync (English)", storyId: "templates-ide-scenes--conflict-english" },
  { fileName: "dashboard.png", chapter: "dashboard", storyId: "templates-ide-scenes--dashboard" },
  { fileName: "dashboard_en.png", chapter: "dashboard (English)", storyId: "templates-ide-scenes--dashboard-english" },
  { fileName: "dashboard_calendar.png", chapter: "dashboard (local calendar)", storyId: "templates-calendar-launcher--calendar" },
  { fileName: "dashboard_calendar_en.png", chapter: "dashboard (English)", storyId: "templates-calendar-launcher--calendar-english" },
  { fileName: "editor.png", chapter: "editor", storyId: "templates-ide-scenes--overview" },
  { fileName: "editor_diff.png", chapter: "editor", storyId: "templates-ide-scenes--diff" },
  { fileName: "editor_diff_en.png", chapter: "editor (English)", storyId: "templates-ide-scenes--diff-english" },
  { fileName: "external_skills.png", chapter: "plugins", storyId: "templates-settings--plugins-english" },
  { fileName: "organization_dashboard.png", chapter: "organization", storyId: "templates-ide-scenes--organization-dashboard" },
  { fileName: "organization_dashboard_en.png", chapter: "organization (English)", storyId: "templates-ide-scenes--organization-dashboard-english" },
  { fileName: "organization_general.png", chapter: "organization", storyId: "templates-settings--general-organization-project" },
  { fileName: "organization_general_en.png", chapter: "organization (English)", storyId: "templates-settings--general-organization-project-english" },
  { fileName: "organization_settings.png", chapter: "organization", storyId: "templates-settings--enterprise-organization-project" },
  { fileName: "organization_settings_en.png", chapter: "organization (English)", storyId: "templates-settings--enterprise-organization-project-english" },
  { fileName: "organization_sync.png", chapter: "organization", storyId: "templates-settings--sync-organization-project" },
  { fileName: "organization_sync_en.png", chapter: "organization (English)", storyId: "templates-settings--sync-organization-project-english" },
  { fileName: "organization_workflow.png", chapter: "organization", storyId: "templates-ide-scenes--organization-workflow" },
  { fileName: "organization_workflow_en.png", chapter: "organization (English)", storyId: "templates-ide-scenes--organization-workflow-english" },
  { fileName: "pull_diff.png", chapter: "sync", storyId: "templates-ide-scenes--pull-changes" },
  { fileName: "pull_diff_en.png", chapter: "sync (English)", storyId: "templates-ide-scenes--pull-changes-english" },
  { fileName: "push_pull.png", chapter: "sync", storyId: "templates-ide-scenes--push-changes" },
  { fileName: "push_pull_en.png", chapter: "sync (English)", storyId: "templates-ide-scenes--push-changes-english" },
  { fileName: "rag_search.png", chapter: "search", storyId: "templates-ide-scenes--search" },
  { fileName: "rag_search_en.png", chapter: "search (English)", storyId: "templates-ide-scenes--search-english" },
  { fileName: "setting_command.png", chapter: "settings", storyId: "templates-settings--commands" },
  { fileName: "setting_command_en.png", chapter: "settings (English)", storyId: "templates-settings--commands-english" },
  { fileName: "setting_general.png", chapter: "settings", storyId: "templates-settings--general" },
  { fileName: "setting_general_en.png", chapter: "settings (English)", storyId: "templates-settings--general-english" },
  { fileName: "setting_mcp.png", chapter: "settings", storyId: "templates-settings--mcp" },
  { fileName: "setting_mcp_en.png", chapter: "settings (English)", storyId: "templates-settings--mcp-english" },
  { fileName: "setting_plugin.png", chapter: "settings", storyId: "templates-settings--plugins" },
  { fileName: "setting_plugin_en.png", chapter: "settings (English)", storyId: "templates-settings--plugins-english" },
  { fileName: "setting_rag.png", chapter: "settings", storyId: "templates-settings--rag" },
  { fileName: "setting_rag_en.png", chapter: "settings (English)", storyId: "templates-settings--rag-english" },
  { fileName: "setting_shortcut.png", chapter: "settings", storyId: "templates-settings--shortcuts" },
  { fileName: "setting_shortcut_en.png", chapter: "settings (English)", storyId: "templates-settings--shortcuts-english" },
  { fileName: "setting_sync.png", chapter: "settings", storyId: "templates-settings--sync" },
  { fileName: "setting_sync_en.png", chapter: "settings (English)", storyId: "templates-settings--sync-english" },
  { fileName: "visual_workflow.png", chapter: "workflow", storyId: "templates-ide-scenes--workflow" },
  { fileName: "visual_workflow_en.png", chapter: "workflow (English)", storyId: "templates-ide-scenes--workflow-english" },
  { fileName: "workflow_execution.png", chapter: "workflow", storyId: "templates-ide-scenes--execution-result" },
  { fileName: "workflow_execution_en.png", chapter: "workflow (English)", storyId: "templates-ide-scenes--execution-result-english" },
];

export const coveredManualCaptureCount = MANUAL_CAPTURES.filter((entry) => entry.storyId).length;
