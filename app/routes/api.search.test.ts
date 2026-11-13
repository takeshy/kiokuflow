// Hosted-only behavior is configured explicitly; standalone defaults to local.
process.env.KIOKUFLOW_RUNTIME = "hosted";
import assert from "node:assert/strict";
import test from "node:test";
import { action } from "./api.search";
import { setTokens, commitSession } from "~/services/session.server";

async function request(body: unknown, overrides = {}, origin = "https://gemihub.example") {
  const session = await setTokens(new Request("https://gemihub.example"), { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", rootFolderId: "search-root", expiryTime: Date.now() + 3600_000, ...overrides });
  return new Request("https://gemihub.example/api/search", { method: "POST", headers: { Origin: origin, Cookie: (await commitSession(session)).split(";")[0], "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function args(request: Request) { return { request, params: {}, context: {} } as never; }

test("search rejects malformed requests and missing RAG indexes before contacting any provider", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Invalid search reached network"));
  for (const body of [null, [], {}, { query: " ", mode: "rag" }, { query: "hello", mode: "rag", topK: -1 }, { query: "hello", mode: "rag", jevFilter: "true" }, { query: "hello", mode: "rag", searchUntilMatch: 1 }, { query: "hello", mode: "rag", topK: 50000 }, { query: "hello", mode: "rag", ragStoreIds: "wrong" }, { query: "hello", mode: "rag" }]) {
    const response = await action(args(await request(body)));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});

test("personal search cannot read a project mount and refuses cross-origin embedding requests", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Rejected search reached network"));
  const org = await action(args(await request({ query: "hello", mode: "rag", ragStoreIds: ["index"] }, { currentProjectId: "project" })));
  assert.equal(org.status, 403);
  await assert.rejects(action(args(await request({ query: "hello", mode: "rag", ragStoreIds: ["index"] }, {}, "https://attacker.invalid"))), (error: unknown) => error instanceof Response && error.status === 403);
});

test("legacy Drive search stays available without an AI key or RAG subscription", async t => {
  t.mock.method(globalThis, "fetch", async (input: unknown) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "www.googleapis.com");
    assert.match(url.searchParams.get("q") || "", /search-root/);
    return Response.json({ files: [{ id: "file", name: "notes.md", mimeType: "text/markdown" }] });
  });
  const response = await action(args(await request({ query: "notes", mode: "drive" })));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results[0].id, "file");
});
