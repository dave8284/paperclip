// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Workforce } from "./Workforce";

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), create: vi.fn(), breadcrumbs: vi.fn(), userId: "owner" }));
vi.mock("../api/workforce", () => ({
  workforceApi: mocks,
  workforceKeys: { account: (id: string) => ["workforce", id], list: (id: string) => ["workforce", id, "list"], detail: (id: string, portfolio: string) => ["workforce", id, portfolio] },
}));
vi.mock("../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: mocks.userId, settled: true, failed: false }) }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "one", companies: [{ id: "one", name: "First venture" }, { id: "two", name: "Second venture" }] }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mocks.breadcrumbs }) }));
vi.mock("../lib/router", () => ({ Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a> }));

describe("portfolio workforce view", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  const portfolio = { id: "portfolio", homeCompanyId: "one", name: "My portfolio", revision: 1 };
  const data = {
    portfolio, canManage: true, observedAt: new Date().toISOString(),
    companies: [{ id: "one", issuePrefix: "ONE", name: "First venture", status: "active", canManage: true }, { id: "two", issuePrefix: "TWO", name: "Second venture", status: "active", canManage: true }],
    employees: [{ id: "employee", name: "Shared engineer", specialty: "Engineering", revision: 1 }],
    assignments: [{ id: "assignment-one", employeeId: "employee", companyId: "one", agentId: "agent-one", agentName: "Engineer A", status: "retired", agentStatus: "terminated", lifecycleState: "terminated", harness: "codex_local", retirementReason: "New approach needed", revision: 2 },
      { id: "assignment-two", employeeId: "employee", companyId: "two", agentId: "agent-two", agentName: "Engineer B", status: "active", agentStatus: "idle", lifecycleState: "ready", harness: "codex_local", revision: 1 }],
  };
  beforeEach(() => {
    vi.clearAllMocks(); mocks.userId = "owner";
    mocks.list.mockResolvedValue([portfolio]); mocks.get.mockResolvedValue(data);
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
  async function render() { await act(async () => root.render(<QueryClientProvider client={client}><Workforce /></QueryClientProvider>)); }
  it("shows one employee across two companies and keeps profile links scoped to the correct company", async () => {
    await render(); await vi.waitFor(() => expect(host.textContent).toContain("Shared engineer"));
    expect(host.textContent).toContain("Retired"); expect(host.textContent).toContain("New approach needed");
    expect(host.querySelector('a[href="/ONE/agents/agent-one"]')).not.toBeNull();
    expect(host.querySelector('a[href="/TWO/agents/agent-two"]')).not.toBeNull();
    expect(host.querySelectorAll("h3")).toHaveLength(1);
    expect(Array.from(host.querySelectorAll("button")).filter(button => button.textContent === "Retire assignment")).toHaveLength(1);
  });
  it("reuses the creation request after a lost response", async () => {
    mocks.list.mockResolvedValue([]);
    mocks.create.mockRejectedValue(new Error("Connection lost after submission"));
    await render(); await vi.waitFor(() => expect(host.querySelector("form")).not.toBeNull());
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(host.textContent).toContain("Connection lost"));
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[0][0]).toEqual(mocks.create.mock.calls[1][0]);
  });
  it("hides mutation controls for a read-only owner and clears the previous account's portfolio", async () => {
    mocks.get.mockResolvedValue({ ...data, canManage: false });
    await render(); await vi.waitFor(() => expect(host.textContent).toContain("Shared engineer"));
    expect(host.textContent).not.toContain("Retire assignment"); expect(host.textContent).not.toContain("Add specialist");
    mocks.userId = "another-owner"; mocks.list.mockResolvedValue([]);
    await render(); await vi.waitFor(() => expect(host.textContent).toContain("Create your portfolio"));
    expect(host.textContent).not.toContain("Shared engineer");
  });
});
