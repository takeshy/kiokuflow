import assert from "node:assert/strict";
import test from "node:test";
import { createRequestHandler, type ServerBuild } from "react-router";
import routes from "../routes";
import { commitSession, markGoogleOAuthSession, setTokens } from "~/services/session.server";

const path = "api/settings/migration";

async function handler(response?: () => Response) {
  const route = routes.find(route => route.path === path);
  assert.ok(route, "Migration fetches must have a registered resource route");
  const actualModule = await import(new URL(`../${route.file}`, import.meta.url).href);
  const module = response ? { ...actualModule, action: response } : actualModule;
  const build = {
    entry: { module: { default: (_request: Request, status: number) =>
      new Response("<!doctype html><html></html>", { status, headers: { "Content-Type": "text/html" } }) } },
    routes: {
      root: { id: "root", path: "", module: { default: () => null } },
      migration: { id: "migration", path, parentId: "root", module },
    },
    assets: { version: "test", routes: {}, entry: { imports: [] } },
    future: {}, ssr: true, isSpaMode: false, basename: "/", publicPath: "/",
    assetsBuildDirectory: "build/client", prerender: [],
    routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
  } as unknown as ServerBuild;
  return createRequestHandler(build, "test");
}

function request(intent: string, headers: HeadersInit = {}) {
  return new Request(`https://kiokuflow.net/${path}`, {
    method: "POST", body: new URLSearchParams({ intent }),
    headers: { Origin: "https://kiokuflow.net", Accept: "application/json", ...headers },
  });
}

test("successful migration actions return their summary without rendering the page", async () => {
  const summary = { status: "copying", prepared: true, total: 5, copied: 1, currentFile: "notes/example.md" };
  // Stub Drive execution while keeping the registered route's rendering exports.
  // Adding a default component would turn this JSON into an HTML document again.
  const handle = await handler(() => Response.json({ summary }, {
    headers: { "Cache-Control": "no-store", "Set-Cookie": "refreshed-session=test; HttpOnly; Secure" },
  }));
  const response = await handle(request("step"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") ?? "", /application\/json/);
  assert.equal(response.headers.get("Set-Cookie"), "refreshed-session=test; HttpOnly; Secure");
  assert.deepEqual(await response.json(), { summary });
});

test("migration POST without a session returns JSON 401 instead of login HTML", async () => {
  const response = await (await handler())(request("prepare"));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("Content-Type") ?? "", /application\/json/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Location"), null);
  assert.equal((await response.json()).error, "Session expired");
});

test("authenticated migration errors stay JSON through the framework's HTTP handler", async () => {
  const session = await setTokens(new Request("https://kiokuflow.net/"), {
    accessToken: "test-access", refreshToken: "test-refresh", expiryTime: Date.now() + 3600000,
    rootFolderId: "new-root", email: "owner@example.com", currentOrgId: "test-org",
  });
  markGoogleOAuthSession(session);
  const cookie = (await commitSession(session)).split(";")[0];
  const handle = await handler();
  for (const intent of ["invalid", "prepare", "step", "finish"]) {
    // The org session cannot own a Drive migration, so no Drive/Firestore calls run.
    const response = await handle(request(intent, { Cookie: cookie }));
    assert.equal(response.status, 400);
    assert.match(response.headers.get("Content-Type") ?? "", /application\/json/);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal((await response.json()).error, intent === "invalid"
      ? "Invalid migration action" : "このアカウントの旧環境は見つかりません。");
  }
});

test("migration API rejects cross-origin mutations before accessing any migration", async () => {
  const response = await (await handler())(request("prepare", { Origin: "https://other.example" }));
  assert.equal(response.status, 403);
});
