import { geminiLiveSetup } from "./gemini-live-config";
import type { LiveCallbacks, LiveOptions, LiveSession, LiveTranscript } from "./live-session";
import { LiveToolDispatcher } from "./live-tool-definitions";

interface GeminiLiveMessage {
  setupComplete?: unknown;
  error?: { message?: string };
  toolCall?: { functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[] };
  toolCallCancellation?: { ids?: string[] };
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string; finished?: boolean };
    outputTranscription?: { text?: string; finished?: boolean };
    modelTurn?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
  };
}

/** Owns the WebSocket, AudioWorklet, playback queue and every microphone track. */
export class GeminiLiveSession implements LiveSession {
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  private output: MediaStreamAudioDestinationNode | null = null;
  private microphone: MediaStream | null = null;
  private input: MediaStreamAudioSourceNode | null = null;
  private recorder: AudioWorkletNode | null = null;
  private playback = new Set<AudioBufferSourceNode>();
  private playAt = 0;
  private abort: AbortController | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private finishConnect: (() => void) | null = null;
  private generation = 0;
  private active = false;
  private ready = false;
  private muted = false;
  private transcripts = new Map<string, LiveTranscript>();
  private inputTurn = 0;
  private outputTurn = 0;
  private tools: LiveToolDispatcher | null = null;
  private handledTools = new Set<string>();

  constructor(private callbacks: LiveCallbacks) {}

  private clearPlayback() {
    for (const source of this.playback) { source.onended = null; source.stop(); source.disconnect(); }
    this.playback.clear();
    this.playAt = 0;
  }

  stop() {
    this.generation++;
    this.active = false; this.ready = false;
    this.tools?.cancel(); this.tools = null;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    this.abort?.abort(); this.abort = null;
    this.finishConnect?.(); this.finishConnect = null;
    if (this.socket) {
      this.socket.onopen = null; this.socket.onmessage = null; this.socket.onerror = null; this.socket.onclose = null;
      this.socket.close(); this.socket = null;
    }
    if (this.recorder) { this.recorder.port.onmessage = null; this.recorder.port.close(); this.recorder.disconnect(); this.recorder = null; }
    this.input?.disconnect(); this.input = null;
    this.microphone?.getTracks().forEach(track => track.stop()); this.microphone = null;
    this.clearPlayback();
    this.output?.stream.getTracks().forEach(track => track.stop()); this.output?.disconnect(); this.output = null;
    if (this.context) { void this.context.close().catch(() => {}); this.context = null; }
    this.callbacks.audio.pause(); this.callbacks.audio.srcObject = null;
    this.callbacks.onState("idle");
  }

  private fail(message: string) { this.stop(); this.callbacks.onError(message); }

  mute(muted: boolean) {
    this.muted = muted;
    this.microphone?.getAudioTracks().forEach(track => { track.enabled = !muted; });
    this.recorder?.port.postMessage("reset");
    if (muted && this.ready && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    }
  }

  private transcribe(role: "user" | "assistant", turn: number, text?: string) {
    if (!text) return;
    const id = `${turn}:${role}`;
    this.transcripts.set(id, { id, role, text: (this.transcripts.get(id)?.text || "") + text });
    const sorted = [...this.transcripts.values()].sort((a, b) => Number(a.id.split(":")[0]) - Number(b.id.split(":")[0]) || (a.role === b.role ? 0 : a.role === "user" ? -1 : 1));
    this.callbacks.onTranscript(sorted);
  }

