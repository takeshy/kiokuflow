import assert from "node:assert/strict";
import test from "node:test";
import { requestDriveMigration } from "./drive-migration-client";
import type { DriveMigrationSummary } from "./drive-migration";

const summary: DriveMigrationSummary = { status: "copying", prepared: true, total: 7175, copied: 445, currentFile: "photo.png" };

test("retryable batches expose saved progress, retry, and then continue from the new summary", async () => {
  const waits: number[] = [];
  const counts: number[] = [];
  let calls = 0;
  const result = await requestDriveMigration("step", {
    language: "ja", active: () => true, onSummary: item => counts.push(item.copied), wait: async ms => { waits.push(ms); },
    fetch: async () => ++calls === 1 ? Response.json({ error: "photo.png: timeout", retryable: true, summary }, { status: 503 })
      : Response.json({ summary: { ...summary, copied: 469 } }),
  });
  assert.equal(result?.copied, 469);
  assert.deepEqual(counts, [445, 469]);
  assert.deepEqual(waits, [1000]);
});

test("repeated timeouts stop after three retries and preserve saved progress", async () => {
  const waits: number[] = [];
  let calls = 0;
  let last = 0;
  await assert.rejects(requestDriveMigration("step", {
    language: "ja", active: () => true, onSummary: item => { last = item.copied; }, wait: async ms => { waits.push(ms); },
    fetch: async () => { calls++; return Response.json({ error: "photo.png: timeout", retryable: true, summary }, { status: 503 }); },
  }), /photo.png/);
  assert.equal(calls, 4);
  assert.equal(last, 445);
  assert.deepEqual(waits, [1000, 2000, 4000]);
});

test("pausing while waiting to retry does not start another request", async () => {
  let active = true;
  let calls = 0;
  const result = await requestDriveMigration("step", {
    language: "ja", active: () => active, onSummary: () => undefined, wait: async () => { active = false; },
    fetch: async () => { calls++; throw new TypeError("fetch failed"); },
  });
  assert.equal(result, null);
  assert.equal(calls, 1);
});

test("browser-specific connection failures retry while request configuration errors do not", async () => {
  for (const error of [new TypeError("Failed to fetch"), new TypeError("Load failed"), new DOMException("network interrupted", "NetworkError")]) {
    let calls = 0;
    const result = await requestDriveMigration("step", {
      language: "en", active: () => true, onSummary: () => undefined, wait: async () => undefined,
      fetch: async () => { if (++calls === 1) throw error; return Response.json({ summary }); },
    });
    assert.equal(result?.copied, 445);
    assert.equal(calls, 2);
  }
  let calls = 0;
  await assert.rejects(requestDriveMigration("step", {
    language: "en", active: () => true, onSummary: () => undefined, wait: async () => { throw new Error("must not retry"); },
    fetch: async () => { calls++; throw new TypeError("Failed to parse URL"); },
  }), /parse URL/);
  assert.equal(calls, 1);
});

test("authentication and permanent errors stop without retrying", async () => {
  for (const response of [Response.json({ error: "Session expired" }, { status: 401 }), Response.json({ error: "source changed" }, { status: 400 })]) {
    let calls = 0;
    await assert.rejects(requestDriveMigration("step", {
      language: "ja", active: () => true, onSummary: () => undefined,
      wait: async () => { throw new Error("must not retry"); }, fetch: async () => { calls++; return response; },
    }));
    assert.equal(calls, 1);
  }
});
