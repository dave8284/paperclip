import { api } from "@/api/client";
import { FridaySpeechBuffer, spokenReply } from "./friday-speech-buffer";
export { spokenReply, spokenReplyChunks } from "./friday-speech-buffer";

export interface VoiceRecognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null; onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  start(): void; stop(): void; abort(): void;
}
type VoiceWindow = { SpeechRecognition?: new () => VoiceRecognition; webkitSpeechRecognition?: new () => VoiceRecognition };
export interface SpokenReply { id: string; body: string; createdAt?: Date | string; runId?: string; /** Persisted user-facing comment. */ committed?: boolean; /** Only the native user-facing final answer channel, never reasoning or tools. */ streaming?: boolean }
export interface VoiceBinding { key: string; companyId?: string; disabled: boolean; busy?: boolean; send?: (text: string) => Promise<void>; draft: (text: string) => void; reply?: SpokenReply; liveReply?: SpokenReply; question?: { id: string; body: string }; onTurn?: () => void }
export interface VoiceTimingMeasurement { status: "unmeasured" | "pending" | "measured" | "unavailable" | "cancelled" | "failed"; durationMs: number | null }
export interface VoiceTimingContext { companyId?: string; sessionKey: string }
export interface VoiceTimings { companyId?: string; sessionKey?: string; active: boolean; transcription: VoiceTimingMeasurement; submission: VoiceTimingMeasurement; playback: VoiceTimingMeasurement }
export interface VoiceState { enabled: boolean; listening: boolean; hearingSpeech: boolean; speaking: boolean; playing: boolean; starting: boolean; sending: boolean; interim: string; error: string; local: boolean; checking: boolean; preparing: boolean; timings: VoiceTimings }
const emptyTimings = (companyId?: string, sessionKey?: string): VoiceTimings => ({ companyId, sessionKey, active: !!sessionKey, transcription: { status: "unmeasured", durationMs: null }, submission: { status: "unmeasured", durationMs: null }, playback: { status: "unmeasured", durationMs: null } });
// Acoustic echo cancellation handles speaker leakage first. Ignore recognisable
// playback phrases too, without discarding short answers such as "yes" or "stop".
function playbackEcho(text: string, reference: string) {
  const words = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const candidate = words(text), spoken = words(reference);
  return candidate.split(" ").length >= 3 && candidate.length >= 12 && (` ${spoken} `).includes(` ${candidate} `);
}
export function pcmWave(chunks: Float32Array[], rate: number) {
  const size = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + size * 2), view = new DataView(buffer);
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + size * 2, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, size * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) { view.setInt16(offset, Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767), true); offset += 2; }
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

/** Owns the microphone across React route changes. Native chat owns delivery.
 * No speech is sent without a bound conversation and explicit microphone opt-in. */
