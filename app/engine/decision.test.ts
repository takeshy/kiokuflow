import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkflowData, parseWorkflowYaml, serializeWorkflow, getNextNodes } from "./parser";
import { executeWorkflow } from "./executor";
import { executeWorkflowLocally, type LocalExecuteCallbacks } from "./local-executor";
import { handleDecisionNode } from "./handlers/decision";
import { requestDecision, requestDecisions, type DecisionDefinition } from "./decision";
import { getWorkflowNodeSpec } from "./workflowSpec";
import { workflowToMermaid } from "~/utils/workflow-to-mermaid";
import type { ExecutionContext, ServiceContext, WorkflowNode } from "./types";

const services: ServiceContext = { driveAccessToken: "", driveRootFolderId: "", driveHistoryFolderId: "", geminiApiKey: "test-gemini", jevApiKey: "test-jev", compatibleApiKeys: { openrouter: "test-router" } };
const context = (): ExecutionContext => ({ variables: new Map([["text", "An urgent request"], ["threshold", "1.5"]]), logs: [] });
const node = (properties: Record<string, string> = {}): WorkflowNode => ({ id: "judge", type: "decision", properties: { prompt: "Is {{text}} urgent?", input: "{{text}}", saveTo: "answer", ...properties } });
const workflow = (properties: Record<string, unknown> = {}) => parseWorkflowData({ nodes: [
  { id: "judge", type: "decision", prompt: "Is {{text}} urgent?", input: "{{text}}", saveTo: "answer", trueNext: "yes", falseNext: "no", ...properties },
  { id: "yes", type: "set", name: "route", value: "yes", next: "end" },
  { id: "no", type: "set", name: "route", value: "no", next: "end" },
] });

for (const fixture of [
  { properties: {}, answer: { type: "choice", choice: "true" }, value: "true", route: "yes" },
  { properties: {}, answer: { type: "choice", choice: "false" }, value: "false", route: "no" },
  { properties: { decisionType: "score", criteria: ["Low", "Medium", "High"], threshold: "{{threshold}}" }, answer: { type: "score", score: 1.5 }, value: 1.5, route: "yes" },
  { properties: { decisionType: "score", criteria: ["Low", "Medium", "High"] }, answer: { type: "score", score: 0.9 }, value: 0.9, route: "no" },
  { properties: { decisionType: "noul" }, answer: { type: "noul", noul: 0.5 }, value: 0.5, route: "yes" },
  { properties: { decisionType: "noul" }, answer: { type: "noul", noul: 0.49 }, value: 0.49, route: "no" },
  { properties: { decisionType: "choice", criteria: { true: "A", false: "B" }, branches: { true: "no", false: "yes" } }, answer: { type: "choice", choice: "true" }, value: "true", route: "no" },
  { properties: { decisionType: "choice", criteria: { urgent: "Now", normal: "Later" }, branches: { urgent: "end", normal: "no" } }, answer: { type: "choice", choice: "urgent" }, value: "urgent", route: undefined },
]) {
  test(`server routes and records ${JSON.stringify(fixture.properties)} / ${JSON.stringify(fixture.answer)}`, async t => {
    t.mock.method(globalThis, "fetch", async (_url, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.input[0].text, "An urgent request");
      assert.match(body.questions.decision.instructions, /Is An urgent request urgent/);
      return Response.json({ answers: { decision: fixture.answer } });
    });
    const parsed = workflow(fixture.properties);
    const restored = parseWorkflowYaml(serializeWorkflow(parsed));
    assert.deepEqual(restored.edges, parsed.edges);
    const result = await executeWorkflow(restored, context(), services);
    assert.equal(result.historyRecord?.status, "completed");
    assert.equal(result.context.variables.get("answer"), fixture.value);
    assert.equal(result.context.variables.get("route"), fixture.route);
    assert.equal(result.historyRecord?.steps[0].status, "success");
    assert.equal(result.historyRecord?.steps[0].variablesSnapshot?.text, "An urgent request");
    assert.equal(result.historyRecord?.steps[0].input?.model, "gemini-decision-1");
  });
}

