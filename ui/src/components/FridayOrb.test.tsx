// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FridayOrb } from "./FridayOrb";
import { drawFridayOrb } from "@/lib/friday-orb";

vi.mock("@/lib/friday-orb", () => ({ orbPoints: () => [], drawFridayOrb: vi.fn() }));

describe("Friday orb landing motion", () => {
  let host: HTMLDivElement, root: Root;
  let frames: Map<number, FrameRequestCallback>, nextFrame: number, now: number;
  let reduced: MediaQueryList, fine: MediaQueryList;
  let intersection: IntersectionObserverCallback;
  let animate: ReturnType<typeof vi.fn>;
  let pulseAnimation: { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null };
  const disconnect = vi.fn();
  function media(matches: boolean) {
    return Object.assign(new EventTarget(), { matches }) as unknown as MediaQueryList;
  }
  function change(query: MediaQueryList, matches: boolean) {
    Object.defineProperty(query, "matches", { value: matches, configurable: true });
    query.dispatchEvent(new Event("change"));
  }
  function pointer(x: number, y: number, pointerType = "mouse") {
    const event = new MouseEvent("pointermove", { clientX: x, clientY: y });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    window.dispatchEvent(event);
  }
  function hover(type: "pointerenter" | "pointerleave", pointerType = "mouse") {
    const event = new MouseEvent(type, { clientX: 100, clientY: 100 });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    host.querySelector(".friday-orb")!.dispatchEvent(event);
  }
  const hovered = () => host.querySelector('.friday-orb[data-pointer-hovered="true"]');
  function advance(time: number) {
    now = time;
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(callback => callback(now));
  }
  const latestPose = () => vi.mocked(drawFridayOrb).mock.calls.at(-1)?.[8];
  beforeEach(() => {
    vi.clearAllMocks(); frames = new Map(); nextFrame = 0; now = 0;
    reduced = media(false); fine = media(true);
    vi.stubGlobal("matchMedia", (query: string) => query.includes("reduced-motion") ? reduced : fine);
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("IntersectionObserver", class { constructor(callback: IntersectionObserverCallback) { intersection = callback; } observe() {} disconnect = disconnect; });
    pulseAnimation = { cancel: vi.fn(), onfinish: null };
    animate = vi.fn(() => pulseAnimation);
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ setTransform: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 200 } as DOMRect);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ getPropertyValue: (name: string) => ({
      "--friday-pointer-settle-ms": "1200", "--friday-pointer-yaw": "1.8", "--friday-pointer-pitch": "0.9",
      "--friday-pointer-roll": "1.2", "--friday-pointer-pulse": "0.18", "--friday-pointer-twist": "1.4",
      "--friday-pointer-hover-scale": "1.18", "--friday-pointer-hover-duration-ms": "900", "--friday-pointer-hover-cycles": "2",
      "--motion-ease-standard": "cubic-bezier(0.4, 0, 0.2, 1)",
    }[name] ?? "") } as CSSStyleDeclaration);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    delete (document as unknown as { hidden?: boolean }).hidden;
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });
  async function render(pointerReactive = true, state: "idle" | "listening" = "idle") {
    await act(async () => root.render(<FridayOrb state={state} label="Friday" decorative pointerReactive={pointerReactive} />));
  }
  it("starts only on pointer input across the page, changes spin direction and settles without a loop", async () => {
    await render();
    expect(frames.size).toBe(0);
    expect(host.querySelector("button")).toBeNull();
    pointer(350, 250); advance(16);
    expect(latestPose()?.yaw).toBeGreaterThan(0);
    expect(latestPose()?.pitch).toBeGreaterThan(0);
    expect(latestPose()?.pulse).toBeGreaterThan(0);
    pointer(20, 150); advance(32);
    expect(latestPose()?.yaw).toBeLessThan(0);
    expect(latestPose()?.twist).toBeLessThan(0);
    expect(latestPose()?.roll).not.toBe(0);
    advance(1216);
    expect(frames.size).toBe(0);
    expect(latestPose()).toEqual({ yaw: -0, pitch: -0, roll: -0, pulse: 0, twist: -0 });
  });
  it("pulses from neutral to a visible peak and back twice while the pointer stays centered, then rests", async () => {
    await render();
    hover("pointerenter");
    expect(hovered()).not.toBeNull();
    expect(frames.size).toBe(0);
    expect(animate).toHaveBeenCalledWith([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 900, iterations: 2, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
    pointer(100, 100); advance(1200);
    expect(animate).toHaveBeenCalledTimes(1);
    pulseAnimation.onfinish?.();
    expect(hovered()).not.toBeNull();
    expect(frames.size).toBe(0);
    expect(animate).toHaveBeenCalledTimes(1);
    pointer(110, 100);
    expect(animate).toHaveBeenCalledTimes(2);
    hover("pointerleave");
    expect(hovered()).toBeNull();
    expect(pulseAnimation.cancel).toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
  it("does not animate for reduced motion, coarse pointers or touch events", async () => {
    await render();
    change(reduced, true); pointer(180, 180); expect(frames.size).toBe(0);
    change(reduced, false); change(fine, false); pointer(180, 180); expect(frames.size).toBe(0);
    change(fine, true); pointer(180, 180, "touch"); expect(frames.size).toBe(0);
    pointer(180, 180); expect(frames.size).toBe(1);
    change(reduced, true); expect(frames.size).toBe(0); expect(latestPose()).toBeUndefined();
  });
  it("suppresses hover growth for reduced motion, coarse pointers and touch, and resets on preference changes", async () => {
    await render();
    change(reduced, true); hover("pointerenter"); expect(hovered()).toBeNull();
    change(reduced, false); change(fine, false); hover("pointerenter"); expect(hovered()).toBeNull();
    change(fine, true); hover("pointerenter", "touch"); expect(hovered()).toBeNull();
    expect(animate).not.toHaveBeenCalled();
    hover("pointerenter"); expect(hovered()).not.toBeNull();
    change(fine, false); expect(hovered()).toBeNull(); expect(pulseAnimation.cancel).toHaveBeenCalled();
  });
  it("stops offscreen and hidden, resuming only on fresh pointer input", async () => {
    await render(); pointer(180, 180); hover("pointerenter");
    intersection([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(frames.size).toBe(0); expect(hovered()).toBeNull(); pointer(20, 20); hover("pointerenter"); expect(frames.size).toBe(0); expect(hovered()).toBeNull();
    intersection([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(frames.size).toBe(0); pointer(20, 20); hover("pointerenter"); expect(frames.size).toBe(1); expect(hovered()).not.toBeNull();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange")); expect(frames.size).toBe(0); expect(hovered()).toBeNull();
    pointer(180, 180); expect(frames.size).toBe(0);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange")); expect(frames.size).toBe(0);
  });
  it("disposes listeners and frames when the landing orb unmounts", async () => {
    await render(); pointer(180, 180); expect(frames.size).toBe(1);
    await act(async () => root.render(null));
    expect(frames.size).toBe(0); expect(disconnect).toHaveBeenCalled();
    pointer(20, 20); expect(frames.size).toBe(0);
  });
  it("preserves the ordinary voice-state animation when pointer response is absent", async () => {
    await render(false); expect(frames.size).toBe(1);
    hover("pointerenter"); expect(hovered()).toBeNull();
    pointer(180, 180); advance(40); expect(latestPose()).toBeUndefined();
    await render(false, "listening");
    expect(vi.mocked(drawFridayOrb).mock.calls.at(-1)?.[4]).toBe("listening");
    expect(frames.size).toBe(1);
  });
});
