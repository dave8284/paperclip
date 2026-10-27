// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { AgentOSRoutines } from "./AgentOSRoutines";
const api = vi.hoisted(() => ({ list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue({ triggers: [] }), create: vi.fn().mockResolvedValue({ id: "loop" }), createTrigger: vi.fn().mockResolvedValue({}), run: vi.fn() }));
vi.mock("@/api/routines", () => ({ routinesApi: api }));
vi.mock("@/api/projects", () => ({ projectsApi: { list: () => Promise.resolve([{ id: "campaign", name: "Launch campaign" }]) } }));
vi.mock("@/lib/router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
it("creates a scoped, paused operating loop without dispatching work", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  async function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
    await act(async () => { const prototype = element.tagName === "INPUT" ? HTMLInputElement.prototype : element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
  }
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AgentOSRoutines companyId="company" projectId="campaign" agents={[{ id: "lead", name: "Marketing lead", status: "idle" } as never]} onAsk={vi.fn()} /></QueryClientProvider>));
    expect(api.list).toHaveBeenCalledWith("company", { projectId: "campaign" });
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Create loop")!.click());
    await change(host.querySelector("form input")!, "Campaign feedback");
    await change(host.querySelector("form textarea")!, "Measure results, propose an improved version, request publication approval.");
    await change(host.querySelector("select[required]")!, "lead");
    await change(host.querySelectorAll("select")[2], "0 9 * * *");
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(api.create).toHaveBeenCalledWith("company", expect.objectContaining({ projectId: "campaign", title: "Campaign feedback", assigneeAgentId: "lead", status: "paused", concurrencyPolicy: "coalesce_if_active" }));
    expect(api.createTrigger).toHaveBeenCalledWith("loop", expect.objectContaining({ kind: "schedule", cronExpression: "0 9 * * *", enabled: true }));
    expect(api.run).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