for (const model of ["gemini-decision-1", "jev", "openrouter"]) {
  test(`decision selects ${model} independently of the chat model`, async t => {
    t.mock.method(globalThis, "fetch", async (url, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      if (model === "gemini-decision-1") {
        assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/decisions");
        assert.equal(headers.get("x-goog-api-key"), "test-gemini");
        assert.equal(body.model, model);
        assert.ok(body.input); assert.equal(body.state, undefined);
      } else {
        assert.equal(url, model === "jev" ? "https://api.typesafe.ai/v1/systemone" : "https://openrouter.ai/api/alpha/decisions");
        assert.equal(headers.get("authorization"), `Bearer test-${model === "jev" ? "jev" : "router"}`);
        assert.equal(body.model, model === "jev" ? "jev-latest" : "~typesafe/jev-latest");
        assert.equal(body.state, "An urgent request"); assert.equal(body.input, undefined);
      }
      return Response.json({ answers: { decision: { type: "choice", choice: "false" } } });
    });
    assert.equal((await handleDecisionNode(node({ model }), context(), services)).branch, false);
  });
}

test("Jev respects its configured OpenRouter switch", async t => {
  t.mock.method(globalThis, "fetch", async (url, init?: RequestInit) => {
    assert.equal(url, "https://openrouter.ai/api/alpha/decisions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-router");
    return Response.json({ answers: { decision: { type: "choice", choice: "true" } } });
  });
  const { DEFAULT_USER_SETTINGS } = await import("~/types/settings");
  await handleDecisionNode(node({ model: "jev" }), context(), { ...services, settings: { ...DEFAULT_USER_SETTINGS, jev: { useOpenRouter: true } } });
});

const questions = {
  urgency: { type: "score", instructions: "Rate {{text}}", criteria: ["Low", "Medium", "High"] },
  refund: { type: "boolean", instructions: "Requests a refund" },
  chance: { type: "noul", instructions: "Will follow up" },
  category: { type: "choice", instructions: "Classify", criteria: { urgent: "Now", normal: "Later" } },
};
const batchAnswers = { urgency: { type: "score", score: 1.8 }, refund: { type: "choice", choice: "false" }, chance: { type: "noul", noul: 0.7 }, category: { type: "choice", choice: "urgent" } };

test("batch saves all typed answers and continues to a downstream if node", async t => {
  t.mock.method(globalThis, "fetch", async (_url, init?: RequestInit) => {
    assert.match(JSON.parse(String(init?.body)).questions.urgency.instructions, /Rate An urgent request/);
    return Response.json({ answers: batchAnswers });
  });
  const parsed = parseWorkflowData({ nodes: [
    { id: "judge", type: "decision", decisionType: "batch", input: "{{text}}", questions, saveTo: "answers", next: "check" },
    { id: "check", type: "if", condition: "{{answers.urgency}} >= 1", trueNext: "yes", falseNext: "end" },
    { id: "yes", type: "set", name: "route", value: "yes" },
  ] });
  const result = await executeWorkflow(parseWorkflowYaml(serializeWorkflow(parsed)), context(), services);
  assert.equal(result.historyRecord?.status, "completed");
  assert.deepEqual(JSON.parse(String(result.context.variables.get("answers"))), { urgency: 1.8, refund: false, chance: 0.7, category: "urgent" });
  assert.equal(result.context.variables.get("route"), "yes");
  assert.deepEqual(result.historyRecord?.steps[0].output, { urgency: 1.8, refund: false, chance: 0.7, category: "urgent" });
});

for (const answer of [undefined, { type: "choice", choice: true }, { type: "choice", choice: "yes" }, { type: "score", score: 1 }]) {
  test(`invalid boolean response fails without saving or taking a route: ${JSON.stringify(answer)}`, async t => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ answers: { decision: answer } }));
    const result = await executeWorkflow(workflow(), context(), services);
    assert.equal(result.historyRecord?.status, "error");
    assert.equal(result.context.variables.has("answer"), false);
    assert.equal(result.context.variables.has("route"), false);
  });
}

