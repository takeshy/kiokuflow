import { useEffect, useRef, useState } from "react";
import { data, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/settings.migration";
import { getTokens } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { driveMigrationSummary, runDriveMigration } from "~/services/drive-migration.server";
import type { DriveMigrationSummary } from "~/services/drive-migration";
import { resolveLanguage } from "~/i18n/resolve-language";
import { validateOrigin } from "~/utils/security";
import { DriveMigrationScreen } from "~/components/settings/DriveMigrationScreen";

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

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") throw new Response("Method not allowed", { status: 405 });
  validateOrigin(request);
  const { tokens, setCookieHeader } = await authenticated(request);
  const headers = { "Cache-Control": "no-store", ...(setCookieHeader ? { "Set-Cookie": setCookieHeader } : {}) };
  try {
    const intent = (await request.formData()).get("intent");
    if (typeof intent !== "string" || !["prepare", "step", "finish"].includes(intent)) throw new Error("Invalid migration action");
    await runDriveMigration(tokens, intent);
    return Response.json({ summary: await driveMigrationSummary(tokens) }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "引き継ぎに失敗しました。" }, { status: 400, headers });
  }
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
        const response = await fetch("/settings/migration", { method: "POST", body: new URLSearchParams({ intent }), headers: { Accept: "application/json" } });
        if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error(loaded.language === "ja" ? "ログイン状態を確認し、この画面を開き直してください。" : "Check your login and reopen this page.");
        const result = await response.json() as { summary?: DriveMigrationSummary; error?: string };
        if (!response.ok || result.error || !result.summary) throw new Error(result.error || "Migration failed");
        current = result.summary;
        setSummary(current);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Migration failed"); }
    finally { continuing.current = false; setRunning(false); }
  }
  return <DriveMigrationScreen language={loaded.language} email={loaded.email} summary={summary} running={running} error={error}
    onStart={() => { void start(); }} onPause={() => { continuing.current = false; }} />;
}
