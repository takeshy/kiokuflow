import type { DriveMigrationSummary } from "./drive-migration";
import { isRetryableMigrationError, MigrationRequestError } from "./drive-migration-batch";
import type { Language } from "~/types/settings";

export async function requestDriveMigration(intent: string, options: {
  language: Language;
  active: () => boolean;
  onSummary: (summary: DriveMigrationSummary) => void;
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}): Promise<DriveMigrationSummary | null> {
  const ja = options.language === "ja";
  const fetcher = options.fetch ?? fetch;
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; options.active(); attempt++) {
    try {
      const response = await fetcher("/api/settings/migration", { method: "POST", body: new URLSearchParams({ intent }), headers: { Accept: "application/json" } });
      if (response.status === 401) throw new Error(ja ? "ログイン状態を確認し、この画面を開き直してください。" : "Check your login and reopen this page.");
      if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error(ja ? "引き継ぎの応答を確認できませんでした。この画面を開き直して再試行してください。" : "Could not read the migration response. Reopen this page and try again.");
      const result = await response.json() as { summary?: DriveMigrationSummary; error?: string; retryable?: boolean };
      if (result.summary) options.onSummary(result.summary);
      if (!response.ok || result.error || !result.summary) throw new MigrationRequestError(result.error || "Migration failed", !!result.retryable);
      return result.summary;
    } catch (error) {
      if (!isRetryableMigrationError(error) || attempt >= 3) throw error;
      await wait(1000 * 2 ** attempt);
    }
  }
  return null;
}
