import assert from "node:assert/strict";
import test from "node:test";
import { embeddingConfig } from "./rag-config";
import { embedRagInputs } from "./rag-provider-embeddings.server";
import { ragIndexId, isCurrentRagIndex, isPrivateRagPath, splitRagText, deleteSingleFileFromRag, registerSingleFile, extractOfficeText } from "./rag-index.server";
import { zipSync, strToU8 } from "fflate";
import { assertRagAccess } from "./rag-access.server";
import { DEFAULT_RAG_SETTING } from "~/types/settings";
import { buildInteractionsTools } from "./gemini-interactions.server";
import { handleRagAction } from "./sync-rag.server";
import type { HubworkAccount } from "~/types/hubwork";

test("RAG indexes isolate workspaces, model spaces and chunking versions", () => {
  const gemini = { ...DEFAULT_RAG_SETTING, embeddingProvider: "gemini" as const, embeddingModel: "gemini-embedding-2" };
  const openai = { ...gemini, embeddingProvider: "openai" as const, embeddingModel: "text-embedding-3-small" };
  const id = ragIndexId("root-one", "notes", gemini);
  assert.notEqual(id, ragIndexId("root-two", "notes", gemini));
  assert.notEqual(id, ragIndexId("root-one", "notes", openai));
  assert.notEqual(id, ragIndexId("root-one", "notes", { ...gemini, chunkSize: 2000 }));
  assert.equal(isCurrentRagIndex({ ...gemini, storeName: id }, "root-one", "notes"), true);
  assert.equal(isCurrentRagIndex({ ...gemini, storeName: id }, "root-two"), false);
  assert.equal(isCurrentRagIndex({ ...openai, storeName: id }, "root-one"), false);
  assert.equal(isCurrentRagIndex({ ...gemini, storeName: "fileSearchStores/legacy" }, "root-one"), false);
  assert.equal(embeddingConfig({ embeddingModel: "models/gemini-embedding-2" }).model, "gemini-embedding-2");
});

test("OpenAI uses its embedding endpoint and pads vectors without changing cosine similarity", async (t) => {
  const vector = Array.from({ length: 1536 }, (_, i) => (i % 10) / 10);
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    assert.equal(url, "https://api.openai.com/v1/embeddings");
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, "text-embedding-3-small");
    assert.equal(body.dimensions, 1536); assert.deepEqual(body.input, ["日本語の質問"]);
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer synthetic-key");
    return Response.json({ data: [{ embedding: vector }] });
  });
  const [padded] = await embedRagInputs(["日本語の質問"], { apiKey: "synthetic-key", provider: "openai", model: "text-embedding-3-small", query: true });
  assert.equal(padded.length, 2048); assert.deepEqual(padded.slice(0, 1536), vector);
  assert.ok(padded.slice(1536).every((value) => value === 0));
  assert.equal(padded.reduce((sum, value) => sum + value * value, 0), vector.reduce((sum, value) => sum + value * value, 0));
});

test("Gemini Embedding 2 uses task prefixes instead of unsupported taskType", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    assert.match(String(url), /gemini-embedding-2:(embedContent|batchEmbedContents)/);
    const request = JSON.parse(String(init.body));
    const body = request.requests?.[0] || request;
    assert.equal(body.taskType, undefined); assert.equal(body.outputDimensionality, 2048);
    assert.match(body.content.parts[0].text, calls++ === 0 ? /^title: none \| text:/ : /^task: search result \| query:/);
    return Response.json({ embeddings: [{ values: Array(2048).fill(0.1) }] });
  });
  await embedRagInputs(["文書"], { apiKey: "synthetic-key", provider: "gemini", model: "gemini-embedding-2" });
  await embedRagInputs(["質問"], { apiKey: "synthetic-key", provider: "gemini", model: "gemini-embedding-2", query: true });
  assert.equal(calls, 2);
});

test("embedding errors and unsupported OpenAI media fail before any index replacement", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: [{ embedding: [0, Number.NaN] }] }));
  await assert.rejects(embedRagInputs(["text"], { apiKey: "synthetic-key", provider: "openai", model: "text-embedding-3-large" }), /dimensions/);
  await assert.rejects(embedRagInputs([{ inlineData: { mimeType: "image/png", data: "AA==" } }], { apiKey: "synthetic-key", provider: "openai", model: "text-embedding-3-small" }), /accept text/);
});

test("paid RAG entitlement rejects missing, disabled and canceled accounts", async () => {
  for (const account of [null, { plan: "pro", accountStatus: "disabled", billingStatus: "active" }, { plan: "pro", accountStatus: "enabled", billingStatus: "canceled" }, { plan: null, accountStatus: "enabled", billingStatus: "active" }]) {
    const deps = { isFirestoreAvailable: () => true, getAccountByRootFolderId: async () => account as HubworkAccount | null, getAccountByOrganization: async () => account as HubworkAccount | null };
    await assert.rejects(assertRagAccess("root", undefined, deps), (error: unknown) => error instanceof Response && error.status === 403);
  }
  const paid = { plan: "lite", accountStatus: "enabled", billingStatus: "active" } as HubworkAccount;
  await assert.doesNotReject(assertRagAccess("root", undefined, { isFirestoreAvailable: () => true, getAccountByRootFolderId: async () => paid, getAccountByOrganization: async () => paid }));
});