  private receive(message: GeminiLiveMessage) {
    if (message.error) { this.fail(message.error.message || "Gemini Live failed"); return; }
    if (message.toolCallCancellation?.ids) this.tools?.cancel(message.toolCallCancellation.ids);
    if (message.toolCall?.functionCalls) {
      const tools = this.tools, socket = this.socket, generation = this.generation;
      const calls = message.toolCall.functionCalls.map((call, index) => ({ ...call, key: call.id || `live-tool-${this.handledTools.size + index}` })).filter(call => !this.handledTools.has(call.key));
      if (tools && socket && calls.length) {
        calls.forEach(call => this.handledTools.add(call.key));
        void Promise.all(calls.map(async call => ({ call, result: await tools.run({ id: call.key, name: call.name || "", args: call.args || {} }) }))).then(results => {
          if (!this.active || generation !== this.generation) return;
          const functionResponses = results.filter(({ call }) => !tools.isCancelled(call.key)).map(({ call, result }) => ({ id: call.id, name: call.name, response: result && typeof result === "object" ? result : { result } }));
          if (functionResponses.length) socket.send(JSON.stringify({ toolResponse: { functionResponses } }));
        }).catch(() => { if (this.active && generation === this.generation) this.fail("Could not return file results to Gemini Live."); });
      }
    }
    if (message.setupComplete) {
      this.ready = true;
      this.recorder?.port.postMessage("reset");
      if (this.timeout) clearTimeout(this.timeout);
      this.timeout = null;
      this.finishConnect?.(); this.finishConnect = null;
      this.callbacks.onState("connected");
    }
    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) this.clearPlayback();
    this.transcribe("user", this.inputTurn, content.inputTranscription?.text);
    if (content.inputTranscription?.finished) this.inputTurn++;
    this.transcribe("assistant", this.outputTurn, content.outputTranscription?.text);
    for (const part of content.modelTurn?.parts || []) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/pcm")) this.playAudio(part.inlineData.data, part.inlineData.mimeType);
    }
    if (content.turnComplete) {
      // A user's final transcript can arrive after the model's turn completes.
      // Only inputTranscription.finished advances the independent input counter.
      this.outputTurn++;
    }
  }

  private playAudio(base64: string, mimeType: string) {
    const context = this.context;
    if (!context || !this.output) return;
    const binary = atob(base64);
    const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1] || 24000);
    if (!binary.length || binary.length % 2 || rate < 8000 || rate > 96000) throw new Error("Invalid Gemini Live audio");
    const buffer = context.createBuffer(1, binary.length / 2, rate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) {
      const value = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
      channel[i] = (value >= 32768 ? value - 65536 : value) / 32768;
    }
    const start = Math.max(context.currentTime, this.playAt);
    if (start - context.currentTime > 30) throw new Error("Gemini Live audio playback fell behind. Please reconnect.");
    const source = context.createBufferSource(); source.buffer = buffer;
    source.connect(this.output); this.playback.add(source);
    source.onended = () => { this.playback.delete(source); source.disconnect(); };
    source.start(start); this.playAt = start + buffer.duration;
  }

  async start(options: LiveOptions) {
    this.stop();
    const generation = this.generation;
    const current = () => this.active && this.generation === generation;
    this.active = true; this.muted = false;
    this.tools = new LiveToolDispatcher(options, this.callbacks.onToolCall); this.handledTools.clear();
    this.transcripts.clear(); this.inputTurn = 0; this.outputTurn = 0;
    this.callbacks.onTranscript([]); this.callbacks.onState("connecting");
    this.abort = new AbortController();
    this.timeout = setTimeout(() => { if (current()) this.fail("Gemini Live connection timed out. Please try again."); }, 30_000);
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass || !navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") throw new Error("Gemini Live requires microphone access and Web Audio over HTTPS or localhost.");
      // Resume playback while still handling the Start button's user gesture,
      // before requesting credentials or waiting for microphone permission.
      const context = new AudioContextClass(); this.context = context;
      this.output = context.createMediaStreamDestination();
      this.callbacks.audio.srcObject = this.output.stream;
      void this.callbacks.audio.play().catch(() => { if (current()) this.callbacks.onError("Tap the conversation screen to enable audio."); });
      await context.resume();
      if (!current()) return;
      const response = await fetch("/api/gemini/live", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options), signal: this.abort!.signal,
      });
      const body = await response.json() as { token?: string; error?: string };
      if (!current()) return;
      if (!response.ok) throw new Error(body.error || `Gemini Live HTTP ${response.status}`);
      if (!body.token?.startsWith("auth_tokens/")) throw new Error("Invalid Gemini Live token");
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
      if (!current()) { microphone.getTracks().forEach(track => track.stop()); return; }
      this.microphone = microphone;
      await context.audioWorklet.addModule("/audio/gemini-live-recorder.js");
      if (!current()) return;
      this.input = context.createMediaStreamSource(microphone);
      this.recorder = new AudioWorkletNode(context, "gemini-live-recorder", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.input.connect(this.recorder); this.recorder.connect(context.destination);
      this.recorder.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (!current() || !this.ready || this.muted || this.socket?.readyState !== WebSocket.OPEN) return;
        if (this.socket.bufferedAmount > 1_000_000) { this.fail("Gemini Live connection is too slow. Please reconnect."); return; }
        const data = new Uint8Array(event.data);
        let binary = "";
        for (const byte of data) binary += String.fromCharCode(byte);
        this.socket.send(JSON.stringify({ realtimeInput: { audio: { data: btoa(binary), mimeType: "audio/pcm;rate=16000" } } }));
      };
      await new Promise<void>((resolve) => {
        this.finishConnect = resolve;
        const socket = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(body.token!)}`);
        this.socket = socket;
        socket.onopen = () => { if (current()) socket.send(JSON.stringify({ setup: geminiLiveSetup(options) })); };
        let messages = Promise.resolve();
        socket.onmessage = (event) => {
          messages = messages.then(async () => {
            const raw = typeof event.data === "string" ? event.data : await (event.data as Blob).text();
            if (current()) this.receive(JSON.parse(raw) as GeminiLiveMessage);
          }).catch(() => { if (current()) this.fail("Invalid Gemini Live response"); });
        };
        socket.onerror = () => { if (current()) this.fail("Gemini Live connection failed. Check your model access and network, then retry."); };
        socket.onclose = () => { if (current()) this.fail("Gemini Live conversation ended. Start a new conversation to reconnect."); };
      });
    } catch (error) {
      if (current()) this.fail(error instanceof Error ? error.message : "Gemini Live connection failed");
    }
  }
}
