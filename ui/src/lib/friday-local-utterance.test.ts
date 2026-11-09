import { describe, expect, it } from "vitest";
import { FridayLocalUtterance } from "./friday-local-utterance";

const rate = 16_000;
const frame = (ms: number, value = 0) => new Float32Array(ms * rate / 1_000).fill(value);

describe("bounded local utterance snapshots", () => {
  it("keeps the pause provisional and retains resumed speech while recognition is pending", () => {
    const capture = new FridayLocalUtterance(rate);
    capture.append(frame(400, .1), true);
    capture.append(frame(750), false);
    const old = capture.snapshot()!;
    expect(capture.provisional).toBe(true);
    expect(capture.canFinalize(old)).toBe(false);
    capture.append(frame(400, .2), true);
    expect(capture.isCurrent(old)).toBe(false);
    capture.append(frame(1_300), false);
    expect(capture.canFinalize(old)).toBe(false);
    const latest = capture.snapshot()!;
    expect(capture.canFinalize(latest)).toBe(true);
    expect(latest.durationMs).toBe(2_850);
    expect(latest.chunks[0][0]).toBeCloseTo(.1);
    expect(latest.chunks[0][1_150 * rate / 1_000]).toBeCloseTo(.2);
    // A frozen request cannot change when later frames arrive.
    expect(old.durationMs).toBe(1_150);
    expect(old.chunks[0]).toHaveLength(1_150 * rate / 1_000);
  });

  it("accepts a still-current provisional result only after1.3 seconds of quiet", () => {
    const capture = new FridayLocalUtterance(rate);
    capture.append(frame(300, .1), true);
    capture.append(frame(750), false);
    const snapshot = capture.snapshot()!;
    capture.append(frame(549), false);
    expect(capture.isCurrent(snapshot)).toBe(true);
    expect(capture.canFinalize(snapshot)).toBe(false);
    capture.append(frame(1), false);
    expect(capture.canFinalize(snapshot)).toBe(true);
  });

  it("rejects a result from a reset turn even if the new speech has the same revision", () => {
    const capture = new FridayLocalUtterance(rate);
    capture.append(frame(300), true); capture.append(frame(1_300), false);
    const old = capture.snapshot()!;
    capture.reset();
    capture.append(frame(300), true); capture.append(frame(1_300), false);
    expect(capture.snapshot()!.revision).toBe(old.revision);
    expect(capture.isCurrent(old)).toBe(false);
  });

  it("bounds idle preroll and copies caller samples before retaining them", () => {
    const capture = new FridayLocalUtterance(rate);
    for (let i = 0; i < 100; i++) capture.append(frame(100, .05), false);
    expect(capture.snapshot()).toBeNull();
    expect(capture.durationMs).toBe(0);
    const voiced = frame(300, .1);
    capture.append(voiced, true); voiced.fill(1);
    const snapshot = capture.snapshot()!;
    expect(snapshot.durationMs).toBe(684);
    expect(snapshot.chunks[0][0]).toBeCloseTo(.05);
    expect(snapshot.chunks[0].at(-1)).toBeCloseTo(.1);
  });

  it("caps an overlong turn without permitting a truncated automatic send", () => {
    const capture = new FridayLocalUtterance(rate, 2_000);
    capture.append(frame(400, .1), true);
    const before = capture.snapshot()!;
    capture.append(frame(2_000, .2), true);
    expect(capture.atCapacity).toBe(true);
    expect(capture.durationMs).toBe(2_000);
    expect(capture.snapshot()).toBeNull();
    expect(capture.canFinalize(before)).toBe(false);
    capture.append(frame(10_000), false);
    expect(capture.durationMs).toBe(2_000);
    capture.reset();
    expect(capture.atCapacity).toBe(false);
    expect(capture.active).toBe(false);
  });

  it("limits previews to the latest requested audio and drops short transients", () => {
    const capture = new FridayLocalUtterance(rate);
    capture.append(frame(100), true); capture.append(frame(750), false);
    expect(capture.active).toBe(false);
    capture.append(frame(500, .1), true); capture.append(frame(500, .2), true);
    const preview = capture.snapshot(500)!;
    expect(preview.durationMs).toBe(500);
    expect(preview.chunks[0].every(value => Math.abs(value - .2) < .00001)).toBe(true);
  });
});
