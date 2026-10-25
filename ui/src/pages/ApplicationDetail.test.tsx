// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationDetail } from "./ApplicationDetail";

const mocks = vi.hoisted(() => ({ work: vi.fn(), breadcrumbs: vi.fn(), navigate: vi.fn() }));
vi.mock("../api/managed-applications", () => ({ managedApplicationsApi: { work: mocks.work } }));
vi.mock("../api/projects", () => ({ projectsApi: { list: async () => [] } }));
vi.mock("../api/agents", () => ({ agentsApi: { list: async () => [
  { id: "engineer", name: "Engineer", status: "idle", role: "engineer" },
  { id: "marketer", name: "Marketer", status: "idle", role: "cmo" },
] } }));
vi.mock("../api/heartbeats", () => ({ heartbeatsApi: { liveRunsForCompany: async () => [] } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company" }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mocks.breadcrumbs }) }));
vi.mock("../hooks/useApplicationUpdates", () => ({ useApplicationUpdates: () => {}, applicationQueryKey: (id: string) => ["managedApplications", id] }));
vi.mock("../lib/router", () => ({ useNavigate: () => mocks.navigate, useParams: () => ({ applicationId: "application" }), Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a> }));
vi.mock("../components/ApplicationWorkMap", () => ({ ApplicationWorkMap: () => <div>Work map</div> }));

describe("application agent drill-down", () => {
  let host: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.work.mockImplementation(async (_company, _id, _offset, _project, agentId) => ({
      application: { id: "application", name: "Product", source: "existing", stage: "building", brief: "Operate the product", homeProjectId: "home" },
      projects: [{ id: "home", name: "Home", status: "in_progress", leadAgentId: null }],
      tasks: [{ id: "task", identifier: "APP-1", title: agentId ? "Assigned task" : "Operator review", status: "todo", assigneeAgentId: agentId ?? null, assigneeUserId: agentId ? null : "owner", projectId: "home" }],
      counts: agentId ? { todo: 1 } : { todo: 101 },
      agentWork: [{ agentId: "engineer", taskCounts: { done: 50 } }, { agentId: "marketer", taskCounts: { todo: 1 } }],
      nextOffset: agentId ? null : 100,
    }));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
  async function render() {
    await act(async () => root.render(<QueryClientProvider client={client}><ApplicationDetail /></QueryClientProvider>));
    await vi.waitFor(() => expect(host.textContent).toContain("Team on this work"));
  }
  async function click(text: string) {
    await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === text)!.click());
  }

  it("keeps off-page assignees visible and resets pagination when opening their work", async () => {
    await render();
    expect(host.textContent).toContain("50 completed");
    expect(host.querySelector('a[href="/agents/marketer"]')).not.toBeNull();
    await click("Next");
    await vi.waitFor(() => expect(mocks.work).toHaveBeenLastCalledWith("company", "application", 100, undefined, undefined));
    await vi.waitFor(() => expect(host.querySelector('a[href="/agents/marketer"]')).not.toBeNull());
    await act(async () => {
      const link = host.querySelector('a[href="/agents/marketer"]')!;
      link.parentElement!.parentElement!.querySelector("button")!.click();
    });
    await vi.waitFor(() => expect(mocks.work).toHaveBeenLastCalledWith("company", "application", 0, undefined, "marketer"));
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Filter by agent"]')).not.toBeNull());
    expect((host.querySelector('[aria-label="Filter by agent"]') as HTMLSelectElement).value).toBe("marketer");
    expect(host.querySelector('a[href="/agents/engineer"]')).not.toBeNull();
  });

  it("shows operator ownership instead of labelling human-assigned tasks unassigned", async () => {
    await render();
    await click("Kanban");
    const task = host.querySelector('a[href="/issues/APP-1"]')!;
    expect(task.parentElement!.textContent).toContain("Operator");
    expect(task.parentElement!.textContent).not.toContain("Unassigned");
  });
});
