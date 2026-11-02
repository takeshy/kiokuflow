import {
  ArrowLeft,
  Building2,
  Database,
  Globe,
  Keyboard,
  KeyRound,
  Puzzle,
  Plug,
  RefreshCw,
  Server,
  Settings as SettingsIcon,
  Terminal,
} from "lucide-react";
import { ProviderPasswords } from "~/components/settings/ProviderPasswords";
import { BlueskyIcon } from "~/components/bluesky/BlueskyIcon";
import { BlueskyTab } from "~/components/settings/BlueskyTab";
import { CommandsTab } from "~/components/settings/CommandsTab";
import { EnterpriseTab } from "~/components/settings/EnterpriseTab";
import { GeneralTab, AiProvidersTab } from "~/components/settings/GeneralTab";
import { HubworkTab } from "~/components/settings/HubworkTab";
import { KakerattaTab } from "~/components/settings/KakerattaTab";
import { McpTab } from "~/components/settings/McpTab";
import { PluginsTab } from "~/components/settings/PluginsTab";
import { RagTab } from "~/components/settings/RagTab";
import { ShortcutsTab } from "~/components/settings/ShortcutsTab";
import { SyncTab } from "~/components/settings/SyncTab";
import type { ComponentType } from "react";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useI18n } from "~/i18n/context";
import { useEnterpriseSelection } from "~/contexts/EnterpriseContext";
import type { TranslationStrings } from "~/i18n/translations";
import type { Language, UserSettings } from "~/types/settings";

import { settingsTabGroup, type SettingsTabId } from "~/utils/settings-tabs";
export { isSettingsTabId, type SettingsTabId } from "~/utils/settings-tabs";

const TABS: {
  id: SettingsTabId;
  labelKey: keyof TranslationStrings;
  icon: ComponentType<{ size?: number }>;
  desktopOnly?: boolean;
}[] = [
  { id: "ai", labelKey: "settings.tab.ai", icon: KeyRound },
  { id: "general", labelKey: "settings.tab.general", icon: SettingsIcon },
  { id: "enterprise", labelKey: "settings.tab.enterprise", icon: Building2 },
  { id: "sync", labelKey: "settings.tab.sync", icon: RefreshCw },
  { id: "integrations", labelKey: "settings.tab.integrations", icon: Plug },
  { id: "mcp", labelKey: "settings.tab.mcp", icon: Server },
  { id: "rag", labelKey: "settings.tab.rag", icon: Database },
  { id: "commands", labelKey: "settings.tab.actions", icon: Terminal },
  { id: "plugins", labelKey: "settings.tab.plugins", icon: Puzzle },
  { id: "hubwork", labelKey: "settings.tab.hubwork", icon: Globe },
];

