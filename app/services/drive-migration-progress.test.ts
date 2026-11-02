import assert from "node:assert/strict";
import test from "node:test";
import { FieldValue, type Firestore, type DocumentReference } from "@google-cloud/firestore";
import { recordMigrationCopy } from "./drive-migration.server";

test("completion saves the file and atomic count together and does not count a retry twice", async () => {
  const job = {} as DocumentReference;
  const file = {} as DocumentReference;
  let done = false;
  let increments = 0;
  const store = { runTransaction: async (run: (tx: unknown) => Promise<void>) => run({
    get: async (ref: DocumentReference) => ({ data: () => ref === job ? { leaseOwner: "lease" } : { done } }),
    update: (ref: DocumentReference, values: Record<string, unknown>) => {
      if (ref === file) { assert.equal(values.done, true); done = true; }
      else { assert.ok((values.copied as FieldValue).isEqual(FieldValue.increment(1))); increments++; }
    },
  }) } as unknown as Firestore;
  await recordMigrationCopy(job, file, "lease", store);
  await recordMigrationCopy(job, file, "lease", store);
  assert.equal(done, true);
  assert.equal(increments, 1);
});

test("a stale worker cannot update progress after another request takes the lease", async () => {
  const job = {} as DocumentReference;
  const file = {} as DocumentReference;
  let writes = 0;
  const store = { runTransaction: async (run: (tx: unknown) => Promise<void>) => run({
    get: async (ref: DocumentReference) => ({ data: () => ref === job ? { leaseOwner: "new-lease" } : { done: false } }),
    update: () => { writes++; },
  }) } as unknown as Firestore;
  await assert.rejects(recordMigrationCopy(job, file, "old-lease", store), /実行権限/);
  assert.equal(writes, 0);
});
