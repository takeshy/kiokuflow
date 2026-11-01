import assert from "node:assert/strict";
import test from "node:test";
import { GeminiLiveSession } from "./gemini-live";
import type { LiveState, LiveTranscript } from "./live-session";

const options = { model: "gemini-3.8-live", voice: "Kore", language: "ja" as const, instructions: "Talk naturally" };
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture(t: import("node:test").TestContext, pendingMic?: Promise<unknown>) {
  let microphoneStops = 0, outputStops = 0, contextCloses = 0, micRequests = 0;
  const track = { enabled: true, stop() { microphoneStops++; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const output = { stream: { getTracks: () => [{ stop() { outputStops++; } }] }, disconnect() {} };
  const audio = { pause() {}, play: async () => {}, srcObject: null };
  const states: LiveState[] = [], errors: string[] = [];
  let transcript: LiveTranscript[] = [];
  const sources: { buffer?: { duration: number }; startTime?: number; stopped: boolean; connect(): void; disconnect(): void; start(time: number): void; stop(): void; onended: (() => void) | null }[] = [];
  const recorder = { port: { onmessage: null as ((event: { data: ArrayBuffer }) => void) | null, postMessage() {}, close() {} }, connect() {}, disconnect() {} };
  const context = {
    currentTime: 1, destination: {}, audioWorklet: { addModule: async (url: string) => { assert.equal(url, "/audio/gemini-live-recorder.js"); } },
    resume: async () => {}, close: async () => { contextCloses++; }, createMediaStreamDestination: () => output,
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createBuffer: (_channels: number, size: number, rate: number) => ({ duration: size / rate, getChannelData: () => new Float32Array(size) }),
    createBufferSource: () => { const source = { buffer: undefined as { duration: number } | undefined, stopped: false, startTime: undefined as number | undefined, onended: null as (() => void) | null, connect() {}, disconnect() {}, start(time: number) { this.startTime = time; }, stop() { this.stopped = true; } }; sources.push(source); return source; },
  };
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1; bufferedAmount = 0; closed = false; sent: string[] = [];
    onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null; onerror: (() => void) | null = null;
    constructor(public url: string) { sockets.push(this); }
    send(body: string) { this.sent.push(body); }
    close() { this.closed = true; }
  }
  for (const [name, value] of Object.entries({ window: { AudioContext: function () { return context; } }, navigator: { mediaDevices: { getUserMedia: async () => { micRequests++; return pendingMic || stream; } } }, AudioWorkletNode: function () { return recorder; }, WebSocket: FakeSocket })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.equal(url, "/api/gemini/live"); assert.deepEqual(JSON.parse(String(init?.body)), options);
    return Response.json({ token: "auth_tokens/synthetic-token" });
  });
  const session = new GeminiLiveSession({ audio: audio as unknown as HTMLAudioElement, onState: state => states.push(state), onError: error => errors.push(error), onTranscript: items => { transcript = items; } });
  t.after(() => session.stop());
  const event = async (body: unknown) => { sockets[0].onmessage?.({ data: JSON.stringify(body) }); await tick(); };
  const connect = async () => {
    const starting = session.start(options);
    for (let i = 0; i < 20 && !sockets.length; i++) await tick();
    assert.equal(sockets.length, 1); sockets[0].onopen?.();
    assert.equal(states.at(-1), "connecting");
    await event({ setupComplete: {} }); await starting;
  };
  return { session, states, errors, sockets, sources, recorder, track, context, stream, event, connect,
    get transcript() { return transcript; }, get microphoneStops() { return microphoneStops; }, get outputStops() { return outputStops; }, get contextCloses() { return contextCloses; }, get micRequests() { return micRequests; } };
}

test("Gemini Live waits for setup, streams PCM with an ephemeral token, mutes and releases all resources", async t => {
  const f = fixture(t); await f.connect();
  assert.equal(f.states.at(-1), "connected");
  const socket = f.sockets[0]; assert.match(socket.url, /v1beta.*BidiGenerateContentConstrained\?access_token=auth_tokens%2Fsynthetic-token$/);
  const setup = JSON.parse(socket.sent[0]).setup;
  assert.equal(setup.model, "models/gemini-3.8-live"); assert.deepEqual(setup.generationConfig.responseModalities, ["AUDIO"]);
  assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Kore");
  assert.ok(setup.inputAudioTranscription && setup.outputAudioTranscription);
  const pcm = new Uint8Array([1, 2, 3, 4]).buffer;
  f.recorder.port.onmessage?.({ data: pcm });
  assert.deepEqual(JSON.parse(socket.sent.at(-1)!).realtimeInput.audio, { data: "AQIDBA==", mimeType: "audio/pcm;rate=16000" });
  f.session.mute(true); assert.equal(f.track.enabled, false);
  assert.equal(JSON.parse(socket.sent.at(-1)!).realtimeInput.audioStreamEnd, true);
  const count = socket.sent.length; f.recorder.port.onmessage?.({ data: pcm }); assert.equal(socket.sent.length, count);
  f.session.mute(false); f.recorder.port.onmessage?.({ data: pcm }); assert.equal(socket.sent.length, count + 1);
  f.session.stop(); assert.equal(f.microphoneStops, 1); assert.equal(f.outputStops, 1); assert.equal(f.contextCloses, 1); assert.equal(socket.closed, true);
});

