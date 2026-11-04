import { describe, expect, it, vi } from "vitest";
import { drawFridayOrb, orbPoints, type FridayOrbPose } from "./friday-orb";

function render(pose?: FridayOrbPose, reduced = false) {
  const arc = vi.fn();
  const ctx = { clearRect() {}, createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc, fill() {} } as unknown as CanvasRenderingContext2D;
  drawFridayOrb(ctx, orbPoints(12), 200, 2, "idle", "ink", "glow", reduced, pose);
  return arc.mock.calls;
}

describe("Friday orb decorative pose", () => {
  const pose = { yaw: 0.8, pitch: -0.4, roll: 0.2, pulse: 0.1, twist: 0.5 };
  it("changes projected points while preserving finite canvas geometry", () => {
    const ordinary = render();
    const responsive = render(pose);
    expect(responsive).toHaveLength(ordinary.length);
    expect(responsive).not.toEqual(ordinary);
    expect(responsive.flat().every(Number.isFinite)).toBe(true);
  });
  it("ignores a decorative pose with reduced motion and preserves the neutral projection", () => {
    expect(render(pose, true)).toEqual(render(undefined, true));
    expect(render({ yaw: 0, pitch: 0, roll: 0, pulse: 0, twist: 0 })).toEqual(render());
  });
});
