// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Company } from "@paperclipai/shared";
import { expect, it, vi } from "vitest";
import { departmentKey } from "@/api/departments";
import { queryKeys } from "@/lib/queryKeys";
import { AgentOSSidebar } from "./AgentOSNavigation";

const api = vi.hoisted(() => ({ departments: vi.fn(), projects: vi.fn() }));
vi.mock("./AgentOSBrand", () => ({ AgentOSBrand: () => null }));
vi.mock("./AgentOSAccountMenu", () => ({ AgentOSAccountMenu: () => null }));
vi.mock("@/api/projects", () => ({ projectsApi: { list: api.projects } }));
vi.mock("@/api/departments", () => ({ departmentKey: (id: string) => ["departments", id], departmentsApi: { list: api.departments } }));

const departmentRows = [{ id: "department-one", name: "Private department", projectIds: ["project-one"] }];
const projectRows = [{ id: "project-one", name: "Private project" }];
const cases = [
  { section: "Departments", source: "departments" },
  { section: "Departments", source: "projects" },
  { section: "Projects", source: "departments" },
  { section: "Projects", source: "projects" },
] as const;

it.each(cases)("hides cached $section after a $source read failure and restores navigation only after a successful retry", async ({ section, source }) => {
  api.departments.mockReset().mockResolvedValue(departmentRows);
  api.projects.mockReset().mockResolvedValue(projectRows);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const navigate = vi.fn();
  const companies = [{ id: "company-one", name: "First venture" }] as Company[];
  const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label)!;
  const flush = () => new Promise(resolve => setTimeout(resolve, 10));
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AgentOSSidebar companies={companies} view={{ panel: "work", companyId: "company-one", projectId: "project-one", departmentId: "department-one" }} navigate={navigate} /></QueryClientProvider>));
    await act(async () => { button(section).click(); });
    await act(async () => { await flush(); });
    expect(button("Private project")).toBeDefined();

    const key = source === "departments" ? departmentKey("company-one") : queryKeys.projects.list("company-one");
    api[source].mockRejectedValue(new Error("Access denied"));
    await act(async () => { await client.refetchQueries({ queryKey: key, exact: true }); await flush(); });
    expect(client.getQueryData(key)).toEqual(source === "departments" ? departmentRows : projectRows);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Could not load company structure.");
    expect(host.textContent).not.toContain("Private department");
    expect(host.textContent).not.toContain("Private project");
    expect(host.querySelector(".agentos-tree-project")).toBeNull();

    await act(async () => { button("Retry").click(); await flush(); });
    expect(host.textContent).not.toContain("Private project");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    api[source].mockResolvedValue(source === "departments" ? departmentRows : projectRows);
    await act(async () => { button("Retry").click(); await flush(); });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(button("Private project")).toBeDefined();
    await act(async () => button("Private project").click());
    expect(navigate).toHaveBeenLastCalledWith({ panel: "work", companyId: "company-one", departmentId: "department-one", projectId: "project-one", mode: "combined" });
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
  }
});