function SettingsSubTabs({ group, tabs, value, onSelect }: { group: string; tabs: { id: SettingsTabId; label: string; icon: ComponentType<{ size?: number }> }[]; value: SettingsTabId; onSelect: (tab: SettingsTabId) => void }) {
  return <div role="tablist" aria-label={group} className="mb-5 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700" onKeyDown={event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const elements = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const index = elements.findIndex(element => element === document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? elements.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + elements.length) % elements.length;
    event.preventDefault(); elements[next]?.focus(); elements[next]?.click();
  }}>{tabs.map(tab => <button key={tab.id} type="button" role="tab" id={`settings-subtab-${tab.id}`} aria-controls={`settings-panel-${tab.id}`} aria-selected={value === tab.id} tabIndex={value === tab.id ? 0 : -1} onClick={() => onSelect(tab.id)} className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${value === tab.id ? "border-blue-500 font-medium text-blue-600 dark:text-blue-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"}`}><tab.icon size={16} />{tab.label}</button>)}</div>;
}

export interface SettingsTemplateProps {
  settings: UserSettings;
  hasApiKey: boolean;
  hasUnsupportedRagApiKey?: boolean;
  maskedKey: string | null;
  rootFolderId: string;
  activeTab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
  onBack: () => void;
  onLanguageChange: (lang: Language) => void;
  hubworkCallback?: boolean;
  showEnterpriseTab: boolean;
  enterpriseError?: string | null;
  legacyMigrationAvailable?: boolean;
}

/**
 * Presentational settings screen shared by the authenticated route and
 * Storybook. All server/session concerns stay outside this template.
 */
export function SettingsTemplate({
  settings,
  hasApiKey,
  hasUnsupportedRagApiKey = false,
  maskedKey,
  rootFolderId,
  activeTab,
  onTabChange,
  onBack,
  onLanguageChange,
  hubworkCallback = false,
  showEnterpriseTab,
  enterpriseError = null,
  legacyMigrationAvailable = false,
}: SettingsTemplateProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const mainTab = settingsTabGroup(activeTab);
  const integrationTab = activeTab === "bluesky" ? "bluesky" : "kakeratta";
  const actionTab = activeTab === "shortcuts" && !isMobile ? "shortcuts" : "commands";
  const organizationSelected = useEnterpriseSelection() !== null;
  const showSelectedEnterpriseTab = showEnterpriseTab && organizationSelected;
  // The Stripe billing portal (i.e. the only cancellation path) lives in the
  // Hubwork tab, so a subscriber keeps the tab even while an organization is
  // selected. Plain members of someone else's org have no plan and no tab.
  const showHubworkTab = !!settings.hubwork?.plan || !organizationSelected;
  const orgFilteredTabs = TABS.filter((tab) => {
    if (tab.id === "enterprise") return showSelectedEnterpriseTab;
    if (tab.id === "hubwork") return showHubworkTab;
    if (tab.id === "rag") return settings.ragFeatureEnabled ?? false;
    return true;
  });
  const visibleTabs = isMobile
    ? orgFilteredTabs.filter((tab) => !tab.desktopOnly)
    : orgFilteredTabs;

  return (
    <ProviderPasswords key={`${rootFolderId}:${organizationSelected ? "org" : "drive"}`}><div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t("settings.title")}</h1>
        </div>
      </header>

      <div className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto max-w-5xl px-4">
          <nav className="scrollbar-hide flex gap-1 overflow-x-auto" aria-label="Settings tabs">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = mainTab === tab.id;
              return (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => { if (mainTab !== tab.id) onTabChange(tab.id); }}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-xs font-medium transition-colors sm:gap-2 sm:px-4 sm:text-sm ${
                    isActive
                      ? "border-blue-500 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  }`}
                >
                  <Icon size={16} />
                  {t(tab.id === "commands" && isMobile ? "settings.tab.commands" : tab.labelKey)}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-4 sm:py-8">
        {legacyMigrationAvailable && <a href="/settings/migration" className="mb-5 block rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
          {settings.language === "ja" ? "旧環境からの引き継ぎ — kiokuflow.netへのデータ移行を確認する" : "Bring your existing workspace — review your move to kiokuflow.net"}
        </a>}
        {activeTab === "ai" && (organizationSelected ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
            <p className="mb-3 text-sm">{t("settings.ai.organizationProvider")}</p>
            <button type="button" onClick={() => onTabChange("enterprise")} className="rounded bg-blue-600 px-4 py-2 text-sm text-white">{t("settings.tab.enterprise")}</button>
          </div>
        ) : <AiProvidersTab onOpenGeneral={() => onTabChange("general")} settings={settings} hasApiKey={hasApiKey} maskedKey={maskedKey} onLanguageChange={onLanguageChange} />)}
        {activeTab === "general" && (
          <GeneralTab
            settings={settings}
            hasApiKey={hasApiKey}
            maskedKey={maskedKey}
            onLanguageChange={onLanguageChange}
            hideGeminiSettings={organizationSelected}
          />
        )}
        {activeTab === "enterprise" && (
          <>
            {enterpriseError && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-medium">{t("settings.enterprise.lookupFailed")}</p>
                <p className="mt-1 break-all font-mono text-xs">{enterpriseError}</p>
              </div>
            )}
            {showSelectedEnterpriseTab && <EnterpriseTab />}
          </>
        )}
        {activeTab === "sync" && <SyncTab settings={settings} />}
        {mainTab === "integrations" && <>
          <SettingsSubTabs group={t("settings.tab.integrations")} value={integrationTab} onSelect={onTabChange} tabs={[{ id: "kakeratta", label: t("settings.tab.kakeratta"), icon: Server }, { id: "bluesky", label: t("settings.tab.bluesky"), icon: BlueskyIcon }]} />
          <div role="tabpanel" id={`settings-panel-${integrationTab}`} aria-labelledby={`settings-subtab-${integrationTab}`}>{integrationTab === "kakeratta" ? <KakerattaTab settings={settings} /> : <BlueskyTab />}</div>
        </>}
        {activeTab === "mcp" && <McpTab settings={settings} />}
        {activeTab === "rag" && (settings.ragFeatureEnabled ?? false) && (
          <RagTab settings={settings} disabledByApiKey={hasUnsupportedRagApiKey} />
        )}
        {mainTab === "commands" && <>
          <SettingsSubTabs group={t("settings.tab.actions")} value={actionTab} onSelect={onTabChange} tabs={[{ id: "commands" as const, label: t("settings.tab.commands"), icon: Terminal }, ...(!isMobile ? [{ id: "shortcuts" as const, label: t("settings.tab.shortcuts"), icon: Keyboard }] : [])]} />
          <div role="tabpanel" id={`settings-panel-${actionTab}`} aria-labelledby={`settings-subtab-${actionTab}`}>{actionTab === "commands" ? <CommandsTab settings={settings} /> : <ShortcutsTab settings={settings} />}</div>
        </>}
        {activeTab === "plugins" && <PluginsTab settings={settings} />}
        {activeTab === "hubwork" && showHubworkTab && (
          <HubworkTab
            settings={settings}
            rootFolderId={rootFolderId}
            isCallback={hubworkCallback}
          />
        )}
      </main>
    </div></ProviderPasswords>
  );
}