for (const [definition, answer] of [
  [{ type: "score", criteria: ["Low", "High"] }, { type: "score", score: 2 }],
  [{ type: "score", criteria: ["Low", "High"] }, { type: "score", score: "1" }],
  [{ type: "noul" }, { type: "noul", noul: -0.1 }],
  [{ type: "noul" }, { type: "noul", noul: 1.1 }],
  [{ type: "choice", criteria: { a: "A", b: "B" } }, { type: "choice", choice: "c" }],
] as [DecisionDefinition, unknown][]) {
  test(`rejects out-of-contract typed answer ${JSON.stringify(answer)}`, async () => {
    await assert.rejects(requestDecision("Evaluate", "Input", { provider: "gemini", apiKey: "key", fetchImpl: async () => Response.json({ answers: { decision: answer } }) }, definition), /invalid or incomplete/);
  });
}

test("incomplete batch responses leave the previous saved result intact", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ answers: { urgency: batchAnswers.urgency } }));
  const ctx = context(); ctx.variables.set("answers", "previous");
  await assert.rejects(handleDecisionNode(node({ decisionType: "batch", questions: JSON.stringify(questions), saveTo: "answers" }), ctx, services), /invalid or incomplete/);
  assert.equal(ctx.variables.get("answers"), "previous");
});

for (const properties of [
  { decisionType: "score", criteria: '["Only one"]' },
  { decisionType: "score", criteria: '["Low","High"]', threshold: "2" },
  { decisionType: "noul", threshold: "nope" },
  { decisionType: "choice", criteria: '{"a":"A","b":"B"}', branches: '{"a":"end"}' },
  { decisionType: "batch", questions: JSON.stringify(questions), saveTo: "" },
  { decisionType: "batch", questions: "{}" },
  { model: "chat-model" },
]) {
  test(`invalid configuration fails before requesting the API: ${JSON.stringify(properties)}`, async t => {
    t.mock.method(globalThis, "fetch", () => assert.fail("Invalid configuration must not reach the API"));
    await assert.rejects(handleDecisionNode(node(properties), context(), services));
  });
}

test("locked provider keys fail instead of switching providers", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No unlocked key"));
  await assert.rejects(handleDecisionNode(node(), context(), { ...services, geminiApiKey: undefined }), /not configured or unlocked/);
  await assert.rejects(handleDecisionNode(node({ model: "jev" }), context(), { ...services, jevApiKey: undefined }), /not configured or unlocked/);
});

test("API errors fail the workflow; cancellation interrupts an in-flight decision", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("failure", { status: 503 }));
  const result = await executeWorkflow(workflow(), context(), services);
  assert.equal(result.historyRecord?.status, "error");
  assert.match(result.historyRecord?.steps[0].error || "", /HTTP 503/);
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", () => { controller.abort(); return new Promise<Response>(() => {}); });
  const cancelled = await executeWorkflow(workflow(), context(), services, undefined, { abortSignal: controller.signal });
  assert.equal(cancelled.historyRecord?.status, "cancelled");
  assert.equal(cancelled.context.variables.has("answer"), false);
});

test("retries rate limiting within the decision deadline", async () => {
  let attempts = 0;
  const result = await requestDecision("Check", "Input", { provider: "jev", apiKey: "key", fetchImpl: async () => ++attempts === 1
    ? new Response(null, { status: 429, headers: { "Retry-After": "0" } })
    : Response.json({ answers: { decision: { type: "choice", choice: "true" } } }) });
  assert.equal(result, true); assert.equal(attempts, 2);
});

test("decision deadline stops a request even if the transport ignores abort", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = requestDecisions("Input", { q: { type: "boolean", instructions: "Check" } }, { provider: "gemini", apiKey: "key", fetchImpl: () => new Promise<Response>(() => {}) });
  const rejected = assert.rejects(pending, /timed out/);
  t.mock.timers.tick(20_000);
  await rejected;
});

const callbacks: LocalExecuteCallbacks = { onLog: () => {}, onDriveEvent: () => {}, promptCallbacks: {} as LocalExecuteCallbacks["promptCallbacks"] };
for (const choice of ["true", "false"]) {
  test(`local execution routes a delegated ${choice} decision and records its output`, async t => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (url, init?: RequestInit) => {
      calls++;
      assert.equal(url, "/api/workflow/execute-node");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.nodeType, "decision");
      assert.equal(body.variables.text, "An urgent request");
      assert.equal(body.geminiApiKey, undefined);
      return Response.json({ variables: { ...body.variables, answer: choice }, decision: { result: choice === "true", branch: choice === "true", input: { prompt: "Is it urgent?" } } });
    });
    const result = await executeWorkflowLocally(workflow(), callbacks, { workflowId: "test", initialVariables: { text: "An urgent request" } });
    assert.equal(calls, 1);
    assert.equal(result.historyRecord.status, "completed");
    assert.equal(result.context.variables.get("route"), choice === "true" ? "yes" : "no");
    assert.equal(result.historyRecord.steps[0].output, choice === "true");
  });
}

