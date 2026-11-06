// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentosCapabilities, AgentosWorkforce } from "@paperclipai/shared";
import { WorkforceCapabilities } from "./WorkforceCapabilities";

const mocks = vi.hoisted(() => ({ capabilities: vi.fn(), decideCapability: vi.fn(), publishCapability: vi.fn() }));
vi.mock("../api/workforce", () => ({ workforceApi: mocks, workforceKeys: { account: (id: string) => ["workforce", id], detail: (id: string, portfolio: string) => ["workforce", id, portfolio] } }));
vi.mock("../lib/router", () => ({ Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a> }));
const workforce = { portfolio: { id: "portfolio" }, companies: [{ id: "company", name: "Company one", issuePrefix: "ONE", canManage: true }] } as AgentosWorkforce;
const release = { id: "release", employeeId: "employee", capabilityKey: "review", revision: 1, name: "Release review", markdown: "Exact accepted method", evaluationSummary: "Human reviewed this test; limited to release checks", contentHash: "hash", createdAt: new Date().toISOString() };
const base: AgentosCapabilities = { releases: [release], canPublish: true, releaseOffset: 0, hasMoreReleases: false, latestRevisions: { review: 1 },
  assignments: [{ assignmentId: "assignment", companyId: "company", revision: 3, selectionHash: "a".repeat(64), canManage: true, selected: [], previouslyAdoptedReleaseIds: [], decisions: [] }] };

describe("reviewed workforce capabilities", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks(); mocks.capabilities.mockResolvedValue(base);
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
  const button = (label: string) => Array.from(host.querySelectorAll("button")).find(row => row.textContent === label)!;
  async function click(label: string) { await act(async () => button(label).click()); }
  async function render() {
    await act(async () => root.render(<QueryClientProvider client={client}><WorkforceCapabilities userId="owner" employeeId="employee" workforce={workforce} /></QueryClientProvider>));
  }
  async function open() { await render(); await click("Reviewed capabilities"); await vi.waitFor(() => expect(host.textContent).toContain("Release review")); }
  it("loads only when expanded, shows reviewed evidence and supports collapse", async () => {
    await render(); expect(mocks.capabilities).not.toHaveBeenCalled();
    await click("Reviewed capabilities"); await vi.waitFor(() => expect(host.textContent).toContain(release.evaluationSummary));
    expect(host.textContent).toContain(release.markdown);
    await click("Hide capabilities"); expect(host.textContent).not.toContain(release.markdown);
  });
  it("refusal leaves the current-selection statement intact and retries the same exact intent", async () => {
    mocks.capabilities.mockResolvedValue({ ...base, assignments: [{ ...base.assignments[0], selected: [{ capabilityKey: "review", releaseId: "release", versionId: "version" }] }] });
    mocks.decideCapability.mockRejectedValue(new Error("Delivery unknown"));
    await open(); await click("Refuse"); expect(host.textContent).toContain("Selected skills stay unchanged");
    const input = host.querySelector("textarea")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Not appropriate for this company"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(host.textContent).toContain("Delivery unknown"));
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(mocks.decideCapability).toHaveBeenCalledTimes(2));
    expect(mocks.decideCapability.mock.calls[0]).toEqual(mocks.decideCapability.mock.calls[1]);
    expect(mocks.decideCapability.mock.calls[0][2]).toMatchObject({ action: "refuse", releaseId: "release", expectedAssignmentRevision: 3 });
  });
  it("offers rollback for an older adopted release even if its receipt is outside recent history", async () => {
    mocks.capabilities.mockResolvedValue({ ...base, assignments: [{ ...base.assignments[0], previouslyAdoptedReleaseIds: ["release"], decisions: [] }] });
    await open(); expect(button("Roll back to this version")).toBeDefined(); expect(button("Adopt")).toBeUndefined();
  });
  it("keeps owner and company read-only restrictions on action controls", async () => {
    mocks.capabilities.mockResolvedValue({ ...base, canPublish: false, assignments: [{ ...base.assignments[0], canManage: false }] });
    await open(); expect(button("Publish reviewed release")).toBeUndefined(); expect(button("Adopt")).toBeUndefined(); expect(button("Refuse")).toBeUndefined();
  });
  it("hides retained releases and action controls when authorization is lost on refetch", async () => {
    await open(); expect(host.textContent).toContain(release.markdown);
    mocks.capabilities.mockRejectedValue(new Error("Portfolio access revoked"));
    await act(async () => { await client.invalidateQueries(); });
    await vi.waitFor(() => expect(host.textContent).toContain("Portfolio access revoked"));
    expect(host.textContent).not.toContain(release.markdown);
    expect(button("Publish reviewed release")).toBeUndefined(); expect(button("Adopt")).toBeUndefined();
  });
  it("pages older releases and explains that active selections remain visible", async () => {
    mocks.capabilities.mockResolvedValue({ ...base, hasMoreReleases: true });
    await open(); expect(host.textContent).toContain("selected versions always included");
    await click("Older releases"); await vi.waitFor(() => expect(mocks.capabilities.mock.calls.some(call => call[3] === 100)).toBe(true));
  });
});
