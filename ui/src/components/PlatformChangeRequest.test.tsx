// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformChangeRequest } from "./PlatformChangeRequest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), apps: vi.fn(), workspaces: vi.fn(), agents: vi.fn(), post: vi.fn(), userId: "owner", settled: true }));
vi.mock("../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: mocks.userId, settled: mocks.settled, failed: !mocks.settled }) }));
vi.mock("../api/platform-changes", async importOriginal => ({ ...await importOriginal<typeof import("../api/platform-changes")>(), platformChangesApi: { access: mocks.access, applications: mocks.apps, workspaces: mocks.workspaces, employees: mocks.agents, request: mocks.post } }));
vi.mock("../lib/router", () => ({ Link: ({ to, children }: any) => <a href={to}>{children}</a> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const source = { kind: "document" as const, issueId: "source-task", documentId: "source-doc", revisionId: "selected-revision" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.userId = "owner"; mocks.settled = true;
  mocks.access.mockImplementation(async () => ({ source: "session", userId: mocks.userId, isInstanceAdmin: true, companyIds: ["company", "other-company"] }));
  mocks.apps.mockResolvedValue({ applications: [{ id: "platform", name: "AgentOS", kind: "platform", stage: "building", homeProjectId: "project" }] });
  mocks.workspaces.mockResolvedValue([{ id: "repository", name: "Platform fork", repoUrl: "https://example.test/platform.git" }]);
  mocks.agents.mockResolvedValue([{ id: "lead", name: "Lead", status: "idle", lifecycleState: "ready" }, { id: "reviewer", name: "Reviewer", status: "idle", lifecycleState: "ready" }]);
  mocks.post.mockResolvedValue({ created: true, task: { id: "task", identifier: "ENG-1", status: "backlog" }, request: { documentId: "doc", revisionId: "revision", sha256: "hash" } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
async function render(companyId = "company", selectedSource = source) { await act(async () => root.render(<QueryClientProvider client={client}><PlatformChangeRequest companyId={companyId} source={selectedSource} /></QueryClientProvider>)); await settle(); }
async function click(text: string) { await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === text)!.click()); await settle(); }
async function change(label: string, value: string) {
  await act(async () => {
    const field = host.querySelector(`[aria-label="${label}"]`)! as HTMLInputElement;
    const prototype = field.tagName === "SELECT" ? HTMLSelectElement.prototype : field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  }); await settle();
}
async function fill() {
  await click("Request component reuse"); await change("Internal platform", "platform"); await change("Repository", "repository");
  await change("Implementation lead", "lead"); await change("Independent reviewer", "reviewer");
  await change("Change title", "Reuse the component"); await change("Requested outcome and scope", "Prepare implementation and independent review.");
}
it("leaves normal artifact reads lightweight and binds the selected source only after an explicit owner request", async () => {
  await render(); expect(mocks.apps).not.toHaveBeenCalled(); expect(mocks.workspaces).not.toHaveBeenCalled(); expect(mocks.agents).not.toHaveBeenCalled();
  await fill(); await click("Prepare task");
  expect(mocks.post).toHaveBeenCalledWith("company", expect.objectContaining({ source, applicationId: "platform", projectWorkspaceId: "repository", leadAgentId: "lead", reviewerAgentId: "reviewer" }));
  expect(host.textContent).toContain("Prepared a task"); expect(host.querySelector('a[href="/issues/ENG-1"]')).not.toBeNull();
});
it("keeps the idempotency key on a failed request retry and hides stale controls after owner access fails", async () => {
  mocks.post.mockRejectedValueOnce(new Error("Connection interrupted")); await render(); await fill(); await click("Prepare task");
  expect(host.textContent).toContain("Connection interrupted"); const first = mocks.post.mock.calls[0][1];
  await click("Prepare task"); expect(mocks.post.mock.calls[1][1]).toEqual(first);
  mocks.access.mockRejectedValue(new Error("Access revoked")); await act(async () => { await client.invalidateQueries(); }); await settle();
  expect(host.textContent).toContain("Access revoked");
  expect(host.querySelector("form")).toBeNull();
});
it("discards pending form choices on account, company and immutable revision changes", async () => {
  await render(); await fill();
  mocks.userId = "another-owner"; await render();
  expect(host.querySelector("form")).toBeNull(); expect(host.textContent).toContain("Request component reuse");
  await fill(); await render("other-company"); expect(host.querySelector("form")).toBeNull();
  await fill(); await render("other-company", { ...source, revisionId: "another-revision" }); expect(host.querySelector("form")).toBeNull();
  expect(mocks.post).not.toHaveBeenCalled();
});
it("withholds all inventories when account identity cannot be verified", async () => {
  mocks.settled = false; await render(); expect(host.textContent).toBe(""); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.apps).not.toHaveBeenCalled();
});
it("does not expose request controls or inventories to ordinary company members", async () => {
  mocks.access.mockResolvedValue({ source: "session", isInstanceAdmin: false }); await render();
  expect(host.textContent).toBe(""); expect(mocks.apps).not.toHaveBeenCalled(); expect(mocks.agents).not.toHaveBeenCalled();
});