test("Gemini processes all audio parts, preserves delayed user transcripts, and discards queued audio on interruption", async t => {
  const f = fixture(t); await f.connect();
  await f.event({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAAAA==", mimeType: "audio/pcm;rate=24000" } }, { inlineData: { data: "AAAAAA==", mimeType: "audio/pcm;rate=24000" } }] }, outputTranscription: { text: "こんにちは" }, turnComplete: true } });
  assert.equal(f.sources.length, 2); assert.ok(f.sources[1].startTime! > f.sources[0].startTime!);
  await f.event({ serverContent: { inputTranscription: { text: "やあ", finished: true } } });
  assert.deepEqual(f.transcript.map(({ role, text }) => ({ role, text })), [{ role: "user", text: "やあ" }, { role: "assistant", text: "こんにちは" }]);
  await f.event({ serverContent: { interrupted: true, inputTranscription: { text: "続けて", finished: true }, outputTranscription: { text: "はい" } } });
  assert.ok(f.sources.every(source => source.stopped)); assert.equal(f.transcript.length, 4);
});

test("cancelling pending Gemini microphone permission releases late tracks without creating a socket", async t => {
  const mic = deferred<unknown>(), f = fixture(t, mic.promise);
  const starting = f.session.start(options); for (let i = 0; i < 20 && !f.micRequests; i++) await tick();
  f.session.stop(); mic.resolve(f.stream); await starting;
  assert.equal(f.microphoneStops, 1); assert.equal(f.sockets.length, 0); assert.equal(f.states.at(-1), "idle");
});

test("a delayed final input transcript stays with its earlier partial text after the model turn ends", async t => {
  const f = fixture(t); await f.connect();
  await f.event({ serverContent: { inputTranscription: { text: "こん" } } });
  await f.event({ serverContent: { outputTranscription: { text: "やあ" }, turnComplete: true } });
  await f.event({ serverContent: { inputTranscription: { text: "にちは", finished: true } } });
  assert.deepEqual(f.transcript.map(({ role, text }) => ({ role, text })), [{ role: "user", text: "こんにちは" }, { role: "assistant", text: "やあ" }]);
});

test("cancelling Gemini setup closes the negotiating socket and ignores late messages", async t => {
  const f = fixture(t), starting = f.session.start(options);
  for (let i = 0; i < 20 && !f.sockets.length; i++) await tick();
  const late = f.sockets[0].onmessage;
  f.session.stop(); await starting;
  await late?.({ data: JSON.stringify({ setupComplete: {} }) }); await tick();
  assert.equal(f.sockets[0].closed, true); assert.ok(!f.states.includes("connected")); assert.equal(f.microphoneStops, 1);
});

test("locked Gemini keys clean up playback before recording", async t => {
  const f = fixture(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Unlock Gemini" }, { status: 401 }));
  await f.session.start(options); assert.equal(f.errors.at(-1), "Unlock Gemini"); assert.equal(f.micRequests, 0); assert.equal(f.contextCloses, 1);
});

test("excessive Gemini send buffering stops the microphone", async t => {
  const f = fixture(t); await f.connect();
  f.sockets[0].bufferedAmount = 1_000_001;
  f.recorder.port.onmessage?.({ data: new ArrayBuffer(1280) });
  assert.match(f.errors.at(-1)!, /too slow/); assert.equal(f.microphoneStops, 1);

});

test("Gemini transport errors stop the microphone and close the connection", async t => {
  const f = fixture(t); await f.connect(); f.sockets[0].onerror?.();
  assert.match(f.errors.at(-1)!, /connection failed/); assert.equal(f.microphoneStops, 1); assert.equal(f.sockets[0].closed, true);
});

test("Gemini worklet load failure releases the microphone and creates no socket", async t => {
  const f = fixture(t); t.mock.method(f.context.audioWorklet, "addModule", async () => { throw new Error("Could not load recorder"); });
  await f.session.start(options); assert.equal(f.errors.at(-1), "Could not load recorder"); assert.equal(f.microphoneStops, 1); assert.equal(f.sockets.length, 0);
});
