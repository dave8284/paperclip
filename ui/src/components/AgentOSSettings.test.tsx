// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { AgentOSSettings } from "./AgentOSSettings";
const { get, update } = vi.hoisted(() => ({
  get: vi.fn().mockImplementation((id: string) => Promise.resolve({ id, name: id === "selected-company" ? "Selected venture" : "Second venture", description: "Its purpose", requireBoardApprovalForNewAgents: true })),
  update: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/api/companies", () => ({ companiesApi: { get, update } }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
vi.mock("./AgentOSConnectors", () => ({ AgentOSConnectors: ({ companyId }: { companyId: string }) => <p>Connections for {companyId}</p> }));
vi.mock("./AgentOSVoiceSettings", () => ({ AgentOSVoiceSettings: () => <p>Voice preferences</p> }));
vi.mock("./AgentOSDelete", () => ({ AgentOSDelete: ({ id, name }: { id: string; name: string }) => <button data-company={id}>Delete {name}</button> }));
it("holds company profile, hiring approval and deletion in Company settings while keeping voice and connectors separate", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const button = (name: string) => [...host.querySelectorAll("button")].find(button => button.textContent === name)!;
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AgentOSSettings companyId="selected-company" /></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(get).toHaveBeenCalledWith("selected-company");
    expect(host.querySelector('input:not([type="checkbox"])')?.getAttribute("value")).toBe("Selected venture");
    expect(button("Delete Selected venture").dataset.company).toBe("selected-company");
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledWith("selected-company", { name: "Selected venture", description: "Its purpose", requireBoardApprovalForNewAgents: false });
    await act(async () => button("Voice").click());
    expect(host.textContent).toContain("Voice preferences");
    expect(host.textContent).not.toContain("Delete Selected venture");
    await act(async () => button("Connectors").click());
    expect(host.textContent).toContain("Connections for selected-company");
    expect(host.textContent).not.toContain("Delete Selected venture");
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
it("resets company form data and deletion target when the selected company changes", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const render = (companyId: string) => root.render(<QueryClientProvider client={client}><AgentOSSettings companyId={companyId} /></QueryClientProvider>);
  try {
    await act(async () => render("selected-company"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(host.querySelector<HTMLInputElement>('input:not([type="checkbox"])')?.value).toBe("Selected venture");
    await act(async () => render("second-company"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(host.querySelector<HTMLInputElement>('input:not([type="checkbox"])')?.value).toBe("Second venture");
    expect(host.textContent).not.toContain("Selected venture");
    expect(host.querySelector<HTMLButtonElement>("button[data-company]")?.dataset.company).toBe("second-company");
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenLastCalledWith("second-company", { name: "Second venture", description: "Its purpose", requireBoardApprovalForNewAgents: true });
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
