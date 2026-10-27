// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { AgentOSProjects } from "./AgentOSProjects";
const { assign, update, updateProject } = vi.hoisted(() => ({ assign: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}), updateProject: vi.fn().mockResolvedValue({}) }));
vi.mock("@/api/projects", () => ({ projectsApi: { list: () => Promise.resolve([{ id: "launch", name: "Launch campaign", status: "in_progress", taskCount: 3 }, { id: "app", name: "Application build", status: "planned" }]), update: updateProject } }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: () => Promise.resolve([{ id: "lead", companyId: "company", name: "Maya", status: "idle", lifecycleState: "ready" }, { id: "retired", companyId: "company", name: "Retired", status: "terminated", lifecycleState: "ready" }, { id: "foreign", companyId: "other", name: "Other employee", status: "idle", lifecycleState: "ready" }]) } }));
vi.mock("@/api/departments", () => ({ departmentKey: (id: string) => ["departments", id], departmentsApi: { list: () => Promise.resolve([{ id: "marketing", name: "Marketing", revision: 1, leadAgentId: null, projectIds: ["launch"] }]), assign, update } }));
it("shows a department's projects and uses native memberships when regrouping", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), navigate = vi.fn();
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AgentOSProjects companyId="company" view={{ panel: "projects", departmentId: "marketing" }} navigate={navigate} onCreate={vi.fn()} /></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(host.textContent).toContain("Launch campaign"); expect(host.textContent).not.toContain("Application build");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Launch campaign"))!.click());
    expect(navigate).toHaveBeenCalledWith({ panel: "work", companyId: "company", departmentId: "marketing", projectId: "launch", mode: "combined" });
    await act(async () => { const select = host.querySelector("select")!; select.value = ""; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(assign).toHaveBeenCalledWith("company", "launch", null);
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
it("assigns department heads with a revision and project leads through their company-scoped native API", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const render = (panel: "departments" | "projects") => root.render(<QueryClientProvider client={client}><AgentOSProjects companyId="company" view={{ panel }} navigate={vi.fn()} onCreate={vi.fn()} /></QueryClientProvider>);
  try {
    await act(async () => render("departments"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Edit department")!.click());
    expect(host.querySelector("select")?.textContent).toContain("Maya");
    expect(host.querySelector("select")?.textContent).not.toContain("Retired");
    expect(host.querySelector("select")?.textContent).not.toContain("Other employee");
    await act(async () => { const select = host.querySelector("select")!; select.value = "lead"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(update).toHaveBeenCalledWith("company", "marketing", { name: "Marketing", description: "", leadAgentId: "lead", expectedRevision: 1 });
    await act(async () => render("projects"));
    await act(async () => { const select = host.querySelector<HTMLSelectElement>('select[aria-label="Project lead for Launch campaign"]')!; select.value = "lead"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(updateProject).toHaveBeenCalledWith("launch", { leadAgentId: "lead" }, "company");
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