export class FridayVoiceSession {
  private state: VoiceState = { enabled: false, listening: false, hearingSpeech: false, speaking: false, playing: false, starting: false, sending: false, interim: "", error: "", local: false, checking: false, preparing: false, timings: emptyTimings() };
  private listeners = new Set<() => void>();
  private binding: VoiceBinding | null = null;
  private identity = "";
  private seen = new Set<string>();
  private since = Date.now();
  private recognition: VoiceRecognition | null = null;
  private silence?: ReturnType<typeof setTimeout>;
  private captured = "";
  private partial = "";
  private requestedReply = false;
  private detachTimer?: ReturnType<typeof setTimeout>;
  private playbackCancel?: () => void;
  private playbackText = "";
  private speechGeneration = 0;
  private speechAbort?: AbortController;
  private speechBuffer?: FridaySpeechBuffer;
  private streamedReply?: { id: string; runId?: string; buffer: FridaySpeechBuffer };
  private audio: HTMLAudioElement | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private captureGeneration = 0;
  private preparation: Promise<void> | null = null;
  private localReady = false;
  private timingGeneration = 0;
  constructor(private readonly monotonicNow = () => performance.now()) {}
  autoSpeak = true;
  voiceURI = "";
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private patch(next: Partial<VoiceState>) { this.state = { ...this.state, ...next }; this.listeners.forEach(listener => listener()); }
  private timing(stage: "transcription" | "submission" | "playback", status: VoiceTimingMeasurement["status"], durationMs: number | null = null) {
    this.patch({ timings: { ...this.state.timings, [stage]: { status, durationMs } } });
  }
  private cancelTimings() {
    this.timingGeneration++;
    const timings = this.state.timings;
    if (![timings.transcription, timings.submission, timings.playback].some(value => value.status === "pending")) return;
    const cancel = (value: VoiceTimingMeasurement): VoiceTimingMeasurement => value.status === "pending" ? { status: "cancelled", durationMs: null } : value;
    this.patch({ timings: { ...timings, transcription: cancel(timings.transcription), submission: cancel(timings.submission), playback: cancel(timings.playback) } });
  }
  canListen() { const host = window as unknown as VoiceWindow; return this.state.local ? !!navigator.mediaDevices?.getUserMedia : !!(host.SpeechRecognition ?? host.webkitSpeechRecognition); }
  bind(value: VoiceBinding) {
    clearTimeout(this.detachTimer);
    if (this.identity && this.identity !== value.key) { this.disable(); this.seen.clear(); this.streamedReply = undefined; this.since = Date.now(); }
    const first = this.identity !== value.key;
    if (first || this.binding?.companyId !== value.companyId || !this.state.timings.active) { this.cancelTimings(); this.patch({ timings: emptyTimings(value.companyId, value.key) }); }
    this.identity = value.key; this.binding = value;
    if (first && value.reply) this.seen.add(value.reply.id);
    if (first && value.liveReply) this.seen.add(value.liveReply.id);
    if (first && value.companyId) {
      this.patch({ checking: true });
      void api.get<{ available: boolean }>(`/companies/${value.companyId}/friday/voice`).then(status => { if (this.identity === value.key) { this.patch({ local: status.available }); if (status.available && !document.hidden) void this.prepareLocal(); } }).catch(() => { if (this.identity === value.key) this.patch({ local: false }); }).finally(() => { if (this.identity === value.key) this.patch({ checking: false }); });
    }
    if (value.liveReply && !value.disabled && !value.question && !this.state.hearingSpeech && !document.hidden) {
      this.updateStreamedReply(value.liveReply);
    }
    const persistedStream = value.reply?.runId && value.reply.runId === this.streamedReply?.runId
      && (this.streamedReply.buffer.cancelled || (this.streamedReply.buffer.text.length > 0
        && spokenReply(value.reply.body).startsWith(this.streamedReply.buffer.text)));
    if (persistedStream && value.reply) {
      this.seen.add(value.reply.id);
      this.streamedReply!.buffer.update(value.reply.body, true);
    }
    if (this.speechBuffer && this.streamedReply?.buffer === this.speechBuffer && (value.question || (!value.liveReply && !persistedStream && value.busy))) this.stopSpeaking(false);
    if (value.reply && !value.liveReply && !value.disabled && (!value.busy || value.reply.committed) && !value.question && !this.state.hearingSpeech && !this.seen.has(value.reply.id)) {
      this.seen.add(value.reply.id);
      const fresh = !value.reply.createdAt || new Date(value.reply.createdAt).getTime() >= this.since;
      if ((this.autoSpeak || this.requestedReply) && fresh && !document.hidden) { this.requestedReply = false; void this.speak(value.reply.body); }
    }
    if (value.disabled) { this.cancelTimings(); this.pauseCapture(); if (this.speechBuffer || this.state.speaking) this.stopSpeaking(false); }
    else { this.presentQuestion(); this.resume(); }
  }
  private updateStreamedReply(reply: SpokenReply) {
    if (this.streamedReply?.id === reply.id) {
      this.streamedReply.buffer.update(reply.body, !reply.streaming);
      if (this.streamedReply.buffer.cancelled && this.speechBuffer === this.streamedReply.buffer) this.stopSpeaking(false);
      return;
    }
    if (this.seen.has(reply.id)) return;
    this.seen.add(reply.id);
    const fresh = !reply.createdAt || new Date(reply.createdAt).getTime() >= this.since;
    if (!(this.autoSpeak || this.requestedReply) || !fresh) return;
    this.requestedReply = false;
    this.stopSpeaking(false);
    const buffer = new FridaySpeechBuffer();
    this.streamedReply = { id: reply.id, runId: reply.runId, buffer };
    buffer.update(reply.body, !reply.streaming);
    void this.playBuffer(buffer);
  }
  private presentQuestion() {
    const question = this.binding?.question;
    if (!question || (!this.state.enabled && !this.requestedReply) || document.hidden || this.binding?.disabled) return;
    if (!this.seen.has(question.id)) {
      this.seen.add(question.id);
      if (this.autoSpeak || this.requestedReply) { this.requestedReply = false; void this.speak(question.body); }
    }
  }
  unbind(key: string) { if (this.binding?.key === key) { this.detachTimer = setTimeout(() => { this.disable(); if (this.binding?.key === key) { this.binding = null; this.patch({ timings: { ...this.state.timings, active: false } }); } }, 1500); } }
  private prepareLocal() {
    if (this.preparation) return this.preparation;
    if (!this.state.local || !this.binding?.companyId) return Promise.resolve();
    this.localReady = false;
    this.patch({ preparing: true });
    this.preparation = api.post(`/companies/${this.binding.companyId}/friday/voice`, { op: "prepare" }).then(() => { this.localReady = true; }).catch(() => { this.localReady = false; }).finally(() => {
      this.preparation = null;
      this.patch({ preparing: false });
    });
    return this.preparation;
  }
  private pauseCapture() {
    clearTimeout(this.silence);
    const active = this.recognition; this.recognition = null;
    if (active) { active.onstart = active.onend = active.onerror = active.onresult = null; active.abort(); }
    const unfinished = [this.captured, this.partial].filter(Boolean).join(" ").trim();
    if (unfinished) this.binding?.draft(unfinished);
    this.captured = ""; this.partial = "";
    this.captureGeneration++;
    this.processor?.disconnect(); this.processor = null;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    void this.context?.close().catch(() => {}); this.context = null;
    if (this.state.listening || this.state.starting || this.state.interim || this.state.hearingSpeech) this.patch({ listening: false, hearingSpeech: false, starting: false, interim: "" });
  }
  private resume() {
    // Execution and playback are interruptible; only native holds and an in-flight
    // delivery pause capture. The microphone opt-in survives those brief pauses.
    if (!this.state.enabled || !this.binding || this.binding.disabled || this.state.sending || this.state.starting || this.state.listening || document.hidden) return;
    if (this.state.local) void this.listenLocal(); else this.listenBrowser();
  }
  toggle = () => { if (this.state.enabled) this.disable(); else { this.since = Date.now(); this.patch({ enabled: true, error: "" }); if (this.state.local) void this.prepareLocal(); this.presentQuestion(); this.resume(); } };
  disable = () => { clearTimeout(this.detachTimer); this.cancelTimings(); this.requestedReply = false; this.patch({ enabled: false, sending: false, interim: "" }); this.pauseCapture(); this.stopSpeaking(false); };
  /** A Discuss click requests one spoken response without enabling capture or
   * changing the user's persistent voice preference. */
  requestSpokenReply = (key: string) => {
    if (this.identity !== key || !this.binding || this.binding.disabled) return false;
    this.requestedReply = true; this.since = Date.now();
    window.speechSynthesis?.resume?.();
    return true;
  };
  cancelRequestedReply = () => { this.requestedReply = false; };
  visibility = () => { if (document.hidden) { this.cancelTimings(); this.pauseCapture(); this.stopSpeaking(false); } else { if (this.state.local) void this.prepareLocal(); this.presentQuestion(); this.resume(); } };
  private async deliver(text: string) {
    const target = this.binding;
    if (!text.trim() || !target || target.disabled || !this.state.enabled) { this.resume(); return; }
    this.pauseCapture(); target.onTurn?.();
    if (!target.send) { target.draft(text); this.resume(); return; }
    if (!this.state.local) this.timing("transcription", "unavailable");
    const startedAt = this.monotonicNow(), timingGeneration = this.timingGeneration;
    const currentTiming = () => timingGeneration === this.timingGeneration && this.identity === target.key;
    this.timing("submission", "pending");
    this.patch({ sending: true, interim: text });
    try { await target.send(text); if (currentTiming()) this.timing("submission", "measured", Math.max(0, this.monotonicNow() - startedAt)); }
    catch (error) { if (currentTiming()) this.timing("submission", "failed"); if (this.identity !== target.key) return; if (!(error instanceof Error && "draftPreserved" in error && error.draftPreserved)) target.draft(text); this.patch({ error: error instanceof Error ? error.message : "Message could not be sent. Your text is preserved as a draft." }); }
    finally { if (this.identity === target.key) { this.patch({ sending: false, interim: "" }); this.resume(); } }
  }
  private listenBrowser() {
    const host = window as unknown as VoiceWindow, Constructor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
    if (!Constructor || !this.binding) return;
    const active = new Constructor(); this.recognition = active;
    let failed = false, turnReference = "";
    this.captured = ""; this.partial = ""; this.patch({ starting: true });
    active.lang = navigator.language || "en-US"; active.continuous = true; active.interimResults = true;
    active.onstart = () => { if (this.recognition === active) this.patch({ starting: false, listening: true }); };
    active.onresult = event => {
      if (this.recognition !== active) return;
      const previousInterim = this.state.interim;
      let partial = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        turnReference ||= this.playbackReference();
        if (!text || playbackEcho(text, turnReference)) continue;
        this.patch({ hearingSpeech: true });
        if (this.speechBuffer) this.stopSpeaking(false);
        if (result.isFinal) {
          if (this.binding?.send) this.captured = [this.captured, text].filter(Boolean).join(" "); else if (text) this.binding?.draft(text);
        } else partial += result[0].transcript;
      }
      this.partial = partial.trim();
      const interim = [this.captured, this.partial].filter(Boolean).join(" ");
      this.patch({ interim, hearingSpeech: !!interim });
      // Some browsers keep a completed utterance interim until stop() is called.
      // Every fresh word resets this boundary; final-only gating can wait forever.
      if (interim && this.binding?.send && (interim !== previousInterim || !this.silence)) {
        clearTimeout(this.silence);
        this.silence = setTimeout(() => { if (this.recognition === active) active.stop(); }, 1000);
      }
    };
    active.onerror = event => {
      if (event.error === "no-speech") return;
      failed = true;
      this.patch({ enabled: false, error: event.error === "not-allowed" || event.error === "service-not-allowed" ? "Microphone permission was denied. Allow it in your browser settings, or type." : `Voice input stopped (${event.error}). Your draft is still available.` });
      this.pauseCapture();
    };
    active.onend = () => {
      if (this.recognition !== active) return;
      this.recognition = null; clearTimeout(this.silence); this.silence = undefined;
      const text = [this.captured, this.partial].filter(Boolean).join(" ").trim(); this.captured = ""; this.partial = ""; this.patch({ listening: false, hearingSpeech: false, starting: false, interim: "" });
      if (!failed && text && !playbackEcho(text, turnReference)) void this.deliver(text); else this.resume();
    };
    try { active.start(); } catch { this.patch({ enabled: false, error: "The browser could not start voice input. Try again or type." }); this.pauseCapture(); }
  }
  private async listenLocal() {
    const generation = ++this.captureGeneration;
    this.patch({ starting: true });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (generation !== this.captureGeneration || !this.state.enabled || !this.binding) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream; const context = new AudioContext({ sampleRate: 16000 }); this.context = context;
      await context.resume();
      if (generation !== this.captureGeneration) { stream.getTracks().forEach(track => track.stop()); void context.close().catch(() => {}); return; }
      const source = context.createMediaStreamSource(stream), processor = context.createScriptProcessor(2048, 1, 1);
      this.processor = processor; source.connect(processor); processor.connect(context.destination);
      let chunks: Float32Array[] = [], pre: Float32Array[] = [], speechMs = 0, silenceMs = 0, totalMs = 0, speechPeak = 0;
      let previewPending = false, previewAt = 0, previewText = "", turnReference = "", previewRequest: Promise<void> | null = null;
      processor.onaudioprocess = event => {
        if (generation !== this.captureGeneration) return;
        const samples = event.inputBuffer.getChannelData(0), ms = samples.length / context.sampleRate * 1000;
        let sum = 0; for (const sample of samples) sum += sample * sample;
        const rms = Math.sqrt(sum / samples.length);
        // Follow this utterance's level so a fan/room floor above the old fixed
        // threshold does not hold an otherwise completed sentence open forever.
        const voiced = rms >= Math.max(0.012, Math.min(0.025, speechPeak * 0.5));
        if (voiced) speechPeak = Math.max(speechPeak, rms);
        if (voiced) { if (!chunks.length) { chunks.push(...pre); turnReference = this.playbackReference(); } speechMs += ms; silenceMs = 0; }
        else silenceMs += ms;
        if (speechMs) { chunks.push(samples.slice()); totalMs += ms; }
        pre = [...pre.slice(-2), samples.slice()];
        // Energy drives endpoint detection, but recognised words confirm a user
        // turn. A steady fan must not silently suppress Friday's next reply.
        if (speechMs >= 250 && (silenceMs >= 750 || totalMs >= 45000)) {
          // Include encoding, preparation and queued preview work, not merely
          // the final HTTP request. Do not mix this with provider response time.
          const startedAt = this.monotonicNow(), timingGeneration = this.timingGeneration;
          this.timing("transcription", "pending");
          const audio = pcmWave(chunks, context.sampleRate), target = this.binding, reference = turnReference;
          chunks = []; speechMs = 0; this.pauseCapture(); this.patch({ sending: true, interim: previewText || "Finishing your words…" });
          if (!target?.companyId) { this.timing("transcription", "unavailable"); this.patch({ sending: false, interim: "" }); return; }
          const turnGeneration = this.captureGeneration;
          void (async () => { await this.preparation; await previewRequest; if (!this.state.enabled || this.identity !== target.key || this.captureGeneration !== turnGeneration) return { text: "" }; return api.post<{ text: string }>(`/companies/${target.companyId}/friday/voice`, { op: "transcribe", audio }); })().then(result => {
            if (this.identity !== target.key || this.captureGeneration !== turnGeneration) return;
            if (timingGeneration === this.timingGeneration) this.timing("transcription", "measured", Math.max(0, this.monotonicNow() - startedAt));
            this.patch({ sending: false, interim: "" });
            if (this.state.enabled && result.text.trim() && !playbackEcho(result.text, reference)) { if (this.speechBuffer) this.stopSpeaking(false); return this.deliver(result.text); }
          }).catch(() => { if (this.identity === target.key && this.captureGeneration === turnGeneration) { if (timingGeneration === this.timingGeneration) this.timing("transcription", "failed"); if (previewText) target.draft(previewText); this.patch({ sending: false, error: "Local transcription could not finish this turn. Any recognised words are saved as a draft. You can retry or type." }); } }).finally(() => this.resume());
        } else if (speechMs > 0 && speechMs < 250 && silenceMs >= 750) { chunks = []; speechMs = 0; totalMs = 0; previewAt = 0; speechPeak = 0; turnReference = ""; }
        else if (voiced && speechMs >= 350 && totalMs - previewAt >= 450 && !previewPending && this.localReady && this.binding?.companyId) {
          const target = this.binding;
          // Transcribe at most the latest 12 seconds for a responsive preview.
          // Only the final full turn below can enter the native conversation.
          const tail = chunks.slice(-Math.ceil(context.sampleRate * 12 / 2048));
          previewAt = totalMs; previewPending = true;
          previewRequest = api.post<{ text: string }>(`/companies/${target.companyId}/friday/voice`, { op: "transcribe", audio: pcmWave(tail, context.sampleRate) }).then(result => {
            if (this.captureGeneration === generation && this.identity === target.key && this.state.enabled && result.text.trim() && !playbackEcho(result.text, turnReference)) {
              if (this.speechBuffer) this.stopSpeaking(false);
              previewText = result.text.trim(); this.patch({ interim: previewText, hearingSpeech: true });
            }
          }).catch(() => { /* A preview is optional; the final turn still owns delivery. */ }).finally(() => { previewPending = false; });
        }
      };
      this.patch({ starting: false, listening: true });
    } catch { if (generation === this.captureGeneration) { this.patch({ enabled: false, error: "Microphone permission was denied or no microphone is available. You can still type." }); this.pauseCapture(); } }
  }
  private playbackReference() { return this.state.playing ? this.playbackText : ""; }
  stopSpeaking = (resume = true) => {
    this.speechGeneration++;
    this.speechBuffer?.cancel(); this.speechBuffer = undefined;
    this.speechAbort?.abort(); this.speechAbort = undefined;
    if (this.state.timings.playback.status === "pending") this.timing("playback", "cancelled");
    this.playbackCancel?.(); this.playbackCancel = undefined;
    this.audio?.pause(); if (this.audio) this.audio.src = ""; this.audio = null;
    window.speechSynthesis?.cancel(); this.patch({ speaking: false, playing: false }); if (resume) this.resume();
  };
  async speak(body: string) {
    const text = spokenReply(body); if (!text || this.binding?.disabled || (this.state.enabled && this.state.hearingSpeech)) return;
    this.stopSpeaking(false);
    const buffer = new FridaySpeechBuffer(); buffer.update(body, true);
    return this.playBuffer(buffer);
  }
  private async playBuffer(buffer: FridaySpeechBuffer) {
    this.speechBuffer = buffer;
    const abort = new AbortController(); this.speechAbort = abort;
    const generation = this.speechGeneration;
    const startedAt = this.monotonicNow();
    this.timing("playback", "pending");
    this.patch({ speaking: true, playing: false, error: "" }); this.resume();
    const started = () => {
      if (generation === this.speechGeneration) this.patch({ playing: true });
      if (generation === this.speechGeneration && this.state.timings.playback.status === "pending") {
        this.timing("playback", "measured", Math.max(0, this.monotonicNow() - startedAt));
      }
    };
    // One lookahead chunk overlaps synthesis with playback. There is no idle
    // work and an interrupted turn cannot enqueue more local inference.
    const companyId = this.state.local ? this.binding?.companyId : undefined;
    const synthesize = (chunk: string) => api.post<{ audio: string }>(`/companies/${companyId}/friday/voice`, { op: "speak", text: chunk }, { signal: abort.signal })
      .then(result => ({ result, error: null }), error => ({ result: null, error }));
    type PreparedSpeech = { chunk: string; audio: Awaited<ReturnType<typeof synthesize>> | null };
    const prepareChunk = (chunk: string | null): PreparedSpeech | null | Promise<PreparedSpeech | null> => {
      if (!chunk || generation !== this.speechGeneration) return null;
      return companyId ? synthesize(chunk).then(audio => ({ chunk, audio })) : { chunk, audio: null };
    };
    const prepareNext = () => {
      const chunk = buffer.next();
      return chunk instanceof Promise ? chunk.then(prepareChunk) : prepareChunk(chunk);
    };
    let prepared = prepareNext();
    try {
      while (true) {
        const next = prepared instanceof Promise ? await prepared : prepared;
        if (!next) break;
        if (generation !== this.speechGeneration) break;
        const { chunk } = next;
        this.playbackText = chunk;
        if (companyId && next.audio) {
          const { result, error } = next.audio;
          if (error || !result) throw error ?? new Error("Speech synthesis failed");
          const audio = new Audio(`data:audio/wav;base64,${result.audio}`); this.audio = audio;
          await new Promise<void>((resolve, reject) => {
            this.playbackCancel = resolve; audio.onended = () => { if (generation === this.speechGeneration) this.patch({ playing: false }); resolve(); }; audio.onerror = () => reject(new Error("Audio playback failed"));
            void audio.play().then(() => {
              started();
              if (generation === this.speechGeneration) prepared = prepareNext();
            }).catch(reject);
          });
        } else {
          if (!window.speechSynthesis) throw new Error("Speech playback is unavailable");
          await new Promise<void>((resolve, reject) => {
            this.playbackCancel = resolve;
            const utterance = new SpeechSynthesisUtterance(chunk);
            const voices = window.speechSynthesis.getVoices();
            utterance.voice = voices.find(voice => voice.voiceURI === this.voiceURI) ?? voices.find(voice => voice.localService && /^en\b/.test(voice.lang)) ?? null;
            utterance.onstart = started;
            utterance.onend = () => { if (generation === this.speechGeneration) this.patch({ playing: false }); resolve(); }; utterance.onerror = () => generation !== this.speechGeneration ? resolve() : reject(new Error("Playback blocked"));
            window.speechSynthesis.speak(utterance);
            prepared = prepareNext();
          });
        }
      }
    } catch { if (generation === this.speechGeneration) { abort.abort(); buffer.cancel(); if (this.state.timings.playback.status === "pending") this.timing("playback", "failed"); this.patch({ error: "Speech playback failed or was blocked. Click Read reply to retry; the response is in your conversation." }); } }
    finally { if (generation === this.speechGeneration) { if (this.state.timings.playback.status === "pending") this.timing("playback", "unavailable"); this.audio = null; this.speechBuffer = undefined; this.speechAbort = undefined; this.patch({ speaking: false, playing: false }); this.resume(); } }
  }
}
export const fridayVoiceSession = new FridayVoiceSession();
