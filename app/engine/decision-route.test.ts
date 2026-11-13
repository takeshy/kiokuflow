import assert from "node:assert/strict";
import test from "node:test";
import { action } from "~/routes/api.workflow.execute-node";
import { action as executeFull } from "~/routes/api.workflow.execute-full";
import { commitSession, setTokens } from "~/services/session.server";
import { clearSettingsCache } from "~/services/user-settings.server";
import { DEFAULT_USER_SETTINGS } from "~/types/settings";

for (const fixture of [
  { properties: {}, answer: { type: "choice", choice: "false" }, saved: "false", branch: false, result: false },
  { properties: { decisionType: "score", criteria: '["Low","High"]' }, answer: { type: "score", score: 0.8 }, saved: 0.8, branch: true, result: 0.8 },
  { properties: { decisionType: "choice", criteria: '{"a":"A","b":"B"}', branches: '{"a":"node-a","b":"end"}' }, answer: { type: "choice", choice: "b" }, saved: "b", branch: "b", result: "b" },
]) {
  test(`execute-node returns validated ${fixture.answer.type} result and route with session keys`, async t => {
    clearSettingsCache();
    const previousRuntime = process.env.KIOKUFLOW_RUNTIME;
    process.env.KIOKUFLOW_RUNTIME = "hosted";
    t.after(() => { if (previousRuntime === undefined) delete process.env.KIOKUFLOW_RUNTIME; else process.env.KIOKUFLOW_RUNTIME = previousRuntime; clearSettingsCache(); });
    t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "credentials", name: "settings.json" }] });
      if (url.startsWith("https://www.googleapis.com/drive/v3/files/credentials")) {
        // Decision requests must work even if the unrelated Vertex chat setup is incomplete.
        return Response.json({ ...DEFAULT_USER_SETTINGS, usePersonalVertex: true, personalVertexSource: "own", personalVertexProjectId: "" });
      }
      assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/decisions");
      assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "synthetic-decision-secret");
      return Response.json({ answers: { decision: fixture.answer } });
    });
    const session = await setTokens(new Request("https://app.example"), {
      accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiryTime: Date.now() + 3600_000,
      rootFolderId: "decision-route-tests", email: "tester@example.com", geminiApiKey: "synthetic-decision-secret",
    });
    const request = new Request("https://app.example/api/workflow/execute-node", {
      method: "POST", headers: { Origin: "https://app.example", "Content-Type": "application/json", Cookie: (await commitSession(session)).split(";")[0] },
      body: JSON.stringify({ nodeId: "judge", nodeType: "decision", properties: { prompt: "Check", input: "{{text}}", saveTo: "answer", ...fixture.properties }, variables: { text: "Input text" } }),
    });
    const response = await action({ request, params: {}, context: {} } as never);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.variables.answer, fixture.saved);
    assert.equal(payload.variables.text, "Input text");
    assert.equal(payload.decision.result, fixture.result);
    assert.equal(payload.decision.branch, fixture.branch);
    assert.equal(JSON.stringify(payload).includes("synthetic-decision-secret"), false);
  });
}

for (const withChatNode of [false, true]) {
  test(`full execution keeps decision credentials independent of Vertex (chat node: ${withChatNode})`, async t => {
    clearSettingsCache();
    const previousRuntime = process.env.KIOKUFLOW_RUNTIME;
    process.env.KIOKUFLOW_RUNTIME = "hosted";
    t.after(() => {
      if (previousRuntime === undefined) delete process.env.KIOKUFLOW_RUNTIME;
      else process.env.KIOKUFLOW_RUNTIME = previousRuntime;
      clearSettingsCache();
    });
    let decisions = 0;
    t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return Response.json({ files: [{ id: "full-settings", name: "settings.json" }] });
      if (url.startsWith("https://www.googleapis.com/drive/v3/files/full-settings")) {
        return Response.json({
          ...DEFAULT_USER_SETTINGS,
          usePersonalVertex: true,
          personalVertexSource: withChatNode ? "prepaid" : "own",
          personalVertexProjectId: "",
        });
      }
      assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/decisions");
      assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "synthetic-full-secret");
      decisions++;
      return Response.json({ answers: { decision: { type: "choice", choice: "true" } } });
    });
    const session = await setTokens(new Request("https://app.example"), {
      accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiryTime: Date.now() + 3600_000,
      rootFolderId: "decision-full-tests", email: "tester@example.com", geminiApiKey: "synthetic-full-secret",
    });
    // The unused command exercises a context containing both Vertex chat
    // credentials and the dedicated decision API key.
    const workflowYaml = [
      "nodes:",
      "  - id: judge", "    type: decision", "    prompt: Check", "    saveTo: answer",
      "    trueNext: end", "    falseNext: end",
      ...(withChatNode ? ["  - id: unused-chat", "    type: command", "    prompt: Unused"] : []),
    ].join("\n");
    const request = new Request("https://app.example/api/workflow/execute-full", {
      method: "POST",
      headers: { Origin: "https://app.example", "Content-Type": "application/json", Cookie: (await commitSession(session)).split(";")[0] },
      body: JSON.stringify({ workflowYaml }),
    });
    const response = await executeFull({ request, params: {}, context: {} } as never);
    assert.equal(response.status, 200);
    const stream = await response.text();
    const event = stream.split("\n\n").find(chunk => chunk.startsWith("event: result\n"));
    assert.ok(event, stream);
    const result = JSON.parse(event.split("\ndata: ")[1]);
    assert.equal(decisions, 1);
    assert.equal(result.status, "completed");
    assert.equal(result.variables.answer, "true");
    assert.equal(result.historyRecord.steps[0].output, true);
    assert.equal(stream.includes("synthetic-full-secret"), false);
  });
}
