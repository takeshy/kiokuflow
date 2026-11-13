import assert from "node:assert/strict";
import test from "node:test";
import { Firestore } from "@google-cloud/firestore";
import { deleteChunks, deleteChunksByDocPath, deleteChunksBySetting, upsertChunks, type RagChunk } from "./rag-store.server";

test("all chunk mutations invalidate the affected lexical scopes in the same bounded commit", async t => {
  const previous = process.env.GCE_METADATA_HOST;
  process.env.GCE_METADATA_HOST = "metadata.test.invalid";
  t.after(() => { if (previous === undefined) delete process.env.GCE_METADATA_HOST; else process.env.GCE_METADATA_HOST = previous; });
  const ref = (collection: string, id: string) => ({ collection, id });
  const commits: { ref: ReturnType<typeof ref>; data?: Record<string, unknown> }[][] = [];
  const chunks: RagChunk[] = Array.from({ length: 501 }, (_, i) => ({
    chunkId: String(i), orgId: "org", projectId: "project", settingName: i % 2 ? "one" : "two",
    docPath: "note.md", chunkIndex: i, text: "text", embedding: [1, 0], metadata: { fileName: "note.md", contentType: "text" }, updatedAt: 0,
  }));
  const snapshot = (chunk: RagChunk) => ({ id: chunk.chunkId, ref: ref("ragChunks", chunk.chunkId), data: () => chunk });
  t.mock.method(Firestore.prototype, "collection", function (name: string) {
    const filters = new Map<string, string>();
    const chain = {
      doc: (id: string) => ref(name, id),
      where(field: string, _operator: string, value: string) { filters.set(field, value); return chain; },
      select() { return chain; },
      async get() {
        const docs = chunks.filter(chunk => [...filters].every(([field, value]) => chunk[field as keyof RagChunk] === value)).map(snapshot);
        return { docs, empty: docs.length === 0 };
      },
    };
    return chain as never;
  });
  t.mock.method(Firestore.prototype, "getAll", async (...refs: unknown[]) => refs.filter(value => "id" in (value as object)).map(value => snapshot(chunks[Number((value as { id: string }).id)])) as never);
  t.mock.method(Firestore.prototype, "batch", () => {
    const operations: (typeof commits)[number] = [];
    return {
      set: (docRef: ReturnType<typeof ref>, data: Record<string, unknown>) => operations.push({ ref: docRef, data }),
      delete: (docRef: ReturnType<typeof ref>) => operations.push({ ref: docRef }),
      commit: async () => { commits.push(operations); },
    } as never;
  });
  const scopeRevisionIds = new Set<string>();
  for (const mutate of [
    () => upsertChunks(chunks),
    () => deleteChunks(chunks.map(chunk => chunk.chunkId)),
    () => deleteChunksByDocPath("org", "project", "one", "note.md"),
    () => deleteChunksBySetting("org", "project", "two"),
  ]) {
    commits.length = 0;
    await mutate();
    assert.ok(commits.length > 0);
    for (const operations of commits) {
      assert.ok(operations.length <= 500);
      const revisions = operations.filter(op => op.ref.collection === "ragIndexRevisions");
      assert.ok(revisions.length > 0, "no chunk commit may omit cache invalidation");
      assert.ok(revisions.every(op => typeof op.data?.revision === "string"));
      for (const revision of revisions) scopeRevisionIds.add(revision.ref.id);
    }
  }
  assert.equal(scopeRevisionIds.size, 2, "each index gets its own revision document");
});
