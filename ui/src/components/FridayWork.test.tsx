// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { FridayWork } from "./FridayWork";
vi.mock("./ApplicationTaskInspector", () => ({ ApplicationTaskInspector: ({ task }: { task: { title: string } }) => <article>{task.title} · full task context</article> }));
vi.mock("./AgentOSDelete", () => ({ AgentOSDelete: () => null }));
vi.mock("@/api/friday", () => ({ fridayKey: (company: string) => ["friday", company], fridayApi: { work: () => Promise.resolve({ tasks: [], projects: [], evidence: [], assignments: [], handoffs: [] }) } }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: () => Promise.resolve([]) } }));
vi.mock("@/api/heartbeats", () => ({ heartbeatsApi: { liveRunsForCompany: () => Promise.resolve([]) } }));
it("opens task details in place of the map and returns to the same map scope", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.issues.detail("task"), { id: "task", companyId: "company", projectId: "project", title: "Review campaign results" });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), navigate = vi.fn();
  const view = { panel: "work" as const, mode: "graph" as const, projectId: "project", taskId: "task" };
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><FridayWork companyId="company" agents={[]} view={view} navigate={navigate} onAsk={vi.fn()} /></QueryClientProvider>));
    expect(host.querySelector('[aria-label="Task details"]')?.textContent).toContain("Review campaign results · full task context");
    expect(host.querySelector("svg.friday-work-graph")).toBeNull();
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Back to Agent Map")!.click());
    expect(navigate).toHaveBeenCalledWith({ ...view, taskId: undefined });
    await act(async () => root.render(<QueryClientProvider client={client}><FridayWork companyId="other-company" agents={[]} view={view} navigate={navigate} onAsk={vi.fn()} /></QueryClientProvider>));
    expect(host.textContent).not.toContain("full task context");
    expect(host.textContent).toContain("not available in this workspace");
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
it("shows only related employees in a project map but includes available staff in the company overview", async () => {
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const data = { applications: [], tasks: [], projects: [{ id: "project", name: "Campaign", leadAgentId: "related", status: "in_progress" }], evidence: [], assignments: [], handoffs: [], counts: {}, projectCount: 1, totalCount: 0 };
  client.setQueryData(queryKeys.agents.list("company"), [{ id: "related", name: "Project lead", companyId: "company", role: "product" }, { id: "other", name: "Unrelated colleague", companyId: "company", role: "engineer" }]);
  for (const projectId of ["project", undefined]) client.setQueryData(["friday", "company", "work", { projectId, offset: 0, projectOffset: 0, status: "all" }], data);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    const render = async (projectId?: string) => act(async () => root.render(<QueryClientProvider client={client}><FridayWork companyId="company" agents={[]} view={{ panel: "work", mode: "graph", projectId }} navigate={vi.fn()} onAsk={vi.fn()} /></QueryClientProvider>));
    await render("project");
    expect(host.querySelectorAll('g[data-kind="agent"]')).toHaveLength(1);
    expect(host.querySelector('g[data-kind="agent"]')?.textContent).toContain("Project lead");
    await render();
    expect(host.querySelectorAll('g[data-kind="agent"]')).toHaveLength(2);
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); canvas.mockRestore(); }
});
