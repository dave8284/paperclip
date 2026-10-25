// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortfolioGalaxy } from "./PortfolioGalaxy";
const mocks = vi.hoisted(() => ({ galaxy: vi.fn(), work: vi.fn(), agents: vi.fn(), runs: vi.fn() }));
vi.mock("../api/managed-applications", () => ({ managedApplicationsApi: { galaxy: mocks.galaxy, work: mocks.work } }));
vi.mock("../api/agents", () => ({ agentsApi: { list: mocks.agents } }));
vi.mock("../api/heartbeats", () => ({ heartbeatsApi: { liveRunsForCompany: mocks.runs } }));
vi.mock("../hooks/useApplicationUpdates", () => ({ useApplicationUpdates: () => {}, applicationQueryKey: (id: string) => ["managedApplications", id] }));
vi.mock("../lib/router", () => ({ Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a> }));
vi.mock("./ApplicationTaskInspector", () => ({ ApplicationTaskInspector: ({ task }: { task: { title: string } }) => <div>Inspecting {task.title}</div> }));
describe("portfolio galaxy evidence and navigation", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  const application = { id: "app", name: "Product", kind: "application" };
  const project = { id: "project", name: "Release", status: "in_progress", leadAgentId: "agent", applicationId: "app" };
  const tasks = [{ id: "task", title: "Verify release", status: "in_progress", applicationId: "app", projectId: "project", assigneeAgentId: "agent" }];
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.galaxy.mockResolvedValue({ applications: [application], summaries: { app: { taskCounts: { in_progress: 1 }, agentCount: 1, projectCount: 1 } }, projects: [project], tasks, tasksTruncated: false, nextCursor: null, observedAt: "2026-10-25T02:00:00Z" });
    mocks.work.mockResolvedValue({ application, projects: [project], tasks, counts: { in_progress: 1 }, agentWork: [{ agentId: "agent", taskCounts: { in_progress: 1 } }], nextOffset: null });
    mocks.agents.mockResolvedValue([{ id: "agent", name: "Project lead", status: "idle" }]);
    mocks.runs.mockResolvedValue([]);
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
  async function open() { await act(async () => root.render(<QueryClientProvider client={client}><PortfolioGalaxy companyId="company" /></QueryClientProvider>)); await vi.waitFor(() => expect(host.querySelectorAll(".agentos-map-task")).toHaveLength(1)); }
  async function click(selector: string) { await act(async () => host.querySelector(selector)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); }
  it("renders one dot per task and pulses only when a run is actually observed", async () => {
    await open(); expect(host.querySelector(".agentos-map-task")?.getAttribute("data-running")).toBe("false");
    const before = host.querySelector(".agentos-map-task")!.getAttribute("cx");
    mocks.runs.mockResolvedValue([{ id: "run", issueId: "task", agentId: "agent", status: "running" }]);
    await act(async () => { await client.invalidateQueries(); });
    await vi.waitFor(() => expect(host.querySelector(".agentos-map-task")?.getAttribute("data-running")).toBe("true"));
    expect(host.querySelector(".agentos-map-task")!.getAttribute("cx")).toBe(before);
    await click('a[aria-label="Verify release: in_progress"]'); expect(host.textContent).toContain("Inspecting Verify release");
  });
  it("zooms into an application and agent using native work queries, then hides revoked data", async () => {
    await open(); await click('a[aria-label="Focus Product"]');
    await vi.waitFor(() => expect(host.querySelector('a[aria-label="Focus agent Project lead"]')).not.toBeNull());
    await click('a[aria-label="Focus agent Project lead"]');
    await vi.waitFor(() => expect(mocks.work).toHaveBeenLastCalledWith("company", "app", 0, undefined, "agent"));
    mocks.work.mockRejectedValue(new Error("Project access removed"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["managedApplications", "company", "app"] }); });
    await vi.waitFor(() => expect(host.textContent).toContain("Project access removed"));
    expect(host.querySelectorAll(".agentos-map-task")).toHaveLength(0);
  });
  it("makes overview truncation explicit instead of fabricating missing dots", async () => {
    const value = await mocks.galaxy(); mocks.galaxy.mockResolvedValue({ ...value, tasksTruncated: true, summaries: { app: { taskCounts: { todo: 800 } } } });
    await open(); expect(host.textContent).toContain("capped at 500"); expect(host.textContent).toContain("800 saved task associations");
    expect(host.querySelectorAll(".agentos-map-task")).toHaveLength(1);
  });
});
