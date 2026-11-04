// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WaitlistCelebration } from "./WaitlistCelebration";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let preference: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
async function render(enabled: boolean) { await act(async () => root.render(<WaitlistCelebration enabled={enabled} />)); }
beforeEach(() => {
  container = document.createElement("div"); root = createRoot(container);
  preference = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", vi.fn(() => preference));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("runs only on confirmed enablement and ends on its own animation, without scheduling timers or frames", async () => {
  const timer = vi.spyOn(window, "setTimeout"); const frame = vi.spyOn(window, "requestAnimationFrame");
  await render(false); expect(container.children).toHaveLength(0);
  await render(true);
  const burst = container.querySelector(".waitlist-celebration")!;
  expect(burst.children).toHaveLength(24);
  await act(async () => burst.firstElementChild!.dispatchEvent(new Event("AnimationEvent" in window ? "animationend" : "webkitAnimationEnd", { bubbles: true })));
  expect(container.firstElementChild).toBe(burst);
  await act(async () => burst.dispatchEvent(new Event("AnimationEvent" in window ? "animationend" : "webkitAnimationEnd", { bubbles: true })));
  expect(container.children).toHaveLength(0);
  await render(false); await render(true);
  expect(container.children).toHaveLength(0);
  expect(timer).not.toHaveBeenCalled(); expect(frame).not.toHaveBeenCalled();
  expect(preference.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
});
it("skips the burst when reduced motion is requested", async () => {
  preference.matches = true; await render(true);
  expect(container.children).toHaveLength(0);
  expect(preference.addEventListener).not.toHaveBeenCalled();
});
it("stops immediately when reduced motion is enabled and releases its listener", async () => {
  await render(true); const listener = preference.addEventListener.mock.calls[0][1];
  preference.matches = true; await act(async () => listener());
  expect(container.children).toHaveLength(0);
  expect(preference.removeEventListener).toHaveBeenCalledWith("change", listener);
});
it("releases motion subscriptions on unmount before completion", async () => {
  await render(true); const listener = preference.addEventListener.mock.calls[0][1];
  await act(async () => root.render(null));
  expect(preference.removeEventListener).toHaveBeenCalledWith("change", listener);
});
it("does not animate when media preference support is missing", async () => {
  vi.stubGlobal("matchMedia", undefined); await render(true); expect(container.children).toHaveLength(0);
});
