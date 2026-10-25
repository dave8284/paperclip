// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Applications } from "./Applications";

const mocks = vi.hoisted(() => ({ project: vi.fn(), create: vi.fn(), list: vi.fn(), navigate: vi.fn(), breadcrumbs: vi.fn() }));
vi.mock("../api/projects", () => ({ projectsApi: { create: mocks.project } }));
vi.mock("../api/managed-applications", () => ({ managedApplicationsApi: { create: mocks.create, list: mocks.list } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company" }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mocks.breadcrumbs }) }));
vi.mock("../hooks/useApplicationUpdates", () => ({ useApplicationUpdates: () => {}, applicationQueryKey: (id: string) => ["managedApplications", id] }));
vi.mock("../lib/router", () => ({ useNavigate: () => mocks.navigate, Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a> }));

describe("application registration recovery", () => {
  let host: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  const draft = { key: "34c84079-ee3b-48f1-acbd-c356a15e5321", name: "Existing product", brief: "Preserve work in flight", source: "existing", repositoryUrl: "https://github.com/example/product" };
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    sessionStorage.setItem("agentos:application-draft:company", JSON.stringify(draft));
    mocks.list.mockResolvedValue({ applications: [], summaries: {}, nextCursor: null });
    mocks.create.mockResolvedValue({ id: "application" });
    host = document.createElement("div");
    document.body.appendChild(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
  async function open() {
    await act(async () => root.render(<QueryClientProvider client={client}><Applications /></QueryClientProvider>));
    await act(async () => { Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes("Add application"))!.click(); });
  }
  async function submit() {
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  }
  async function reload() {
    await act(async () => root.unmount());
    root = createRoot(host);
    await open();
  }

  it("replays the same project intent after a lost response and reload", async () => {
    mocks.project.mockRejectedValueOnce(new Error("Connection lost after submission")).mockResolvedValue({ id: "home" });
    await open();
    await submit();
    await vi.waitFor(() => expect(host.textContent).toContain("Connection lost"));
    await reload();
    expect(host.querySelector("fieldset")!.disabled).toBe(true);
    await submit();
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/applications/application"));
    expect(mocks.project.mock.calls[0]).toEqual(mocks.project.mock.calls[1]);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("agentos:application-draft:company")).toBeNull();
  });

  it("resumes registration with the saved home project after a partial failure", async () => {
    mocks.project.mockResolvedValue({ id: "saved-home" });
    mocks.create.mockRejectedValueOnce(new Error("Temporary registry outage")).mockResolvedValue({ id: "application" });
    await open();
    await submit();
    await vi.waitFor(() => expect(host.textContent).toContain("Temporary registry outage"));
    await reload();
    await submit();
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.project).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]).toEqual(mocks.create.mock.calls[1]);
    expect(mocks.create.mock.calls[1][1].homeProjectId).toBe("saved-home");
  });
});
