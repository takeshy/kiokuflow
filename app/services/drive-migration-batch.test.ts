import assert from "node:assert/strict";
import test from "node:test";
import { copyMigrationBatch, migrationMap, isRetryableMigrationError, MigrationRequestError } from "./drive-migration-batch";
import { MIGRATION_FOLDER_MIME, type MigrationEntry } from "./drive-migration";

const entry = (id: string, parent = "source-root", folder = false): MigrationEntry => ({
  source: { id, name: id, mimeType: folder ? MIGRATION_FOLDER_MIME : "text/plain", size: "1" },
  parent, path: id, targetId: `target-${id}`, done: false, depth: 0,
});
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("copying runs four files concurrently and preserves an already copied manifest", async () => {
  let active = 0;
  let maximum = 0;
  const copied: string[] = [];
  const items = Array.from({ length: 12 }, (_, i) => entry(`file-${i}`));
  items[0].done = true;
  await copyMigrationBatch(items, "source-root", "target-root", {
    load: async () => { throw new Error("no parents required"); },
    copy: async (item, parent) => {
      assert.equal(parent, "target-root");
      maximum = Math.max(maximum, ++active);
      await sleep(4);
      copied.push(item.source.id);
      active--;
      return true;
    },
  });
  assert.equal(maximum, 4);
  assert.equal(copied.length, 11);
  assert.equal(new Set(copied).size, 11);
  assert.ok(!copied.includes("file-0"));
  assert.ok(items.every(item => item.done));
});

test("children wait for shared ancestors outside the batch, copying each ancestor once", async () => {
  const root = entry("folder", "source-root", true);
  const nested = entry("nested", "folder", true);
  const parents = new Map([["folder", root], ["nested", nested]]);
  const completed = new Set<string>();
  const calls: string[] = [];
  const items = [entry("a", "nested"), entry("b", "nested"), entry("c", "folder"), entry("d", "nested")];
  await copyMigrationBatch(items, "source-root", "target-root", {
    load: async id => { await sleep(1); return parents.get(id)!; },
    copy: async (item, parent) => {
      if (item.parent !== "source-root") assert.ok(completed.has(item.parent));
      assert.equal(parent, item.parent === "source-root" ? "target-root" : `target-${item.parent}`);
      await sleep(2);
      calls.push(item.source.id);
      completed.add(item.source.id);
      return true;
    },
  });
  assert.equal(calls.filter(id => id === "folder").length, 1);
  assert.equal(calls.filter(id => id === "nested").length, 1);
  assert.equal(completed.size, 6);
});

test("a failed worker waits for other in-flight copies to save progress before throwing", async () => {
  const items = Array.from({ length: 10 }, (_, i) => entry(`file-${i}`));
  const saved: string[] = [];
  const started: string[] = [];
  await assert.rejects(copyMigrationBatch(items, "source-root", "target-root", {
    load: async () => { throw new Error("no parents"); },
    copy: async item => {
      started.push(item.source.id);
      if (item.source.id === "file-0") throw new DOMException("operation timed out", "TimeoutError");
      await sleep(5);
      saved.push(item.source.id);
      return true;
    },
  }), error => error instanceof MigrationRequestError && error.retryable && error.message.includes("file-0"));
  assert.equal(started.length, 4);
  assert.equal(saved.length, 3);
  assert.equal(items[0].done, false);
  assert.ok(items.slice(1, 4).every(item => item.done));
});

test("a batch stops launching work at its budget and unfinished uploads remain pending", async () => {
  let now = 0;
  let calls = 0;
  const items = Array.from({ length: 20 }, (_, i) => entry(`file-${i}`));
  await copyMigrationBatch(items, "source-root", "target-root", {
    now: () => now, budgetMs: 20,
    load: async () => { throw new Error("no parents"); },
    copy: async () => { calls++; now = 21; return false; },
  });
  assert.equal(calls, 1);
  assert.ok(items.every(item => !item.done));
});

test("final verification also bounds concurrency and drains work after failure", async () => {
  const completed: number[] = [];
  await assert.rejects(migrationMap([0, 1, 2, 3, 4, 5], async i => {
    if (i === 0) throw new Error("verification failed");
    await sleep(3);
    completed.push(i);
  }), /verification failed/);
  assert.deepEqual(completed, [1, 2, 3]);
  assert.equal(isRetryableMigrationError(new Error("source changed")), false);
  assert.equal(isRetryableMigrationError(new MigrationRequestError("Drive 503", true)), true);
});