test("automatic registration checks the paid plan before reading a file or embedding", async () => {
  await assert.rejects(handleRagAction("ragRegister", { fileName: "notes.md", content: "test" }, { validTokens: { rootFolderId: "root", accessToken: "token", geminiApiKey: "key" }, jsonWithCookie: Response.json }, {
    assertRagAccess: async () => { throw new Response("Paid plan required", { status: 403 }); },
    getSettings: async () => assert.fail("unpaid request read settings"),
  } as never), (error: unknown) => error instanceof Response && error.status === 403);
});

test("Firestore deletion refuses a document handle from a different workspace", async () => {
  const handle = ragIndexId("other-owner", "notes", DEFAULT_RAG_SETTING);
  await assert.rejects(deleteSingleFileFromRag("", `${handle}/doc/bm90ZXMubWQ`, { rootFolderId: "my-root" }), /different workspace/);
});

test("system credentials, configured secrets and encrypted files are excluded from RAG", () => {
  for (const path of ["settings.json", "_encrypted-auth.json", "_sync-meta.json", "Secrets/key.md", ".hidden/key", "../other", "notes.encrypted", "Private/secrets/key.md"]) {
    assert.equal(isPrivateRagPath(path, path.startsWith("Private/") ? "Private/secrets" : "Secrets"), true, path);
  }
  assert.equal(isPrivateRagPath("Notes/meeting.md"), false);
  assert.equal(splitRagText("a".repeat(300), 150, 20).join("").length, 340);
});

test("native File Search tools cannot be sent to Gemini anymore", () => {
  assert.throws(() => buildInteractionsTools([], false, "gemini-3.8-flash", ["fileSearchStores/legacy"]), /Firestore RAG/);
});

test("an embedding failure leaves the previous document intact without any Firestore writes", async () => {
  const handle = ragIndexId("root", "notes", DEFAULT_RAG_SETTING);
  await assert.rejects(registerSingleFile("synthetic-key", handle, "Notes/a.md", "new text", null, { rootFolderId: "root" }, {
    assertRagAccess: async () => {},
    embedRagInputs: async () => { throw new Error("Provider unavailable"); },
    getFirestore: () => assert.fail("Old chunks must survive an embedding failure"),
  }), /Provider unavailable/);
});

test("document replacement writes all new chunks before removing obsolete ones", async () => {
  const setting = { ...DEFAULT_RAG_SETTING, chunkSize: 100, chunkOverlap: 0 };
  const events: string[] = [];
  const writes: Record<string, unknown>[] = [];
  const query = { where() { return this; }, get: async () => ({ docs: [{ id: "obsolete", ref: { id: "obsolete" } }] }) };
  const db = {
    collection: () => ({ ...query, doc: (id: string) => ({ id }) }),
    batch: () => ({
      set: (_ref: unknown, data: Record<string, unknown>) => { writes.push(data); events.push("set"); },
      delete: (ref: { id: string }) => events.push(`delete:${ref.id}`),
      commit: async () => { events.push("commit"); },
    }),
  };
  await registerSingleFile("synthetic-key", ragIndexId("root", "notes", setting), "Notes/a.md", "a".repeat(150), null, { rootFolderId: "root" }, {
    assertRagAccess: async () => {}, embedRagInputs: async (inputs) => inputs.map(() => Array(2048).fill(0.1)), getFirestore: () => db as never,
  });
  assert.deepEqual(events, ["set", "set", "commit", "delete:obsolete", "commit"]);
  assert.ok(writes.every((write) => write.orgId === "personal-rag-v1" && write.docPath === "Notes/a.md"));
});

test("Office text extraction preserves Word paragraphs and Excel shared strings", () => {
  assert.match(extractOfficeText("a.docx", zipSync({ "word/document.xml": strToU8("<w:document><w:p><w:t>日本語 &amp; English</w:t></w:p></w:document>") }))!, /日本語 & English/);
  const sheet = zipSync({ "xl/sharedStrings.xml": strToU8("<sst><si><t>Revenue</t></si></sst>"), "xl/worksheets/sheet1.xml": strToU8('<worksheet><row><c t="s"><v>0</v></c><c><v>42</v></c></row></worksheet>') });
  assert.match(extractOfficeText("a.xlsx", sheet)!, /Revenue.*42/);
  assert.throws(() => extractOfficeText("a.doc", new Uint8Array()), /Convert legacy/);
});
