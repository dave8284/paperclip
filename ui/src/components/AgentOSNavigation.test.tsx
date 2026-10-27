// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Company } from "@paperclipai/shared";
import { expect, it, vi } from "vitest";
import { AgentOSSidebar } from "./AgentOSNavigation";
vi.mock("./AgentOSBrand", () => ({ AgentOSBrand: () => null }));
vi.mock("./AgentOSAccountMenu", () => ({ AgentOSAccountMenu: () => null }));
vi.mock("@/api/projects", () => ({ projectsApi: { list: (companyId: string) => Promise.resolve([{ id: `${companyId}-project`, name: `${companyId} project` }]) } }));
vi.mock("@/api/departments", () => ({ departmentKey: (id: string) => ["departments", id], departmentsApi: { list: (companyId: string) => Promise.resolve([{ id: `${companyId}-department`, name: `${companyId} department`, projectIds: [`${companyId}-project`] }]) } }));
it("keeps Departments above Projects, Settings below Saved displays and the hierarchy within the selected company", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), navigate = vi.fn();
  const companies = [{ id: "one", name: "First venture" }, { id: "two", name: "Second venture" }] as Company[];
  const render = (companyId: string) => root.render(<QueryClientProvider client={client}><AgentOSSidebar companies={companies} view={{ panel: "team", companyId }} navigate={navigate} /></QueryClientProvider>);
  try {
    await act(async () => render("one"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    const workspace = [...host.querySelectorAll('nav[aria-label="Workspace"] button')].map(button => button.textContent);
    expect(workspace.indexOf("Departments")).toBeLessThan(workspace.indexOf("Projects"));
    const footer = [...host.querySelectorAll('nav[aria-label="People, history and settings"] button')].map(button => button.textContent);
    expect(footer.slice(-2)).toEqual(["Saved displays", "Settings"]);
    expect(host.textContent).not.toContain("Departments & projects");
    expect(host.textContent).not.toContain("Delete company");
    expect(host.textContent).toContain("one department");
    expect(host.textContent).not.toContain("two department");
    await act(async () => render("two"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(host.textContent).toContain("two department");
    expect(host.textContent).not.toContain("one department");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "two project")!.click());
    expect(navigate).toHaveBeenLastCalledWith({ panel: "work", companyId: "two", departmentId: "two-department", projectId: "two-project", mode: "combined" });
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Settings")!.click());
    expect(navigate).toHaveBeenLastCalledWith({ panel: "settings", companyId: "two" });
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
