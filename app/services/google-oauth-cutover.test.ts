import assert from "node:assert/strict";
import test from "node:test";
import { getSession, setTokens, commitSession, getTokens, markGoogleOAuthSession } from "./session.server";
import { getAuthUrl } from "./google-auth.server";
import { getTokensForAccount } from "./hubwork-accounts.server";
import type { HubworkAccount } from "~/types/hubwork";

test("OAuth project cutover rejects legacy Google cookies, retains tokenless org sessions, and clears keys before migration login", async t => {
  for (const [key, value] of Object.entries({ GOOGLE_CLIENT_ID: "new-client", GOOGLE_CLIENT_SECRET: "new-secret", GOOGLE_MIGRATION_CLIENT_ID: "old-client" })) {
    const prior = process.env[key]; process.env[key] = value;
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
  const request = new Request("https://kiokuflow.net/");
  const session = await setTokens(request, { accessToken: "access", refreshToken: "refresh", expiryTime: Date.now() + 3600000,
    rootFolderId: "new-root", email: "owner@example.com", geminiApiKey: "private-test-key" });
  const withCookie = (cookie: string) => new Request(request.url, { headers: { Cookie: cookie.split(";")[0] } });
  assert.equal(await getTokens(withCookie(await commitSession(session))), null);
  markGoogleOAuthSession(session);
  assert.equal((await getTokens(withCookie(await commitSession(session))))?.rootFolderId, "new-root");
  const result = await getAuthUrl(withCookie(await commitSession(session)), { returnTo: "/settings/migration" });
  const state = await getSession(withCookie(result.setCookieHeader));
  assert.equal(state.get("geminiApiKey"), undefined);
  assert.equal(state.get("accessToken"), undefined);
  assert.ok(state.get("oauthCodeVerifier"));
  assert.equal(new URL(result.url).searchParams.get("prompt"), "consent select_account");
  const orgSession = await setTokens(request, { accessToken: "", refreshToken: "", expiryTime: 0, rootFolderId: "",
    email: "member@example.com", authMethod: "oidc" });
  assert.equal((await getTokens(withCookie(await commitSession(orgSession))))?.authMethod, "oidc");
  await assert.rejects(getTokensForAccount({ id: "old-account", encryptedRefreshToken: "do-not-decrypt-before-client-check" } as HubworkAccount), /sign in to kiokuflow again/);
});
