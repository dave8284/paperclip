export interface FridayUtteranceSnapshot {
  turn: number;
  revision: number;
  chunks: Float32Array[];
  durationMs: number;
}

/** Pure, bounded capture owner. Recognition can inspect a snapshot while audio
 * continues arriving; only unchanged speech followed by settled quiet can send.
 * It owns no microphone, inference, timers, delivery or conversation identity. */
export class FridayLocalUtterance {
  private readonly samples: Float32Array;
  private readonly pre: Float32Array;
  private length = 0;
  private preLength = 0;
  private voicedSamples = 0;
  private quietSamples = 0;
  private turnNumber = 0;
  private speechRevision = 0;
  private capped = false;

  constructor(readonly sampleRate: number, maxDurationMs = 60_000) {
    if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 192_000
      || !Number.isFinite(maxDurationMs) || maxDurationMs < 1_300 || maxDurationMs > 60_000) {
      throw new Error("Invalid local capture bounds");
    }
    this.samples = new Float32Array(Math.ceil(sampleRate * maxDurationMs / 1_000));
    this.pre = new Float32Array(Math.ceil(sampleRate * 384 / 1_000));
  }

  get active() { return this.voicedSamples > 0; }
  get speechMs() { return this.voicedSamples / this.sampleRate * 1_000; }
  get quietMs() { return this.quietSamples / this.sampleRate * 1_000; }
  get durationMs() { return this.length / this.sampleRate * 1_000; }
  get atCapacity() { return this.capped; }
  get provisional() { return this.active && !this.capped && this.speechMs >= 250 && this.quietMs >= 750; }
  get settled() { return this.provisional && this.quietMs >= 1_300; }

  append(frame: Float32Array, voiced: boolean) {
    if (!frame.length || this.capped) return;
    if (voiced && !this.active) {
      this.turnNumber++;
      this.samples.set(this.pre.subarray(0, this.preLength));
      this.length = this.preLength;
    }
    if (voiced) { this.voicedSamples += frame.length; this.quietSamples = 0; this.speechRevision++; }
    else if (this.active) this.quietSamples += frame.length;
    if (this.active) {
      const accepted = Math.min(frame.length, this.samples.length - this.length);
      this.samples.set(frame.subarray(0, accepted), this.length);
      this.length += accepted;
      this.capped = this.length === this.samples.length;
    }
    const tail = frame.subarray(Math.max(0, frame.length - this.pre.length));
    const retained = Math.min(this.preLength, this.pre.length - tail.length);
    this.pre.copyWithin(0, this.preLength - retained, this.preLength);
    this.pre.set(tail, retained);
    this.preLength = retained + tail.length;
    // A short transient cannot hold the next real utterance open indefinitely.
    if (!this.capped && this.active && this.speechMs < 250 && this.quietMs >= 750) this.reset();
  }

  snapshot(maxMs = 60_000): FridayUtteranceSnapshot | null {
    if (!this.active || this.capped || this.speechMs < 250) return null;
    if (!Number.isFinite(maxMs) || maxMs <= 0 || maxMs > 60_000) throw new Error("Invalid capture snapshot bound");
    const length = Math.min(this.length, Math.ceil(maxMs * this.sampleRate / 1_000));
    return { turn: this.turnNumber, revision: this.speechRevision,
      chunks: [this.samples.slice(this.length - length, this.length)], durationMs: length / this.sampleRate * 1_000 };
  }

  isCurrent(snapshot: FridayUtteranceSnapshot) {
    return this.active && !this.capped && snapshot.turn === this.turnNumber && snapshot.revision === this.speechRevision;
  }
  canFinalize(snapshot: FridayUtteranceSnapshot) { return this.isCurrent(snapshot) && this.settled; }
  reset() {
    this.turnNumber++;
    this.length = this.preLength = this.voicedSamples = this.quietSamples = 0;
    this.speechRevision = 0;
    this.capped = false;
  }
}
