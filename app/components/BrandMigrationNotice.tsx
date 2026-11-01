import { useEffect, useState } from "react";
import { LEGACY_DOMAINS, PUBLIC_DOMAIN, PUBLIC_ORIGIN } from "~/config/branding";
import { useI18n } from "~/i18n/context";

/** Keep the old origin available until the user's local edits are on Drive. */
export function BrandMigrationNotice({ pendingChanges }: { pendingChanges: number }) {
  const [legacy, setLegacy] = useState(false);
  const { language } = useI18n();
  useEffect(() => {
    const hostname = window.location.hostname;
    setLegacy(LEGACY_DOMAINS.some(domain => hostname === domain || hostname === `www.${domain}`));
  }, []);
  if (!legacy) return null;
  const ja = language === "ja";
  return <div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
    <p>{ja ? `サービス名と公開URLがkiokuflow（${PUBLIC_DOMAIN}）に変わります。` : `The service is becoming kiokuflow at ${PUBLIC_DOMAIN}.`}
      {pendingChanges > 0 && <span className="ml-1">{ja ? "この端末の未同期の変更をPushしてから、新しいサイトへ移動してください。" : "Push this device's unsynced changes before moving to the new site."}</span>}</p>
    {pendingChanges > 0 ? <span aria-disabled="true" className="opacity-60">{ja ? "Push後に移動できます" : "Available after Push"}</span>
      : <a href={PUBLIC_ORIGIN} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded border border-blue-300 px-3 font-medium hover:bg-blue-100 dark:border-blue-700 dark:hover:bg-blue-900">{ja ? "新しいサイトを開く" : "Open the new site"}</a>}
  </div>;
}