test("local decision API failures stop downstream execution", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Decision failed" }, { status: 500 }));
  const result = await executeWorkflowLocally(workflow(), callbacks, { workflowId: "test" });
  assert.equal(result.historyRecord.status, "error");
  assert.equal(result.context.variables.has("route"), false);
});

for (const fixture of [
  { properties: { decisionType: "score", criteria: ["Low", "High"] }, result: 0.8, branch: true, saved: 0.8, route: "yes" },
  { properties: { decisionType: "noul" }, result: 0.2, branch: false, saved: 0.2, route: "no" },
  { properties: { decisionType: "choice", criteria: { urgent: "Now", normal: "Later" }, branches: { urgent: "end", normal: "no" } }, result: "urgent", branch: "urgent", saved: "urgent", route: undefined },
  { properties: { decisionType: "batch", questions, next: "yes" }, result: { urgency: 1.8, refund: false, chance: 0.7, category: "urgent" }, branch: undefined, saved: '{"urgency":1.8,"refund":false,"chance":0.7,"category":"urgent"}', route: "yes" },
]) {
  test(`local execution continues correctly after a delegated ${fixture.properties.decisionType} decision`, async t => {
    t.mock.method(globalThis, "fetch", async (_url, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return Response.json({
        variables: { ...body.variables, answer: fixture.saved },
        decision: { result: fixture.result, branch: fixture.branch, input: { decisionType: fixture.properties.decisionType } },
      });
    });
    const result = await executeWorkflowLocally(workflow(fixture.properties), callbacks, { workflowId: "test" });
    assert.equal(result.historyRecord.status, "completed");
    assert.equal(result.context.variables.get("answer"), fixture.saved);
    assert.equal(result.context.variables.get("route"), fixture.route);
    assert.deepEqual(result.historyRecord.steps[0].output, fixture.result);
  });
}

test("choice routes, including end, survive serialization and graph target deletion", () => {
  const parsed = workflow({ decisionType: "choice", criteria: { urgent: "Now", normal: "Later" }, branches: { urgent: "yes", normal: "end" } });
  assert.deepEqual(getNextNodes(parsed, "judge", "urgent"), ["yes"]);
  assert.deepEqual(getNextNodes(parsed, "judge", "normal"), []);
  const chart = workflowToMermaid(parsed);
  assert.match(chart, /DECISION/);
  assert.match(chart, /judge -->\|"urgent"\| yes/);
  assert.match(chart, /judge -->\|"normal"\| FINISH/);
  parsed.nodes.delete("yes");
  parsed.edges = parsed.edges.filter(edge => edge.to !== "yes" && edge.from !== "yes");
  const restored = parseWorkflowYaml(serializeWorkflow(parsed));
  assert.deepEqual(JSON.parse(restored.nodes.get("judge")!.properties.branches), { urgent: "end", normal: "end" });
  assert.deepEqual(getNextNodes(restored, "judge", "urgent"), []);
});

test("decision parses implicit false continuation and rejects missing or broken branch targets", () => {
  const parsed = workflow({ falseNext: undefined });
  assert.deepEqual(getNextNodes(parsed, "judge", false), ["yes"]);
  assert.throws(() => workflow({ trueNext: undefined }), /missing trueNext/);
  assert.throws(() => workflow({ trueNext: "missing" }), /Invalid edge reference/);
  assert.throws(() => workflow({ decisionType: "choice", branches: { a: "missing" } }), /Invalid edge reference/);
});

test("AI workflow specification exposes the dedicated decision contract", () => {
  const spec = getWorkflowNodeSpec(["decision"]);
  for (const term of ["#### decision", "gemini-decision-1", "jev", "boolean", "score", "choice", "noul", "batch", "branches", "questions", "saveTo"]) assert.ok(spec.includes(term), term);
});
