import assert from "node:assert/strict";
import test from "node:test";
import { getAuthUrl } from "./google-auth.server";
import { HUBWORK_TOOL_DEFINITIONS } from "./hubwork-tool-definitions";
import { action as calendarAction } from "../routes/api.calendar";
import { action as gmailAction } from "../routes/api.gmail";
import { action as oldLoginAction } from "../routes/hubwork.internal.auth.login";
import { action as oldRegisterAction } from "../routes/hubwork.internal.auth.register";
import { handleGmailSendNode } from "../engine/handlers/hubworkGmail";
import { handleCalendarListNode, handleCalendarCreateNode, handleCalendarUpdateNode, handleCalendarDeleteNode } from "../engine/handlers/hubworkCalendar";

test("sign-in requests only Drive file access and never combines previous broad grants", async t => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = "synthetic-client.apps.googleusercontent.com";
  t.after(() => { if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = previousClientId; });
  for (const path of ["/auth/google", "/auth/google?hubwork=1"]) {
    const { url } = await getAuthUrl(new Request(`https://kiokuflow.net${path}`));
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
    assert.equal(parsed.searchParams.get("include_granted_scopes"), "false");
    assert.equal(parsed.searchParams.get("redirect_uri"), "https://kiokuflow.net/auth/google/callback");
  }
  assert.ok(HUBWORK_TOOL_DEFINITIONS.every(tool => !/calendar|gmail/.test(tool.name)));
});

test("retired API routes reject old clients without calling Google, including email sign-in", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("Google must not be called"); });
  for (const action of [calendarAction, gmailAction, oldLoginAction, oldRegisterAction]) {
    const response = action({ request: new Request("https://kiokuflow.net/api/calendar", { method: "POST" }) } as Parameters<typeof action>[0]);
    assert.equal(response.status, 410);
    assert.match((await response.json()).error, /no longer available/);
  }
  assert.equal(requests, 0);
});

test("old saved Gmail/Calendar workflow nodes fail without using credentials", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("Google must not be called"); });
  for (const handler of [handleGmailSendNode, handleCalendarListNode, handleCalendarCreateNode, handleCalendarUpdateNode, handleCalendarDeleteNode]) {
    await assert.rejects(handler(...[{}, {}, {}] as unknown as Parameters<typeof handler>), /removed from kiokuflow/);
  }
  assert.equal(requests, 0);
});
