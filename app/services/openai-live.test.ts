import assert from "node:assert/strict";
import test from "node:test";
import { OpenAILiveSession, type LiveState, type LiveTranscript } from "./openai-live";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function fixture(t: import("node:test").TestContext, mic?: Promise<unknown>) {
  let stopped = 0;
  const track = { enabled: true, stop() { stopped++; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const audio = { pause() {}, play: async () => {}, srcObject: null };
  const states: LiveState[] = [];
  const errors: string[] = [];
  let transcript: LiveTranscript[] = [];
  const channel = { onopen: null as (() => void) | null, onmessage: null as ((event: { data: string }) => void) | null, onclose: null as (() => void) | null, onerror: null, close() {} };
  let peerClosed = false;
  const peer = {
    connectionState: "new", onconnectionstatechange: null as (() => void) | null, ontrack: null,
    addTrack() {}, createDataChannel: () => channel,
    createOffer: async () => ({ sdp: "offer", type: "offer" }), setLocalDescription: async () => {},
    setRemoteDescription: async () => { channel.onopen?.(); }, close() { peerClosed = true; },
  };
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => mic ? mic : stream } } });
  t.after(() => { if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor); });
  const globals = globalThis as unknown as Record<string, unknown>;
  const previousPeer = globals.RTCPeerConnection;
  globals.RTCPeerConnection = function () { return peer; };
  t.after(() => { globals.RTCPeerConnection = previousPeer; });
  t.mock.method(globalThis, "fetch", async () => new Response("answer"));
  const session = new OpenAILiveSession({ audio: audio as unknown as HTMLAudioElement, onState: (state) => states.push(state), onError: (error) => errors.push(error), onTranscript: (items) => { transcript = items; } });
  t.after(() => session.stop());
  return { session, track, stream, states, errors, channel, peer, get stopped() { return stopped; }, get peerClosed() { return peerClosed; }, get transcript() { return transcript; } };
}
const options = { model: "gpt-realtime-2.1", voice: "marin", language: "ja" as const, instructions: "Converse" };

test("Live establishes a voice connection, supports mute, and releases all resources on stop", async (t) => {
  const f = fixture(t);
  await f.session.start(options);
  assert.equal(f.states.at(-1), "connected");
  f.session.mute(true); assert.equal(f.track.enabled, false);
  f.session.mute(false); assert.equal(f.track.enabled, true);
  f.session.stop();
  assert.equal(f.stopped, 1); assert.equal(f.peerClosed, true);
  assert.equal(f.states.at(-1), "idle");
});

test("cancelling while microphone permission is pending stops late tracks without opening a connection", async (t) => {
  const mic = deferred<unknown>();
  const f = fixture(t, mic.promise);
  const starting = f.session.start(options);
  f.session.stop();
  mic.resolve(f.stream);
  await starting;
  assert.equal(f.stopped, 1); assert.equal(f.peerClosed, false);
  assert.equal(f.states.at(-1), "idle");
});

test("failed SDP handshake releases microphone and reports provider error", async (t) => {
  const f = fixture(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Key locked" }, { status: 401 }));
  await f.session.start(options);
  assert.equal(f.stopped, 1); assert.equal(f.peerClosed, true);
  assert.equal(f.errors[0], "Key locked");
});

test("Live preserves turn ordering when user transcription arrives after the assistant response", async (t) => {
  const f = fixture(t);
  await f.session.start(options);
  for (const event of [
    { type: "input_audio_buffer.speech_started", item_id: "u1" },
    { type: "response.output_audio_transcript.delta", item_id: "a1", delta: "こんにちは" },
    { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "やあ" },
    { type: "response.output_audio_transcript.done", item_id: "a1", transcript: "こんにちは！" },
  ]) f.channel.onmessage?.({ data: JSON.stringify(event) });
  assert.deepEqual(f.transcript.map(({ role, text }) => ({ role, text })), [{ role: "user", text: "やあ" }, { role: "assistant", text: "こんにちは！" }]);
});

test("fatal realtime events release the microphone", async (t) => {
  const f = fixture(t);
  await f.session.start(options);
  f.channel.onmessage?.({ data: JSON.stringify({ type: "error", error: { message: "Quota exceeded" } }) });
  assert.equal(f.stopped, 1); assert.equal(f.errors[0], "Quota exceeded");
  assert.equal(f.states.at(-1), "idle");
});

test("disconnecting a peer releases the microphone without silently reconnecting", async (t) => {
  const f = fixture(t);
  await f.session.start(options);
  f.peer.connectionState = "disconnected";
  f.peer.onconnectionstatechange?.();
  assert.equal(f.stopped, 1); assert.equal(f.peerClosed, true);
  assert.match(f.errors[0], /connection ended/);
});

test("cancelling an in-flight SDP exchange ignores a late answer", async (t) => {
  const f = fixture(t);
  const answer = deferred<Response>();
  const requested = deferred<void>();
  t.mock.method(globalThis, "fetch", async () => { requested.resolve(); return answer.promise; });
  const starting = f.session.start(options);
  await requested.promise;
  f.session.stop();
  answer.resolve(new Response("late-answer"));
  await starting;
  assert.equal(f.stopped, 1); assert.equal(f.peerClosed, true);
  assert.ok(!f.states.includes("connected"));
});
