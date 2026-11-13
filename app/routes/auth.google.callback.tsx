import { isLocalRuntime } from "~/services/app-runtime.server";
import { redirect } from "react-router";
import type { Route } from "./+types/auth.google.callback";
import {
  exchangeCode,
} from "~/services/google-auth.server";
import { getSession, setTokens, commitSession, safeReturnTo, markGoogleOAuthSession } from "~/services/session.server";
import { ensureRootFolder } from "~/services/google-drive.server";
import { ensureSettingsFile } from "~/services/user-settings.server";
import { captureLegacyDriveMigration, driveMigrationEnabled } from "~/services/drive-migration.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    throw new Response(`OAuth error: ${error}`, { status: 400 });
  }

  if (!code) {
    throw new Response("Missing authorization code", { status: 400 });
  }

  // Verify OAuth state parameter to prevent CSRF
  const stateSession = await getSession(request);
  const expectedState = stateSession.get("oauthState");
  if (!state || !expectedState || state !== expectedState) {
    throw new Response("Invalid OAuth state parameter", { status: 400 });
  }

  // PKCE: retrieve code_verifier from session
  const codeVerifier = stateSession.get("oauthCodeVerifier");
  if (!codeVerifier) {
    throw new Response("Missing PKCE code verifier", { status: 400 });
  }

  const tokens = await exchangeCode(code, request, codeVerifier);

  // Capture granted scopes from the callback
  const scope = url.searchParams.get("scope") || "";

  // Ensure root folder and settings.json exist on Drive
  const rootFolderId = await ensureRootFolder(tokens.accessToken);
  await ensureSettingsFile(tokens.accessToken, rootFolderId);

  // Fetch user email from Drive API
  let email: string | undefined;
  let migrationRequired = false;
  try {
    const aboutRes = await fetch(
      "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    if (aboutRes.ok) {
      const about = await aboutRes.json();
      email = about.user?.emailAddress;
    }
  } catch { /* non-critical */ }
  if (!isLocalRuntime() && driveMigrationEnabled() && !email) {
    throw new Response("Googleアカウントを確認できませんでした。もう一度ログインしてください。", { status: 503 });
  }

  // Read returnTo before setTokens (which creates a new session)
  const returnTo = safeReturnTo(stateSession.get("oauthReturnTo"));

  if (!isLocalRuntime()) try {
    const {
      getAccountByRootFolderId,
      getAccountByEmail,
      updateRefreshToken,
      updateAccount,
    } = await import("~/services/hubwork-accounts.server");
    let hubworkAccount = await getAccountByRootFolderId(rootFolderId);
    let hubworkAccountMatchedByEmail = false;
    if (!hubworkAccount && email) {
      hubworkAccount = await getAccountByEmail(email);
      hubworkAccountMatchedByEmail = !!hubworkAccount;
    }

    if (hubworkAccount) {
      // Preserve the old client-bound refresh token before updating the billing record.
      migrationRequired = await captureLegacyDriveMigration(hubworkAccount, rootFolderId);
    }
    if (hubworkAccount?.plan) {
      const updates: Record<string, string> = {};
      if (hubworkAccountMatchedByEmail && rootFolderId && hubworkAccount.rootFolderId !== rootFolderId) {
        updates.rootFolderId = rootFolderId;
      }
      if (!hubworkAccount.email && email) updates.email = email;
      if (Object.keys(updates).length > 0) {
        await updateAccount(hubworkAccount.id, updates);
      }

      if (tokens.refreshToken) {
        await updateRefreshToken(hubworkAccount.id, tokens.refreshToken);
      }
    }
  } catch (error) {
    // During OAuth separation, a failed snapshot must never lose the source credentials.
    if (driveMigrationEnabled()) throw error;
    // Hubwork account lookup/update is not required for normal login.
  }

  const session = await setTokens(request, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiryTime: tokens.expiryTime,
    rootFolderId,
    email,
    grantedScopes: scope,
  });
  markGoogleOAuthSession(session);
  session.set("authMethod", "google");
  session.unset("oidcSub");
  session.unset("oauthState");
  session.unset("oauthCodeVerifier");
  session.unset("oauthReturnTo");
  if (migrationRequired) {
    // This is a personal Drive migration, independent of a previously selected org.
    session.unset("currentOrgId");
    session.unset("currentProjectId");
  }

  return redirect(migrationRequired ? "/settings/migration" : returnTo, {
    headers: {
      "Set-Cookie": await commitSession(session),
    },
  });
}
