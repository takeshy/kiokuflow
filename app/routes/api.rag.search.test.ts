import assert from "node:assert/strict";
import test from "node:test";
import { action } from "./api.rag.search";

test("project RAG rejects malformed query and Jev overrides before embedding or decisions", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Invalid request reached an external API"));
  const base = { projectId: "project", ragSettingName: "index", query: "question" };
  for (const body of [null, [], {}, { ...base, query: " " }, { ...base, jevFilter: "true" }, { ...base, searchUntilMatch: 1 }, { ...base, topK: 0 }, { ...base, topK: 21 }]) {
    const request = new Request("https://gemihub.example/api/rag/search", { method: "POST", headers: { Origin: "https://gemihub.example", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const response = await action({ request, params: {}, context: {} } as never);
    assert.equal(response.status, 400);
  }
});
