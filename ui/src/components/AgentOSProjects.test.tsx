// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { AgentOSProjects } from "./AgentOSProjects";
const assign = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@/api/projects", () => ({ projectsApi: { list: () => Promise.resolve([{ id: "launch", name: "Launch campaign", status: "in_progress", taskCount: 3 }, { id: "app", name: "Application build", status: "planned" }]) } }));
vi.mock("@/api/departments", () => ({ departmentKey: (id: string) => ["departments", id], departmentsApi: { list: () => Promise.resolve([{ id: "marketing", name: "Marketing", revision: 1, projectIds: ["launch"] }]), assign } }));
it("shows a department's projects and uses native memberships when regrouping", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), navigate = vi.fn();
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AgentOSProjects companyId="company" view={{ panel: "projects", departmentId: "marketing" }} navigate={navigate} onCreate={vi.fn()} /></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(host.textContent).toContain("Launch campaign"); expect(host.textContent).not.toContain("Application build");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Launch campaign"))!.click());
    expect(navigate).toHaveBeenCalledWith({ panel: "work", companyId: "company", projectId: "launch", mode: "combined" });
    await act(async () => { const select = host.querySelector("select")!; select.value = ""; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(assign).toHaveBeenCalledWith("company", "launch", null);
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
