// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyPerformanceResponse } from "@paperclipai/shared";
import { AgentOSPerformance } from "./AgentOSPerformance";
import { queryKeys } from "../lib/queryKeys";
import { departmentKey } from "../api/departments";
const mocks = vi.hoisted(() => ({ get: vi.fn(), projects: vi.fn(), departments: vi.fn() }));
vi.mock("../api/client", () => ({ api: { get: mocks.get } }));
vi.mock("../api/projects", () => ({ projectsApi: { list: mocks.projects } }));
vi.mock("../api/departments", () => ({ departmentsApi: { list: mocks.departments }, departmentKey: (id: string) => ["departments", id] }));
const projectA = "10000000-0000-4000-8000-000000000001", projectB = "10000000-0000-4000-8000-000000000002";
const department = "10000000-0000-4000-8000-000000000003";
const response = (projectId: string | null): CompanyPerformanceResponse => ({ truncated: false, scopeProjectIds: [projectId], reports: [{ id: "report", companyId: "company", projectId, period: "2026-11", currency: "USD", basis: "cash", revision: 1, createdBy: "owner", createdAt: "2026-11-01", sourceLabel: "Private ledger", evidenceRef: "Source file October statement", revenueComplete: true, costsComplete: true, values: { revenueMinor: 10000, costMinor: 4000, views: 123, engagements: 10, publications: 2 } }] });
describe("company performance scope and refresh", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projects.mockResolvedValue([{ id: projectA, name: "Project A" }, { id: projectB, name: "Project B" }]);
    mocks.departments.mockResolvedValue([{ id: department, name: "Department", projectIds: [projectA] }]);
    mocks.get.mockImplementation(async (url: string) => response(new URL(url, "http://local").searchParams.get("scope") === "project" ? new URL(url, "http://local").searchParams.get("scopeId") : null));
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); client.clear(); });
  async function render(props: { companyId?: string; projectId?: string; departmentId?: string } = {}) {
    await act(async () => { root.render(<QueryClientProvider client={client}><AgentOSPerformance companyId="company" onAsk={() => {}} {...props} /></QueryClientProvider>); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
  const metrics = () => host.querySelector(".agentos-performance-metrics")!.textContent;
  it("requests company totals separately and changes project scope when navigation reuses the panel", async () => {
    await render();
    expect(mocks.get.mock.lastCall?.[0]).toContain("scope=company");
    await render({ projectId: projectA });
    expect(mocks.get.mock.lastCall?.[0]).toContain(`scope=project&scopeId=${projectA}`);
    await render({ projectId: projectB });
    expect(mocks.get.mock.lastCall?.[0]).toContain(`scope=project&scopeId=${projectB}`);
    expect(mocks.get.mock.lastCall?.[1].signal).toBeInstanceOf(AbortSignal);
  });
  it("uses the server's department membership including unreported projects", async () => {
    mocks.get.mockResolvedValue({ ...response(projectA), scopeProjectIds: [projectA, projectB] });
    await render({ departmentId: department });
    expect(mocks.get.mock.lastCall?.[0]).toContain(`scope=department&scopeId=${department}`);
    expect(metrics()).not.toContain("123");
    expect(metrics()).toContain("Not reported");
    expect(host.textContent).toContain("Private ledger");
  });
  it.each(["reports", "projects", "departments"])("suppresses cached figures, sources and history after %s access fails", async failing => {
    await render({ projectId: projectA });
    expect(metrics()).toContain("123");
    expect(host.textContent).toContain("Private ledger");
    const failingMock = failing === "reports" ? mocks.get : failing === "projects" ? mocks.projects : mocks.departments;
    failingMock.mockRejectedValue(new Error("Access revoked"));
    const queryKey = failing === "reports" ? ["company-performance", "company"] : failing === "projects" ? queryKeys.projects.list("company") : departmentKey("company");
    await act(async () => { await client.invalidateQueries({ queryKey }); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(host.textContent).toContain("Access revoked");
    expect(host.textContent).not.toContain("Private ledger");
    expect(host.textContent).not.toContain("Source file October statement");
    expect(metrics()).not.toContain("123");
    expect([...host.querySelectorAll("button")].find(button => button.textContent === "Record results")?.disabled).toBe(true);
  });
  it("withholds totals and editing when the selected scope itself exceeds the cap", async () => {
    mocks.get.mockResolvedValue({ ...response(projectA), truncated: true });
    await render({ projectId: projectA });
    expect(metrics()).not.toContain("123");
    expect(host.textContent).toContain("This scope has more than 500");
    expect([...host.querySelectorAll("button")].find(button => button.textContent === "Record new revision")?.disabled).toBe(true);
  });
});
