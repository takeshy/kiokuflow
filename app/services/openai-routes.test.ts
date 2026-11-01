import assert from "node:assert/strict";
import test from "node:test";
import { getTokens, setTokens, commitSession, type SessionTokens } from "./session.server";
import { action as responses } from "~/routes/api.openai.responses";
import { action as live } from "~/routes/api.openai.live";

const baseTokens: SessionTokens = {
  accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiryTime: Date.now() + 3600_000,
  rootFolderId: "root-a", openaiApiKey: "synthetic-openai-key",
};
async function request(path: string, body: unknown, overrides: Partial<SessionTokens> = {}, origin = "http://localhost") {
  const original = new Request("http://localhost/");
  const session = await setTokens(original, { ...baseTokens, ...overrides });
  return new Request(`http://localhost${path}`, {
    method: "POST", headers: { Origin: origin, Cookie: (await commitSession(session)).split(";")[0], "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
const responseBody = { model: "gpt-6.1-sol", input: [{ role: "user", content: "Hello" }] };
const liveBody = { sdp: "v=0\r\n", model: "gpt-realtime-2.1", voice: "marin", language: "ja", instructions: "Talk naturally" };
function args(req: Request) { return { request: req, params: {}, context: {} } as never; }

test("Responses proxy fixes the destination and persistence settings and keeps API keys out of responses", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer synthetic-openai-key");
    const body = JSON.parse(String(init.body));
    assert.equal(body.store, false); assert.equal(body.stream, true);
    assert.equal(body.apiKey, undefined); assert.equal(body.baseUrl, undefined);
    assert.equal(body.safety_identifier.length, 64);
    return new Response("data: synthetic-event\n\n");
  });
  const result = await responses(args(await request("/api/openai/responses", { ...responseBody, store: true, apiKey: "attacker-key", baseUrl: "http://attacker.invalid" })));
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.equal(await result.text(), "data: synthetic-event\n\n");
});

test("Live exchanges SDP with a speech-to-speech session, server VAD, chosen voice and input transcript", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    assert.equal(url, "https://api.openai.com/v1/realtime/calls");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer synthetic-openai-key");
    const form = init.body as FormData;
    assert.equal(form.get("sdp"), "v=0\r\n");
    const session = JSON.parse(String(form.get("session")));
    assert.equal(session.type, "realtime"); assert.equal(session.model, "gpt-realtime-2.1");
    assert.equal(session.audio.output.voice, "marin");
    assert.equal(session.audio.input.transcription.language, "ja");
    assert.equal(session.audio.input.turn_detection.create_response, true);
    assert.equal(session.audio.input.turn_detection.interrupt_response, true);
    return new Response("sdp-answer");
  });
  const result = await live(args(await request("/api/openai/live", liveBody)));
  assert.equal(result.headers.get("Content-Type"), "application/sdp");
  assert.equal(await result.text(), "sdp-answer");
});

test("OpenAI endpoints reject locked keys, cross-origin requests and organization mounts before upstream calls", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Unauthorized request reached OpenAI"));
  for (const [route, body] of [[responses, responseBody], [live, liveBody]] as const) {
    for (const [overrides, origin, expected] of [
      [{ openaiApiKey: "" }, "http://localhost", 401],
      [{ currentProjectId: "project-b" }, "http://localhost", 403],
      [{}, "http://attacker.invalid", 403],
    ] as const) {
      await assert.rejects(route(args(await request("/api/openai", body, overrides, origin))), (error: unknown) => error instanceof Response && error.status === expected);
    }
  }
});

test("proxy rejects remote MCP tools and Live rejects unsupported session configuration", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Invalid request reached OpenAI"));
  const result = await responses(args(await request("/api/openai/responses", { ...responseBody, tools: [{ type: "mcp", server_url: "https://attacker.invalid" }] })));
  assert.equal(result.status, 400);
  for (const part of [{ type: "input_image", image_url: "https://attacker.invalid/a.png" }, { type: "input_file", file_url: "https://attacker.invalid/a.pdf" }, { type: "input_file", file_id: "file-1" }]) {
    const remote = await responses(args(await request("/api/openai/responses", { ...responseBody, input: [{ role: "user", content: [part] }] })));
    assert.equal(remote.status, 400);
  }
  const invalid = await live(args(await request("/api/openai/live", { ...liveBody, voice: "unknown" })));
  assert.equal(invalid.status, 400);
});

test("OpenAI credentials are encrypted in cookies and bound to their Drive root across account changes", async () => {
  const session = await setTokens(new Request("http://localhost/"), baseTokens);
  assert.notEqual(session.get("openaiApiKey"), baseTokens.openaiApiKey);
  const cookie = (await commitSession(session)).split(";")[0];
  const first = new Request("http://localhost/", { headers: { Cookie: cookie } });
  assert.equal((await getTokens(first))?.openaiApiKey, baseTokens.openaiApiKey);
  const { openaiApiKey: _key, ...otherTokens } = baseTokens;
  const changed = await setTokens(first, { ...otherTokens, rootFolderId: "root-b" });
  const second = new Request("http://localhost/", { headers: { Cookie: (await commitSession(changed)).split(";")[0] } });
  assert.equal((await getTokens(second))?.openaiApiKey, undefined);
});

test("OpenAI Live sessions advertise only fixed read-only file and selected-RAG functions", async t => {
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    const session = JSON.parse(String((init.body as FormData).get("session")));
    assert.deepEqual(session.tools.map((tool: { name: string }) => tool.name), ["read_current_file", "read_drive_file", "search_drive_files", "list_drive_files", "search_rag"]);
    assert.ok(session.tools.every((tool: { type: string }) => tool.type === "function"));
    assert.ok(!JSON.stringify(session.tools).includes("create_drive_file")); return new Response("sdp-answer");
  });
  assert.equal((await live(args(await request("/api/openai/live", { ...liveBody, fileAccess: true, ragEnabled: true, tools: [{ name: "create_drive_file" }] })))).status, 200);
});
