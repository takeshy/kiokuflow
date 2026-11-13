import type { Route } from "./+types/api.auth.unlock";
import { requireAuth, commitSession, setTokens } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings } from "~/services/user-settings.server";
import { unlockSettingsKeys } from "~/services/api-key-password.server";
import { validateOrigin } from "~/utils/security";
import { isLocalRuntime } from "~/services/app-runtime.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  validateOrigin(request);
  const tokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, tokens);
  const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);

  const { password } = await request.json();
  if (!password || !settings.encryptedApiKey || !settings.apiKeySalt) {
    const session = await setTokens(request, validTokens);
    return Response.json(
      { error: "Invalid request" },
      { status: 400, headers: { "Set-Cookie": await commitSession(session) } }
    );
  }

  try {
    const { keys } = await unlockSettingsKeys(settings, password);
    const apiKey = keys.geminiApiKey!;
    const session = await setTokens(request, { ...validTokens, ...keys });

    // Refresh the server-side encrypted API key in Firestore only if the user
    // has scheduled workflows registered (the Scheduler needs it). Otherwise,
    // no server-side copy is kept.
    if (!isLocalRuntime() && (settings.hubwork?.schedules?.length ?? 0) > 0) {
      try {
        const { getAccountByRootFolderId, getAccountByEmail, updateAccount, encryptGeminiApiKey } = await import("~/services/hubwork-accounts.server");
        let account = await getAccountByRootFolderId(validTokens.rootFolderId);
        if (!account && validTokens.email) account = await getAccountByEmail(validTokens.email);
        if (account && (account.plan === "pro" || account.plan === "business" || account.plan === "granted")) {
          await updateAccount(account.id, { encryptedGeminiApiKey: encryptGeminiApiKey(apiKey) });
        }
      } catch { /* best-effort */ }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": await commitSession(session),
      },
    });
  } catch {
    const session = await setTokens(request, validTokens);
    return Response.json(
      { error: "Incorrect password" },
      { status: 401, headers: { "Set-Cookie": await commitSession(session) } }
    );
  }
}
