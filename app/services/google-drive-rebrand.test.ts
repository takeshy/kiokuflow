import assert from "node:assert/strict";
import test from "node:test";
import { ensureRootFolder } from "./google-drive.server";

test("default sign-in reuses the original gemihub folder without creating a second workspace", async t => {
  const names: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    assert.notEqual(init?.method, "POST");
    const q = new URL(String(input)).searchParams.get("q") || "";
    names.push(q); return Response.json({ files: q.includes("name='gemihub'") || q.includes("name = 'gemihub'") ? [{ id: "original-root", name: "gemihub" }] : [] });
  });
  assert.equal(await ensureRootFolder("synthetic-access"), "original-root"); assert.equal(names.length, 2);
});

test("new accounts create kiokuflow while explicit custom folder names remain authoritative", async t => {
  const created: string[] = [];
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    if (init?.method === "POST") { const body = JSON.parse(String(init.body)); created.push(body.name); return Response.json({ id: `${body.name}-root` }); }
    return Response.json({ files: [] });
  });
  assert.equal(await ensureRootFolder("synthetic-access"), "kiokuflow-root");
  assert.equal(await ensureRootFolder("synthetic-access", "custom-notes"), "custom-notes-root");
  assert.deepEqual(created, ["kiokuflow", "custom-notes"]);
});
