import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToolLauncher } from "~/components/ide/ToolLauncher";
import { I18nProvider } from "~/i18n/context";
import { setCachedFile, setCachedRemoteMeta } from "~/services/indexeddb-cache-drive";
import { buildEntryBlock, serializeMemoFile } from "~/dashboard/memo/memoTimeline";
import { SYSTEM_TIMELINE_ROOT, localDateKey } from "~/services/system-timeline";
import type { Language } from "~/types/settings";
import { settingsFixture } from "./settings.fixtures";

function CalendarLauncherScene({ language = "ja" }: { language?: Language }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const today = localDateKey();
      const now = new Date().toISOString();
      const name = `${SYSTEM_TIMELINE_ROOT}/${today}.md`;
      const content = serializeMemoFile("timeline", [buildEntryBlock({ id: "design-review", createdAt: now, body: `<!-- calendar-event: ${today} -->\n> [!calendar] Calendar event · ${today} 10:00\n> Design review / デザインレビュー` })]);
      await setCachedFile({ fileId: "calendar-notes", fileName: name, content, md5Checksum: "fixture", modifiedTime: now, cachedAt: Date.now() });
      await setCachedRemoteMeta({ id: "current", rootFolderId: "storybook-root", lastUpdatedAt: now, cachedAt: Date.now(), files: { "calendar-notes": { name, mimeType: "text/markdown", md5Checksum: "fixture", modifiedTime: now } } });
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const dayTimer = window.setTimeout(() => {
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === String(new Date().getDate()))
        ?.click();
    }, 500);
    return () => window.clearTimeout(dayTimer);
  }, [ready]);

  return (
    <I18nProvider language={language}>
      <main className="min-h-screen bg-slate-100 p-8 dark:bg-slate-950">
        {ready ? (
          <ToolLauncher
            open
            initialTool="calendar"
            encryptionSettings={settingsFixture.encryption}
            secretManagerFolder={settingsFixture.secretManagerFolder}
            onClose={() => undefined}
          />
        ) : null}
      </main>
    </I18nProvider>
  );
}

const meta = {
  title: "Templates/Calendar Launcher",
  component: CalendarLauncherScene,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CalendarLauncherScene>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Calendar: Story = {};
export const CalendarEnglish: Story = { args: { language: "en" } };
