export const LIVE_MODELS = ["gpt-realtime-2.1", "gpt-realtime-2.1-mini", "gpt-realtime", "gpt-realtime-mini"] as const;
export const LIVE_VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"] as const;
import type { LiveCallbacks, LiveOptions, LiveTranscript } from "./live-session";
export type { LiveState, LiveTranscript } from "./live-session";

/** Owns every resource in one call, including cancellation during mic permission/SDP negotiation. */
export class OpenAILiveSession {
  private peer: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private channel: RTCDataChannel | null = null;
  private abort: AbortController | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private active = false;
  private transcripts = new Map<string, LiveTranscript>();
  constructor(private callbacks: LiveCallbacks) {}

  stop() {
    this.generation++;
    this.active = false;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    this.abort?.abort(); this.abort = null;
    if (this.channel) { this.channel.onclose = null; this.channel.onerror = null; this.channel.close(); this.channel = null; }
    if (this.peer) { this.peer.onconnectionstatechange = null; this.peer.ontrack = null; this.peer.close(); this.peer = null; }
    this.stream?.getTracks().forEach((track) => track.stop()); this.stream = null;
    this.callbacks.audio.pause();
    this.callbacks.audio.srcObject = null;
    this.callbacks.onState("idle");
  }

  mute(muted: boolean) { this.stream?.getAudioTracks().forEach((track) => { track.enabled = !muted; }); }

  private fail(message: string) { this.stop(); this.callbacks.onError(message); }

  private receive(raw: string) {
    const event = JSON.parse(raw) as {
      type: string; item_id?: string; delta?: string; transcript?: string;
      error?: { message?: string }; response?: { status?: string; status_details?: { error?: { message?: string } } };
    };
    if (event.type === "input_audio_buffer.speech_started" && event.item_id) {
      const id = `user:${event.item_id}`;
      this.transcripts.set(id, { id, role: "user", text: "" });
    }
    if (event.type === "error" || event.type === "conversation.item.input_audio_transcription.failed") {
      this.fail(event.error?.message || "Live conversation failed"); return;
    }
    if (event.type === "response.done" && event.response?.status === "failed") {
      this.fail(event.response.status_details?.error?.message || "Live response failed"); return;
    }
    const user = event.type === "conversation.item.input_audio_transcription.delta" || event.type === "conversation.item.input_audio_transcription.completed";
    const assistant = event.type === "response.output_audio_transcript.delta" || event.type === "response.output_audio_transcript.done";
    if ((!user && !assistant) || !event.item_id) return;
    const id = `${user ? "user" : "assistant"}:${event.item_id}`;
    const previous = this.transcripts.get(id);
    this.transcripts.set(id, {
      id, role: user ? "user" : "assistant",
      text: event.transcript ?? ((previous?.text || "") + (event.delta || "")),
    });
    this.callbacks.onTranscript([...this.transcripts.values()]);
  }

  async start(options: LiveOptions) {
    this.stop();
    const generation = this.generation;
    this.active = true;
    this.transcripts.clear(); this.callbacks.onTranscript([]);
    this.callbacks.onState("connecting");
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const isCurrent = () => this.active && this.generation === generation;
    this.timeout = setTimeout(() => { if (isCurrent()) this.fail("Live connection timed out. Please try again."); }, 30_000);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
        throw new Error("Live requires a browser with microphone access over HTTPS or localhost.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!isCurrent()) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      const peer = new RTCPeerConnection(); this.peer = peer;
      peer.ontrack = (event) => {
        if (!isCurrent()) return;
        this.callbacks.audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        void this.callbacks.audio.play().catch(() => {
          if (isCurrent()) this.callbacks.onError("Audio playback is blocked. Press play in the audio controls.");
        });
      };
      peer.onconnectionstatechange = () => {
        if (!isCurrent()) return;
        if (["failed", "closed", "disconnected"].includes(peer.connectionState)) this.fail("Live connection ended. Start a new conversation to reconnect.");
      };
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      const channel = peer.createDataChannel("oai-events"); this.channel = channel;
      channel.onopen = () => {
        if (!isCurrent()) return;
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = null;
        this.callbacks.onState("connected");
      };
      channel.onmessage = (event) => {
        if (!isCurrent()) return;
        try { this.receive(String(event.data)); } catch { this.fail("Invalid Live event received"); }
      };
      channel.onclose = () => { if (isCurrent()) this.fail("Live conversation ended."); };
      channel.onerror = () => { if (isCurrent()) this.fail("Live connection error"); };
      const offer = await peer.createOffer();
      if (!isCurrent()) return;
      await peer.setLocalDescription(offer);
      if (!isCurrent()) return;
      const response = await fetch("/api/openai/live", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...options, sdp: offer.sdp }), signal,
      });
      if (!isCurrent()) return;
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || `Live HTTP ${response.status}`);
      }
      const answer = await response.text();
      if (!isCurrent()) return;
      await peer.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (error) {
      if (isCurrent()) this.fail(error instanceof Error ? error.message : String(error));
    }
  }
}
