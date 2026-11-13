import assert from "node:assert/strict";
import test from "node:test";
import { Firestore } from "@google-cloud/firestore";
import { retrieveHybridRagChunks } from "./rag-hybrid.server";

test("hybrid retrieval scopes both branches and excludes private text before BM25 limiting", async t => {
  const previous = process.env.GCE_METADATA_HOST;
  process.env.GCE_METADATA_HOST = "metadata.test.invalid";
  t.after(() => { if (previous === undefined) delete process.env.GCE_METADATA_HOST; else process.env.GCE_METADATA_HOST = previous; });
  const scopes: unknown[][][] = [];
  let lexicalReads = 0;
  let revision = "initial";
  const doc = (id: string, text: string, path = `${id}.md`) => ({ id, data: () => ({ orgId: "org", projectId: "project", settingName: "index", docPath: path, chunkIndex: 0, text, metadata: { fileName: path, contentType: "text" }, updatedAt: 0, distance: 0.2 }) });
  t.mock.method(Firestore.prototype, "collection", function (name: string) {
    if (name === "ragIndexRevisions") return { doc: () => ({ get: async () => ({ get: () => revision }) }) } as never;
    assert.equal(name, "ragChunks");
    const filters: unknown[][] = [];
    let lexical = false;
    const chain = {
      where(...args: unknown[]) { filters.push(args); return chain; },
      findNearest(options: { limit: number }) { assert.ok(options.limit <= 1000); return chain; },
      select(...fields: string[]) { assert.ok(fields.includes("text")); assert.ok(!fields.includes("embedding")); lexical = true; return chain; },
      async get() {
        scopes.push(filters);
        if (!lexical) return { docs: [doc("semantic", "semantic meaning")] };
        lexicalReads++;
        return { docs: [doc("semantic", "semantic meaning"), ...Array.from({length: 50}, (_, i) => doc(`private-${i}`, "E02 E02 E02", `Secrets/${i}.md`)), doc("exact", "E02 保存方法")] };
      },
    };
    return chain as never;
  });
  const hits = await retrieveHybridRagChunks("org", "project", "index", "E02", [1, 0], 2, true, candidate => !candidate.docPath.startsWith("Secrets/"));
  assert.equal(hits.length, 2);
  assert.equal(hits[1].chunkId, "exact"); assert.equal(hits[1].retrievalSource, "bm25");
  for (const scope of scopes) assert.deepEqual(scope, [["orgId", "==", "org"], ["projectId", "==", "project"], ["settingName", "==", "index"]]);
  await Promise.all(Array.from({ length: 4 }, () => retrieveHybridRagChunks("org", "project", "index", "保存", [1, 0], 2)));
  assert.equal(lexicalReads, 1, "queries and concurrent callers reuse the corpus");
  const restricted = await retrieveHybridRagChunks("org", "project", "index", "E02", [1, 0], 2, true, candidate => candidate.chunkId === "semantic");
  assert.deepEqual(restricted.map(hit => hit.chunkId), ["semantic"], "cached text still uses the current path filter");
  revision = "changed-by-another-server";
  await Promise.all(Array.from({ length: 4 }, () => retrieveHybridRagChunks("org", "project", "index", "E02", [1, 0], 2)));
  assert.equal(lexicalReads, 2, "a remote sync invalidates the cache and concurrent reloads coalesce");
  for (const scope of [["other-org", "project", "index"], ["org", "other-project", "index"], ["org", "project", "other-index"]]) {
    await retrieveHybridRagChunks(scope[0], scope[1], scope[2], "E02", [1, 0], 2);
    assert.deepEqual(scopes.at(-1), [["orgId", "==", scope[0]], ["projectId", "==", scope[1]], ["settingName", "==", scope[2]]]);
  }
  assert.equal(lexicalReads, 5, "all scope dimensions isolate cached indexes");
  const vector = await retrieveHybridRagChunks("org", "project", "index", "E02", [1, 0], 2, false);
  assert.equal(vector.length, 1); assert.equal(vector[0].retrievalSource, "vector"); assert.equal(lexicalReads, 5);
});
