// This suite exercises the hosted Firestore path.
process.env.KIOKUFLOW_RUNTIME = "hosted";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { Firestore } from "@google-cloud/firestore";
import { executeWorkflow } from "./executor";
import { executeWorkflowLocally } from "./local-executor";
import type { ExecutionLog, Workflow } from "./types";
import { DEFAULT_RAG_SETTING, DEFAULT_USER_SETTINGS, type UserSettings } from "~/types/settings";
import { ragIndexId } from "~/services/rag-index.server";
import { clearSettingsCache } from "~/services/user-settings.server";
import { SETTINGS_FILE_NAME } from "~/services/sync-diff";

for (const mode of ["server", "local"] as const) test(`${mode} workflow logs reranking warnings even when the AI response omits them`, async t => {
  const previous = process.env.GCE_METADATA_HOST;
  process.env.GCE_METADATA_HOST = "metadata.test.invalid";
  t.after(() => { clearSettingsCache(); if (previous === undefined) delete process.env.GCE_METADATA_HOST; else process.env.GCE_METADATA_HOST = previous; });
  clearSettingsCache();
  const rootFolderId = `workflow-warning-${mode}`;
  const setting = { ...DEFAULT_RAG_SETTING, embeddingProvider: "openai" as const, embeddingModel: "text-embedding-3-large", rerankProvider: "gemini" as const, hybridSearch: false };
  const storeId = ragIndexId(rootFolderId, "notes", setting);
  const settings: UserSettings = { ...DEFAULT_USER_SETTINGS, selectedModel: "gpt-6.1-sol", ragSettings: { notes: { ...setting, storeId, storeName: storeId } } };
  const warning = "gemini reranking key is not configured or unlocked; returning original search results.";
  t.mock.method(Firestore.prototype, "collection", (name: string) => {
    assert.ok(["hubwork-accounts", "ragChunks"].includes(name));
    const chain = {
      where() { return chain; }, limit() { return chain; }, findNearest() { return chain; },
      get: async () => ({ empty: false, docs: [{ id: "hit", data: () => name === "hubwork-accounts"
        ? { plan: "pro", accountStatus: "enabled", billingStatus: "active" }
        : { docPath: "notes.md", text: "The launch is Friday.", distance: 0.1, metadata: {}, updatedAt: 0 } }] }),
    };
    return chain as never;
  });
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "settings", name: SETTINGS_FILE_NAME }] });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/settings")) return Response.json(settings);
    if (url === "https://api.openai.com/v1/embeddings") return Response.json({ data: [{ embedding: Array(2048).fill(0.1) }] });
    if (url === "/api/rag/context") return Response.json({ sources: ["notes.md"], contexts: [{ source: "notes.md", text: "The launch is Friday." }], warnings: [warning] });
    assert.equal(url, mode === "server" ? "https://api.openai.com/v1/responses" : "/api/openai/responses");
    assert.match(JSON.parse(String(init?.body)).instructions, /Retrieval warning/);
    const events = [{ type: "response.output_text.delta", delta: "Friday." }, { type: "response.completed", response: { status: "completed", output: [] } }];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
  });
  const workflow: Workflow = {
    nodes: new Map([["ask", { id: "ask", type: "command", properties: { prompt: "When is the launch?", ragSetting: "notes", model: "gpt-6.1-sol", saveTo: "answer" } }]]),
    edges: [], startNode: "ask",
  };
  const logs: ExecutionLog[] = [];
  const result = mode === "server"
    ? await executeWorkflow(workflow, { variables: new Map() }, { driveAccessToken: "synthetic", driveRootFolderId: rootFolderId, driveHistoryFolderId: "", openaiApiKey: "synthetic", settings }, log => logs.push(log))
    : await executeWorkflowLocally(workflow, {
      onLog: log => logs.push(log), onDriveEvent: () => {},
      promptCallbacks: { promptForValue: async () => assert.fail("Unexpected prompt"), promptForDialog: async () => assert.fail("Unexpected prompt"), promptForDriveFile: async () => assert.fail("Unexpected prompt") },
    }, { workflowId: "warnings", settings });
  assert.equal(result.historyRecord?.status, "completed");
  assert.equal(result.context.variables.get("answer"), "Friday.");
  assert.ok(logs.some(log => log.nodeId === "ask" && log.message === `RAG warning: ${warning}`));
  assert.ok(logs.some(log => log.message === "RAG sources: notes.md"));
  assert.ok(result.context.logs.some(log => log.message === `RAG warning: ${warning}`));
});
