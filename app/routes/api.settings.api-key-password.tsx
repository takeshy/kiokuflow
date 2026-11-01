import type { Route } from "./+types/api.settings.api-key-password";
import { requireAuth, setTokens, commitSession } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { configureCommonPassword } from "~/services/api-key-password.server";
import { validateOrigin } from "~/utils/security";

const headers = { "Cache-Control": "no-store" };
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  validateOrigin(request);
  const tokens = await requireAuth(request);
  if (!tokens.accessToken || !tokens.rootFolderId || tokens.currentProjectId) return Response.json({ error: "Select My Drive to manage the common encryption password." }, { status: 403, headers });
  const { tokens: valid, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = { ...headers, ...(setCookieHeader ? { "Set-Cookie": setCookieHeader } : {}) };
  const body = await request.json().catch(() => null);
  if (!body || !["setup", "unlock", "change", "lock"].includes(body.action)) return Response.json({ error: "Invalid action" }, { status: 400, headers: responseHeaders });
  if (body.action === "lock") {
    const session = await setTokens(request, { ...valid, geminiApiKey: "", openaiApiKey: "", jevApiKey: "", compatibleApiKeys: {} });
    return Response.json({ ok: true, unlocked: false }, { headers: { ...headers, "Set-Cookie": await commitSession(session) } });
  }
  const password = typeof body.password === "string" ? body.password : "";
  const nextPassword = body.action === "change" && typeof body.newPassword === "string" ? body.newPassword : password;
  if (nextPassword.length < 8 || ((body.action === "setup" || body.action === "change") && nextPassword !== body.confirmPassword)) return Response.json({ error: "Use at least 8 characters and matching password confirmation." }, { status: 400, headers: responseHeaders });
  try {
    const settings = await getSettings(valid.accessToken, valid.rootFolderId);
    const result = await configureCommonPassword(settings, password, nextPassword);
    if (body.action === "change" || result.settings.encryption.encryptedPrivateKey !== settings.encryption.encryptedPrivateKey) await saveSettings(valid.accessToken, valid.rootFolderId, result.settings);
    const session = await setTokens(request, { ...valid, ...result.keys });
    return Response.json({ ok: true, unlocked: true }, { headers: { ...headers, "Set-Cookie": await commitSession(session) } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Password verification failed" }, { status: 400, headers: responseHeaders });
  }
}
