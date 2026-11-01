import assert from "node:assert/strict";
import test from "node:test";
import { action } from "~/routes/api.gemini.live";
import { setTokens, commitSession, type SessionTokens } from "./session.server";
const base: SessionTokens = { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiryTime: Date.now() + 3600_000, rootFolderId: "gemini-live-root", geminiApiKey: "synthetic-gemini-secret" };
const body = { model: "gemini-3.8-live", voice: "Kore", language: "ja", instructions: "自然な日本語で会話してください。" };
async function request(value: unknown = body, patch: Partial<SessionTokens> = {}, origin = "http://localhost") {
  const session = await setTokens(new Request("http://localhost"), { ...base, ...patch });
  return new Request("http://localhost/api/gemini/live", { method: "POST", headers: { Origin: origin, Cookie: (await commitSession(session)).split(";")[0], "Content-Type": "application/json" }, body: JSON.stringify(value) });
}
function args(request: Request) { return { request, params: {}, context: {} } as never; }

test("Gemini Live mints a constrained single-use token without exposing the permanent key", async t => {
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    assert.equal(input, "https://generativelanguage.googleapis.com/v1beta/auth_tokens");
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), base.geminiApiKey);
    const data = JSON.parse(String(init?.body)); assert.equal(data.uses, 1);
    assert.ok(Date.parse(data.expireTime) - Date.now() < 30 * 60_000 + 1000);
    assert.ok(Date.parse(data.newSessionExpireTime) - Date.now() < 61_000);
    const setup = data.bidiGenerateContentSetup;
    assert.equal(setup.model, "models/gemini-3.8-live"); assert.deepEqual(setup.generationConfig.responseModalities, ["AUDIO"]);
    assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Kore");
    assert.equal(setup.systemInstruction.parts[0].text, body.instructions); assert.ok(setup.inputAudioTranscription && setup.outputAudioTranscription);
    assert.equal(setup.tools, undefined); assert.equal(data.fieldMask, undefined);
    return Response.json({ name: "auth_tokens/temporary-token" });
  });
  const response = await action(args(await request({ ...body, apiKey: "untrusted", baseUrl: "https://attacker.invalid" })));
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { token: "auth_tokens/temporary-token" });
});

test("Gemini Live rejects locked sessions, organization mounts and invalid model or voice before contacting Google", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Invalid request reached Google"));
  for (const [patch, status] of [[{ geminiApiKey: "" }, 401], [{ currentProjectId: "project" }, 403], [{ rootFolderId: undefined }, 403]] as const) {
    const response = await action(args(await request(body, patch))); assert.equal(response.status, status);
  }
  for (const patch of [{ model: "gemini-3.8-pro" }, { voice: "marin" }, { language: "unknown" }, { instructions: "x".repeat(100_001) }]) assert.equal((await action(args(await request({ ...body, ...patch })))).status, 400);
  await assert.rejects(action(args(await request(body, {}, "https://attacker.invalid"))), error => error instanceof Response && error.status === 403);
});

test("Gemini Live handles provider errors and invalid token payloads without leaking keys", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: `Bad key ${base.geminiApiKey}` } }, { status: 403 }));
  const failed = await action(args(await request())); assert.equal(failed.status, 403); assert.ok(!(await failed.text()).includes(base.geminiApiKey!));
  t.mock.method(globalThis, "fetch", async () => Response.json({ name: "not-an-ephemeral-token" }));
  assert.equal((await action(args(await request()))).status, 502);
});

test("Gemini ephemeral tokens lock the same read-only file and RAG tools as the client setup", async t => {
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    const setup = JSON.parse(String(init?.body)).bidiGenerateContentSetup;
    assert.deepEqual(setup.tools[0].functionDeclarations.map((tool: { name: string }) => tool.name), ["read_current_file", "read_drive_file", "search_drive_files", "list_drive_files", "search_rag"]);
    assert.ok(!JSON.stringify(setup.tools).includes("update_drive_file"));
    return Response.json({ name: "auth_tokens/file-access" });
  });
  assert.equal((await action(args(await request({ ...body, fileAccess: true, ragEnabled: true, tools: [{ name: "create_drive_file" }] })))).status, 200);
});
