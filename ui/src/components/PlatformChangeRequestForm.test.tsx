// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { PlatformChangeRequestForm } from "./PlatformChangeRequestForm";

const mocks = vi.hoisted(() => ({ access: vi.fn(), companies: vi.fn(), applications: vi.fn(), workspaces: vi.fn(), employees: vi.fn(), source: vi.fn(), request: vi.fn() }));
vi.mock("../api/platform-changes", async importOriginal => ({ ...await importOriginal<typeof import("../api/platform-changes")>(), platformChangesApi: mocks }));
vi.mock("../lib/router", () => ({ Link: ({ to, children }: any) => <a href={to}>{children}</a> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const candidate = { companyId: "business", source: { kind: "document" as const, issueId: "private-task", documentId: "private-doc", revisionId: "chosen-revision" } };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ source: "session", userId: "owner", isInstanceAdmin: true, companyIds: ["business", "platform", "other"] });
  mocks.companies.mockResolvedValue([{ id: "platform", name: "Platform Operations", issuePrefix: "ENG", status: "active" }, { id: "other", name: "Other company", issuePrefix: "OTHER", status: "active" }]);
  mocks.applications.mockResolvedValue({ applications: [{ id: "app", name: "AgentOS", kind: "platform", stage: "building", homeProjectId: "project" }] });
  mocks.workspaces.mockResolvedValue([{ id: "repo", name: "Platform fork", repoUrl: "https://example.test/platform.git" }]);
  mocks.employees.mockResolvedValue([{ id: "lead", name: "Lead", status: "idle", lifecycleState: "ready" }, { id: "reviewer", name: "Reviewer", status: "idle", lifecycleState: "ready" }]);
  mocks.source.mockResolvedValue({ text: "Reusable table\nPRIVATE BUSINESS DETAIL", sha256: "a".repeat(64) });
  mocks.request.mockResolvedValue({ created: true, task: { id: "task", identifier: "ENG-1", status: "backlog" }, request: { documentId: "doc", revisionId: "revision", sha256: "hash" } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><PlatformChangeRequestForm companyId="business" userId="owner" publicationCandidate={candidate} /></QueryClientProvider>)); await settle(); }
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
  await click("Publish component for reuse"); await change("Selected text to publish", "Reusable table only");
  await change("Destination company", "platform"); await change("Internal platform", "app"); await change("Repository", "repo");
  await change("Implementation lead", "lead"); await change("Independent reviewer", "reviewer");
  await change("Change title", "Reuse table"); await change("Requested outcome and scope", "Implement reusable table and obtain independent review.");
}
it("publishes only explicitly edited text to the selected native destination without automatically submitting", async () => {
  await render(); expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.companies).not.toHaveBeenCalled();
  await fill(); expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.applications).toHaveBeenCalledWith("platform", expect.any(AbortSignal));
  await click("Publish copy and prepare task");
  expect(mocks.request).toHaveBeenCalledWith("platform", expect.objectContaining({ publication: { sourceCompanyId: "business", source: candidate.source, expectedSourceSha256: "a".repeat(64), selectedText: "Reusable table only" }, leadAgentId: "lead", reviewerAgentId: "reviewer" }));
  expect(JSON.stringify(mocks.request.mock.calls)).not.toContain("PRIVATE BUSINESS DETAIL");
  expect(host.textContent).toContain("Published the selected text");
  expect(host.querySelector('a[href="/ENG/issues/ENG-1"]')).not.toBeNull();
});
it("reuses the request key for an unchanged retry and allocates a new key after edited content", async () => {
  mocks.request.mockRejectedValue(new Error("Connection interrupted"));
  await render(); await fill(); await click("Publish copy and prepare task"); await click("Publish copy and prepare task");
  expect(mocks.request.mock.calls[0][1]).toEqual(mocks.request.mock.calls[1][1]);
  await change("Selected text to publish", "A different reusable table"); await click("Publish copy and prepare task");
  expect(mocks.request.mock.calls[2][1].requestKey).not.toBe(mocks.request.mock.calls[0][1].requestKey);
});
it("withholds stale source text and submission after a failed source refresh", async () => {
  await render(); await fill(); mocks.source.mockRejectedValue(new Error("Source access revoked"));
  await act(async () => { await client.invalidateQueries({ predicate: query => query.queryKey.includes("publication-source") }); }); await settle();
  expect(host.querySelector('[aria-label="Selected text to publish"]')).toBeNull();
  expect(host.textContent).toContain("Source access revoked");
  expect((host.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.request).not.toHaveBeenCalled();
});
it("clears destination employee/repository selection and suppresses cached inventories on failure", async () => {
  await render(); await fill(); await change("Destination company", "other");
  expect((host.querySelector('[aria-label="Implementation lead"]') as HTMLSelectElement).value).toBe("");
  expect((host.querySelector('[aria-label="Repository"]') as HTMLSelectElement).value).toBe("");
  mocks.companies.mockRejectedValue(new Error("Company access revoked"));
  await act(async () => { await client.invalidateQueries({ predicate: query => query.queryKey.includes("destinations") }); }); await settle();
  expect(host.textContent).not.toContain("Platform Operations");
  expect((host.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
});
it("removes private text and all publication actions after a denied mutation", async () => {
  mocks.request.mockRejectedValue(new ApiError("Source permission changed", 403, {}));
  await render(); await fill(); await click("Publish copy and prepare task");
  expect(host.querySelector("textarea")).toBeNull(); expect(host.textContent).toContain("Check access again");
  expect(host.textContent).not.toContain("Reusable table only");
});
it("keeps an ambiguous committed request's key through an access recheck and unchanged resubmission", async () => {
  mocks.request.mockRejectedValueOnce(new Error("Response lost after commit"));
  await render(); await fill(); await click("Publish copy and prepare task");
  const submitted = mocks.request.mock.calls[0][1];
  mocks.access.mockRejectedValueOnce(new Error("Access lookup interrupted"));
  await act(async () => { await client.invalidateQueries({ predicate: query => query.queryKey.includes("access") }); }); await settle();
  expect(host.querySelector("textarea")).toBeNull();
  await click("Check access again");
  expect((host.querySelector('[aria-label="Selected text to publish"]') as HTMLTextAreaElement).value).toBe("Reusable table only");
  await click("Publish copy and prepare task");
  expect(mocks.request.mock.calls[1][1]).toEqual(submitted);
});
it("rejects multibyte text beyond the byte bound before a mutation", async () => {
  await render(); await fill(); await change("Selected text to publish", "é".repeat(32_769));
  expect((host.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.request).not.toHaveBeenCalled();
});
