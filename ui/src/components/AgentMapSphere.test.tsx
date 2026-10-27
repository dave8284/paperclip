// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentMapSphere } from "./AgentMapSphere";
import { drawFridayOrb } from "@/lib/friday-orb";

vi.mock("@/lib/friday-orb", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/friday-orb")>(), drawFridayOrb: vi.fn() }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ setTransform: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("uses Friday's renderer and animates only a real running employee", async () => {
  await act(async () => root.render(<svg><AgentMapSphere x={10} y={20} running /></svg>));
  expect(drawFridayOrb).toHaveBeenLastCalledWith(expect.anything(), expect.any(Array), 92, expect.any(Number), "thinking", expect.any(String), expect.any(String), false);
  expect(requestAnimationFrame).toHaveBeenCalled();
  vi.mocked(requestAnimationFrame).mockClear();
  await act(async () => root.render(<svg><AgentMapSphere x={10} y={20} /></svg>));
  expect(drawFridayOrb).toHaveBeenLastCalledWith(expect.anything(), expect.any(Array), 92, 0, "idle", expect.any(String), expect.any(String), true);
  expect(requestAnimationFrame).not.toHaveBeenCalled();
});
it("pauses particle animation for reduced motion", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  await act(async () => root.render(<svg><AgentMapSphere x={10} y={20} running /></svg>));
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  expect(drawFridayOrb).toHaveBeenLastCalledWith(expect.anything(), expect.any(Array), 92, 0, "thinking", expect.any(String), expect.any(String), true);
});
it("shares one animation clock and cancels it when the map leaves the page", async () => {
  await act(async () => root.render(<svg><AgentMapSphere x={10} y={20} running /><AgentMapSphere x={150} y={20} running /></svg>));
  expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  expect(drawFridayOrb).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null));
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
});
