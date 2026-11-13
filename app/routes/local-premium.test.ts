import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Firestore } from "@google-cloud/firestore";
import { action as fileAction } from "./api.drive.files";
import { action as tempAction } from "./api.drive.temp";
import { action as uploadAction } from "./api.drive.upload-resumable";
import { action as settingsAction } from "./settings";
import { setTokens, commitSession } from "~/services/session.server";
import { clearSettingsCache, getSettings, saveSettings } from "~/services/user-settings.server";
import { DEFAULT_USER_SETTINGS } from "~/types/settings";
import { SETTINGS_FILE_NAME } from "~/services/sync-diff";
import { syncTimelineFromDrive } from "~/services/kakeratta-timeline.server";
import { KakerattaSettingsSchema } from "~/types/kakeratta";

function local(t: TestContext) {
  const previous = process.env.KIOKUFLOW_RUNTIME;
  process.env.KIOKUFLOW_RUNTIME = "local"; clearSettingsCache();
  t.after(() => { clearSettingsCache(); if (previous === undefined) delete process.env.KIOKUFLOW_RUNTIME; else process.env.KIOKUFLOW_RUNTIME = previous; });
  t.mock.method(Firestore.prototype, "collection", () => assert.fail("Local Premium touched Firestore"));
}
async function request(path: string, body: unknown, form = false) {
  const url = "http://localhost:8132" + path;
  const session = await setTokens(new Request(url), { rootFolderId: "local-root", accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiryTime: Date.now() + 3600_000, email: "local@example.test" });
  return new Request(url, { method: "POST", headers: { Cookie: (await commitSession(session)).split(";")[0], Origin: "http://localhost:8132", "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" }, body: form ? new URLSearchParams(body as Record<string, string>) : JSON.stringify(body) });
}
const args = (request: Request) => ({ request, params: {}, context: {} }) as never;

test("local PDF and edit-URL operations pass Premium checks without a subscription lookup", async t => {
  local(t);
  t.mock.method(globalThis, "fetch", async () => assert.fail("Preflight should not access a cloud service"));
  const pdf = await fileAction(args(await request("/api/drive/files", { action: "create-markdown-pdf" })));
  assert.equal(pdf.status, 400);
  assert.match((await pdf.json()).error, /Missing fileId/);
  const temp = await tempAction(args(await request("/api/drive/temp", { action: "generateEditUrl" })));
  assert.equal(temp.status, 400);
  assert.match((await temp.json()).error, /Missing/);
});

test("local uploads receive the Premium size limit using only the user's Drive", async t => {
  local(t);
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: unknown) => {
    const url = new URL(String(input)); calls.push(url.href);
    assert.equal(url.hostname, "www.googleapis.com");
    assert.match(url.pathname, /upload\/drive\/v3\/files/);
    return new Response(null, { headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic" } });
  });
  const response = await uploadAction(args(await request("/api/drive/upload-resumable", { intent: "create-session", clientPath: "large.bin", size: 21 * 1024 * 1024, mimeType: "application/octet-stream" })));
  assert.equal(response.status, 200, await response.clone().text());
  assert.match((await response.json()).uploadUrl, /upload_id=synthetic/);
  assert.equal(calls.length, 1);
});

test("local mode skips hosted schedules and Kakeratta Timeline sync even with saved hosted settings", async t => {
  local(t);
  const config = KakerattaSettingsSchema.parse({ enabled: true, timelineSync: { enabled: true } });
  t.mock.method(globalThis, "fetch", async (input: unknown) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "www.googleapis.com");
    if (url.pathname.endsWith("/settings-file")) return Response.json({ ...DEFAULT_USER_SETTINGS, kakeratta: config, hubwork: { schedules: [{ workflowPath: "test.yaml" }] } });
    return Response.json({ files: [{ id: "settings-file", name: SETTINGS_FILE_NAME }] });
  });
  const response = await settingsAction(args(await request("/settings", { _action: "hubwork-schedules", schedules: "[]" }, true)));
  assert.equal(response.status, 404);
  assert.match((await response.json()).message, /unavailable in local mode/);
  t.mock.method(globalThis, "fetch", async () => assert.fail("Local Timeline synchronization must not contact Drive, Kakeratta or Firestore"));
  const result = await syncTimelineFromDrive({ accessToken: "synthetic", rootFolderId: "local-root" }, config, "ja", new AbortController().signal);
  assert.equal(result.disabled, true);
});

test("local external sync token export is Premium and runtime flags never enter Drive settings", async t => {
  local(t);
  let written: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "www.googleapis.com");
    if (init.method === "PATCH") { written = JSON.parse(String(init.body)); return Response.json({ id: "settings-file", name: SETTINGS_FILE_NAME }); }
    if (url.pathname.endsWith("/settings-file")) return Response.json(DEFAULT_USER_SETTINGS);
    return Response.json({ files: [{ id: "settings-file", name: SETTINGS_FILE_NAME, mimeType: "application/json" }] });
  });
  const exported = await settingsAction(args(await request("/settings", { _action: "generateMigrationToken" }, true)));
  assert.equal(exported.status, 200);
  const body = await exported.json(); assert.equal(body.success, true); assert.equal(typeof body.migrationToken, "string");
  const settings = await getSettings("synthetic-access", "local-root");
  assert.equal(settings.localMode, true);
  await saveSettings("synthetic-access", "local-root", settings);
  assert.equal(Object.hasOwn(written!, "localMode"), false);
  process.env.KIOKUFLOW_RUNTIME = "hosted";
  assert.equal((await getSettings("synthetic-access", "local-root")).localMode, false);
});
