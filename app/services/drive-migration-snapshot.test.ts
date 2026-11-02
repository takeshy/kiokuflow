import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "@google-cloud/firestore";
import type { HubworkAccount } from "~/types/hubwork";
import { captureLegacyDriveMigration } from "./drive-migration.server";

test("login snapshots old credentials once, before account rebinding, and keeps them on retries", async t => {
  for (const [key, value] of Object.entries({ GOOGLE_MIGRATION_CLIENT_ID: "old-client", GOOGLE_MIGRATION_CLIENT_SECRET: "old-secret", GOOGLE_CLIENT_ID: "new-client" })) {
    const prior = process.env[key]; process.env[key] = value;
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
  let stored: Record<string, unknown> | undefined;
  const transaction = {
    get: async () => ({ exists: !!stored, data: () => stored }),
    create: (_ref: unknown, data: Record<string, unknown>) => { assert.equal(stored, undefined); stored = structuredClone(data); },
  };
  const inspectSource = async () => true;
  const store = { collection: () => ({ doc: () => ({ get: transaction.get }) }),
    runTransaction: async (run: (tx: typeof transaction) => Promise<boolean>) => run(transaction),
  } as unknown as Firestore;
  const account = { id: "account", email: "owner@example.com", rootFolderId: "old-root", encryptedRefreshToken: "old-ciphertext" } as HubworkAccount;
  assert.equal(await captureLegacyDriveMigration(account, "new-root", store, inspectSource), true);
  assert.equal(stored?.sourceRoot, "old-root");
  assert.equal(stored?.targetRoot, "new-root");
  assert.equal(stored?.encryptedRefreshToken, "old-ciphertext");
  assert.notEqual(stored?.sourceClient, "old-client");
  // The billing account now has the new token/root. A repeat login must not overwrite its snapshot.
  assert.equal(await captureLegacyDriveMigration({ ...account, rootFolderId: "new-root", encryptedRefreshToken: "new-ciphertext" }, "new-root", store, inspectSource), true);
  assert.equal(stored?.encryptedRefreshToken, "old-ciphertext");
  await assert.rejects(captureLegacyDriveMigration({ ...account, email: "other@example.com" }, "new-root", store));
  await assert.rejects(captureLegacyDriveMigration(account, "different-destination", store));
  stored!.status = "complete";
  assert.equal(await captureLegacyDriveMigration(account, "new-root", store), false);
});

test("an unchanged workspace does not get a copy job", async t => {
  const values = { GOOGLE_MIGRATION_CLIENT_ID: "old", GOOGLE_MIGRATION_CLIENT_SECRET: "secret", GOOGLE_CLIENT_ID: "new" };
  for (const [key, value] of Object.entries(values)) {
    const prior = process.env[key]; process.env[key] = value;
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
  let creates = 0;
  const transaction = { get: async () => ({ exists: false }), create: () => { creates++; } };
  const store = { collection: () => ({ doc: () => ({ get: transaction.get }) }), runTransaction: async (run: (tx: typeof transaction) => Promise<boolean>) => run(transaction) } as unknown as Firestore;
  assert.equal(await captureLegacyDriveMigration({ id: "account", email: "owner@example.com", rootFolderId: "same", encryptedRefreshToken: "cipher" } as HubworkAccount, "same", store), false);
  assert.equal(await captureLegacyDriveMigration({ id: "account", email: "owner@example.com", rootFolderId: "stale", encryptedRefreshToken: "cipher" } as HubworkAccount, "new-root", store, async () => false), false);
  assert.equal(creates, 0);
});
