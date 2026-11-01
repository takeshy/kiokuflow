import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buildMockGemihubScript, buildAdminGemihubScript } from "../components/ide/editors/html-preview-mock";
import { loader } from "../routes/hubwork.internal.api-js";

test("new SDK and existing published apps share one compatible API object", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const window: Record<string, unknown> = {};
  const response = loader({} as Parameters<typeof loader>[0]);
  runInNewContext(await response.text(), { window, URL, location: { origin: "https://alice.kiokuflow.net" }, fetch: async (input: URL | string, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json({ value: 42 });
  } });
  assert.equal(window.kiokuflow, window.gemihub);
  const sdk = window.kiokuflow as { get: (path: string, params: object) => Promise<unknown>; post: (path: string, body: object) => Promise<unknown> };
  assert.deepEqual(await sdk.get("status", { q: "日本語" }), { value: 42 });
  assert.equal(new URL(calls[0].url).pathname, "/__gemihub/api/status");
  assert.equal(new URL(calls[0].url).searchParams.get("q"), "日本語");
  assert.equal(calls[0].init?.credentials, "include");
  await sdk.post("notes", { content: "hello" });
  assert.equal(calls[1].url, "/__gemihub/api/notes");
  assert.equal(calls[1].init?.method, "POST");
});


test("kiokuflow SDK works in cached previews and authenticated admin previews", async () => {
  const window: Record<string, unknown> = {};
  const script = buildMockGemihubScript({ "web/__gemihub/api/status.json": '{"value":42}' });
  runInNewContext(script.replace(/^<script>|<\/script>$/g, ""), { window, location: { pathname: "/", search: "" } });
  assert.equal(window.kiokuflow, window.gemihub);
  const mockSdk = window.kiokuflow as { get: (path: string) => Promise<{ value: number }> };
  assert.equal((await mockSdk.get("status")).value, 42);

  let receive: (e: { source: unknown; data: unknown }) => void = () => {};
  let sent: { id: string; path: string; method: string } | undefined;
  const parent = { postMessage: (message: typeof sent) => { sent = message; } };
  const adminWindow: Record<string, unknown> = { addEventListener: (_type: string, callback: typeof receive) => { receive = callback; } };
  runInNewContext(buildAdminGemihubScript("owner@example.com").replace(/^<script>|<\/script>$/g, ""), { window: adminWindow, parent });
  assert.equal(adminWindow.kiokuflow, adminWindow.gemihub);
  const adminSdk = adminWindow.kiokuflow as { get: (path: string) => Promise<{ value: number }>; auth: { me: () => Promise<{ email: string }> } };
  assert.equal((await adminSdk.auth.me()).email, "owner@example.com");
  const result = adminSdk.get("status");
  assert.equal(sent?.method, "GET"); assert.equal(sent?.path, "status");
  receive({ source: parent, data: { type: "gemihub-admin-response", id: sent?.id, ok: true, data: { value: 42 } } });
  assert.equal((await result).value, 42);
});
