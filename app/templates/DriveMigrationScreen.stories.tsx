import type { Meta, StoryObj } from "@storybook/react-vite";
import { DriveMigrationScreen } from "~/components/settings/DriveMigrationScreen";

const meta = { title: "Settings/Legacy migration", component: DriveMigrationScreen, parameters: { layout: "fullscreen" },
  args: { language: "ja", summary: { status: "ready", prepared: false, total: 0, copied: 0, currentFile: null },
    running: false, error: null, onStart: () => undefined, onPause: () => undefined },
} satisfies Meta<typeof DriveMigrationScreen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const ReadyEnglish: Story = { args: { language: "en" } };
export const Copying: Story = { args: { running: true, summary: { status: "copying", prepared: true, total: 120, copied: 73, currentFile: "Notes/旅行の記録.md" } } };
export const Paused: Story = { args: { summary: { status: "copying", prepared: true, total: 120, copied: 73, currentFile: "Notes/旅行の記録.md" } } };
export const Failed: Story = { args: { error: "Google Driveへのアクセスに失敗しました。再試行してください。", summary: { status: "copying", prepared: true, total: 120, copied: 73, currentFile: "Notes/旅行の記録.md" } } };
export const Complete: Story = { args: { summary: { status: "complete", prepared: true, total: 120, copied: 120, currentFile: null } } };
export const NoWorkspace: Story = { args: { summary: null } };
