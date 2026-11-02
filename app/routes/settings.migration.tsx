import { useEffect, useRef, useState } from "react";
import { data, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/settings.migration";
import { getTokens } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { driveMigrationSummary } from "~/services/drive-migration.server";
import type { DriveMigrationSummary } from "~/services/drive-migration";
import { resolveLanguage } from "~/i18n/resolve-language";
import { DriveMigrationScreen } from "~/components/settings/DriveMigrationScreen";
import { requestDriveMigration } from "~/services/drive-migration-client";

async function authenticated(request: Request) {
  const tokens = await getTokens(request);
  if (!tokens) throw redirect("/auth/google?returnTo=%2Fsettings%2Fmigration");
  return getValidTokens(request, tokens);
}

export async function loader({ request }: Route.LoaderArgs) {
  const { tokens, setCookieHeader } = await authenticated(request);
  return data({ summary: await driveMigrationSummary(tokens), email: tokens.email, language: resolveLanguage(null, request.headers.get("Accept-Language")) }, {
    headers: { "Cache-Control": "no-store", ...(setCookieHeader ? { "Set-Cookie": setCookieHeader } : {}) },
  });
}

export default function MigrationPage() {
  const loaded = useLoaderData<typeof loader>();
  const [summary, setSummary] = useState<DriveMigrationSummary | null>(loaded.summary);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const continuing = useRef(false);
  useEffect(() => () => { continuing.current = false; }, []);
  async function start() {
    if (continuing.current || !summary || summary.status === "complete") return;
    continuing.current = true;
    setRunning(true);
    setError(null);
    let current = summary;
    try {
      while (continuing.current && current.status !== "complete") {
        const intent = !current.prepared ? "prepare" : current.copied < current.total ? "step" : "finish";
        const result = await requestDriveMigration(intent, { language: loaded.language, active: () => continuing.current,
          onSummary: summary => { current = summary; setSummary(summary); } });
        if (!result) break;
        current = result;
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Migration failed"); }
    finally { continuing.current = false; setRunning(false); }
  }
  return <DriveMigrationScreen language={loaded.language} email={loaded.email} summary={summary} running={running} error={error}
    onStart={() => { void start(); }} onPause={() => { continuing.current = false; }} />;
}
