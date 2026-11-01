import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { DEFAULT_USER_SETTINGS } from "~/types/settings";
import { getLiveProvider } from "./live-session";
const worklet = readFileSync(new URL("../../public/audio/gemini-live-recorder.js", import.meta.url), "utf8");

test("microphone worklet resamples 48 kHz and 44.1 kHz across render quanta into 16 kHz PCM16 frames", () => {
  for (const rate of [48000, 44100, 16000]) {
    const frames: ArrayBuffer[] = [];
    let Recorder: new () => { process(inputs: Float32Array[][]): boolean; port: { onmessage(): void } };
    runInNewContext(worklet, { sampleRate: rate, AudioWorkletProcessor: class { port = { onmessage: null, postMessage: (frame: ArrayBuffer) => frames.push(frame) }; }, registerProcessor: (name: string, value: typeof Recorder) => { assert.equal(name, "gemini-live-recorder"); Recorder = value; } });
    const recorder = new Recorder!();
    for (let offset = 0; offset < rate; offset += 128) recorder.process([[new Float32Array(Math.min(128, rate - offset)).fill(0.5)]]);
    assert.equal(frames.length, 25); assert.ok(frames.every(frame => frame.byteLength === 1280));
    for (const frame of frames) assert.equal(new DataView(frame).getInt16(0, true), 16384);
    recorder.process([[new Float32Array(64).fill(1)]]); recorder.port.onmessage();
    const before = frames.length;
    for (let offset = 0; offset < rate * 0.04; offset += 1) recorder.process([[new Float32Array(1).fill(-1)]]);
    assert.equal(frames.length, before + 1); assert.equal(new DataView(frames.at(-1)!).getInt16(0, true), -32768);
  }
});

test("Live follows the active settings provider and has no Vertex or compatible-provider fallback", () => {
  assert.equal(getLiveProvider(DEFAULT_USER_SETTINGS), "gemini");
  assert.equal(getLiveProvider({ ...DEFAULT_USER_SETTINGS, selectedModel: "gpt-6.1-sol" }), "openai");
  assert.equal(getLiveProvider({ ...DEFAULT_USER_SETTINGS, selectedModel: "openrouter:vendor/model" }), null);
  assert.equal(getLiveProvider({ ...DEFAULT_USER_SETTINGS, selectedModel: "opencodego:glm-5.3" }), null);
  assert.equal(getLiveProvider({ ...DEFAULT_USER_SETTINGS, usePersonalVertex: true }), null);
  assert.equal(getLiveProvider(DEFAULT_USER_SETTINGS, { orgId: "org", projectId: "project" }), null);
});
