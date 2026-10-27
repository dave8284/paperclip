// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import type { FridayWork } from "@paperclipai/shared";
import { FridayWorkGraph } from "./FridayWorkGraph";

it("inspects a real map record before opening it, and keeps zoom reversible", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const open = vi.fn();
  const data = { projects: [{ id: "project", name: "Launch", status: "in_progress" }], applications: [], tasks: [], assignments: [], evidence: [], handoffs: [] } as unknown as FridayWork;
  try {
    await act(async () => root.render(<FridayWorkGraph data={data} agents={[]} running={new Set()} onSelect={open} />));
    expect(host.querySelectorAll('g[role="button"]')).toHaveLength(1);
    await act(async () => host.querySelector('g[role="button"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(open).not.toHaveBeenCalled(); expect(host.querySelector('[aria-label="Selected map record"]')?.textContent).toContain("Launch");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Open project")!.click());
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ recordId: "project", kind: "project" }));
    const initial = host.querySelector("svg.friday-work-graph")!.getAttribute("viewBox");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click());
    expect(host.querySelector("svg.friday-work-graph")!.getAttribute("viewBox")).not.toBe(initial);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Fit work graph"]')!.click());
    expect(host.querySelector("svg.friday-work-graph")!.getAttribute("viewBox")).toBe(initial);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
