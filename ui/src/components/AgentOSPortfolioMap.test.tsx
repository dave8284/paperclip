// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Company, FridayWork } from "@paperclipai/shared";
import { expect, it, vi } from "vitest";
import { AgentOSPortfolioMap } from "./AgentOSPortfolio";

const api = vi.hoisted(() => ({ work: vi.fn(), agents: vi.fn(), runs: vi.fn() }));
vi.mock("@/api/friday", () => ({ fridayKey: (companyId: string) => ["friday", companyId], fridayApi: { work: api.work } }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: api.agents } }));
vi.mock("@/api/heartbeats", () => ({ heartbeatsApi: { liveRunsForCompany: api.runs } }));

function work(company: string): FridayWork {
  return { observedAt: "2026-11-06T00:00:00Z", projects: [{ id: `${company}-project`, name: `${company} project`, status: "in_progress", leadAgentId: `${company}-agent` }], projectCount: 1, nextProjectOffset: null,
    applications: [], tasks: [{ id: `${company}-task`, identifier: `${company}-1`, projectId: `${company}-project`, title: `${company} task`, status: "done", priority: "medium", assigneeAgentId: `${company}-agent`, assigneeUserId: null, parentId: null, createdByAgentId: null, updatedAt: new Date("2026-11-06T00:00:00Z") }],
    counts: { done: 1 }, nextOffset: null, assignments: [], assignmentsTruncated: false, evidence: [], evidenceTruncated: false, handoffs: [], handoffsTruncated: false,
    dataAccess: { configuredAccess: "available", observedAccess: "available", resources: [{ id: `catalog:${company}`, companyId: company, name: `${company} tool`, kind: "catalog" }],
      permissions: [{ agentId: `${company}-agent`, resourceId: `catalog:${company}` }],
      actions: [{ id: `${company}-action`, taskId: `${company}-task`, agentId: `${company}-agent`, resourceId: `catalog:${company}`, toolName: `${company} tool`, operation: "read", status: "succeeded", completedAt: "2026-11-06T00:00:00Z", observedAt: "2026-11-06T00:00:00Z" }],
      permissionsTruncated: false, actionsTruncated: false } };
}

it("uses the real graph to drill into the source company and task, then removes stale records after a failed access refresh", async () => {
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  api.work.mockImplementation((company: string) => Promise.resolve(work(company)));
  api.agents.mockImplementation((company: string) => Promise.resolve([{ id: `${company}-agent`, companyId: company, name: `${company} employee`, role: "engineer", status: "idle" }]));
  api.runs.mockResolvedValue([{ issueId: "not-on-the-page", status: "running" }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), navigate = vi.fn();
  const companies = [{ id: "blue", name: "Blue company" }, { id: "green", name: "Green company" }] as Company[];
  const flush = () => new Promise(resolve => setTimeout(resolve, 10));
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AgentOSPortfolioMap companies={companies} navigate={navigate} /></QueryClientProvider>));
    await act(async () => { await flush(); });
    expect(api.work).toHaveBeenCalledWith("blue", { limit: 200, dataAccess: "tools" });
    expect(host.querySelectorAll('g[data-kind="task"]')).toHaveLength(2);
    expect(host.querySelectorAll('g[data-kind="action"]')).toHaveLength(2);
    expect(host.querySelectorAll(".agentos-map-completed")).toHaveLength(2);
    expect(host.querySelectorAll('g[data-running="true"]')).toHaveLength(0);
    const openNode = async (kind: string, label: string) => act(async () => [...host.querySelectorAll(`g[data-kind="${kind}"]`)].find(node => node.getAttribute("aria-label")?.includes(label))!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    await openNode("project", "green project");
    expect(navigate).toHaveBeenLastCalledWith({ panel: "work", companyId: "green", mode: "graph", projectId: "green-project" });
    await openNode("agent", "blue employee");
    expect(navigate).toHaveBeenLastCalledWith({ panel: "team", companyId: "blue", mode: "graph", agentId: "blue-agent" });
    await openNode("action", "green tool");
    expect(navigate).toHaveBeenLastCalledWith({ panel: "work", companyId: "green", mode: "graph", taskId: "green-task" });
    navigate.mockClear();
    await openNode("resource", "blue tool");
    expect(navigate).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Selected map record"]')?.textContent).toContain("Profile allows tool");
    expect(host.querySelector('[aria-label="Selected map record"]')?.textContent).toContain("Read tool · succeeded");

    api.work.mockImplementation((company: string) => company === "blue" ? Promise.reject(new Error("Access removed")) : Promise.resolve(work(company)));
    await act(async () => { await client.refetchQueries({ queryKey: ["friday", "blue"] }); await flush(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("This map is incomplete");
    expect(host.querySelectorAll('g[data-kind="task"]')).toHaveLength(1);
    expect(host.querySelectorAll('g[data-kind="action"]')).toHaveLength(1);
    expect(host.textContent).not.toContain("blue tool");
    expect(host.querySelector('[aria-label="Selected map record"]')).toBeNull();
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); canvas.mockRestore(); }
});
