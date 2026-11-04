import assert from "node:assert/strict";
import test from "node:test";
import { runSyncStep } from "./sync-step";

test("a stalled browser request is aborted and reports the stalled step", async () => {
  let requestSignal: AbortSignal | undefined;
  await assert.rejects(runSyncStep("reading Drive metadata", (signal) => {
    requestSignal = signal;
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  }, 10), /timed out: reading Drive metadata.*Local changes are kept/);
  assert.equal(requestSignal?.aborted, true);
});

test("a stalled cache operation releases the caller even without cancellation support", async () => {
  await assert.rejects(runSyncStep("saving local edits", () => new Promise(() => {}), 10), /saving local edits/);
});

test("successful and failed steps finish without retrying the operation", async () => {
  assert.equal(await runSyncStep("reading Drive metadata", async () => "meta"), "meta");
  let attempts = 0;
  const error = new Error("Connection lost");
  await assert.rejects(runSyncStep("uploading files", async () => { attempts++; throw error; }), (actual) => actual === error);
  assert.equal(attempts, 1);
});
