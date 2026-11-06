// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Company, IssueSummary } from "@paperclipai/shared";
import { FridaySuggestions } from "./FridaySuggestions";
import { queryKeys } from "@/lib/queryKeys";
import { recordRecentTask } from "@/lib/recent-tasks";

const fixture = vi.hoisted(() => ({
  identity: { userId: "owner" as string | null, settled: true, failed: false },
  attention: vi.fn(), work: vi.fn(), summaries: vi.fn(),
}));
vi.mock("@/api/companies-query", () => ({ useAccountIdentity: () => fixture.identity }));
vi.mock("@/api/attention", () => ({ attentionApi: { list: fixture.attention } }));
vi.mock("@/api/friday", () => ({ fridayApi: { work: fixture.work }, fridayKey: (id: string) => ["work", id] }));
vi.mock("@/api/issues", () => ({ issuesApi: { summaries: fixture.summaries } }));

const companies = [{ id: "company-a", name: "Northstar" }, { id: "company-b", name: "Forma" }] as Company[];
function task(id: string, companyId = "company-a", title = id, status: IssueSummary["status"] = "todo"): IssueSummary {
  return { id, companyId, title, identifier: "APP-1", status, updatedAt: new Date(10), externalConversationState: null };
}

describe("Friday activity suggestions", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  const navigate = vi.fn(), onNew = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    fixture.identity = { userId: "owner", settled: true, failed: false };
    fixture.attention.mockResolvedValue({ items: [] });
    fixture.work.mockResolvedValue({ counts: {} });
    fixture.summaries.mockResolvedValue([]);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
  async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
  async function render(scope = companies) {
    await act(async () => root.render(<QueryClientProvider client={client}><FridaySuggestions companies={scope} navigate={navigate} onNew={onNew} /></QueryClientProvider>));
    await settle();
  }
  async function click(label: string) {
    const button = [...host.querySelectorAll("button")].find(item => item.textContent === label);
    expect(button).toBeDefined(); await act(async () => button!.click());
  }

  it("updates decision and work suggestions from current reads and only navigates after a click", async () => {
    fixture.attention.mockImplementation(async (id: string) => ({ items: id === "company-b" ? [{ id: "decision", companyId: id, subject: { title: "Approve the launch" }, project: { id: "project-b" } }] : [] }));
    fixture.work.mockImplementation(async (id: string) => ({ counts: { in_progress: id === "company-b" ? 1 : 0 } }));
    await render();
    expect(navigate).not.toHaveBeenCalled(); expect(onNew).not.toHaveBeenCalled();
    await click("Review: Approve the launch");
    expect(navigate).toHaveBeenLastCalledWith({ panel: "attention", companyId: "company-b", projectId: "project-b", decisionId: "decision" });
    await click("1 task in motion at Forma");
    expect(navigate).toHaveBeenLastCalledWith({ panel: "work", companyId: "company-b", mode: "graph" });
    fixture.attention.mockResolvedValue({ items: [] }); fixture.work.mockResolvedValue({ counts: {} });
    await act(async () => { await client.invalidateQueries(); }); await settle();
    expect(host.textContent).not.toContain("Approve the launch"); expect(host.textContent).not.toContain("in motion");
    await click("What needs me?");
    expect(navigate).toHaveBeenLastCalledWith({ panel: "attention", scope: "portfolio" });
  });

  it("uses personal task activity with current authorized labels and native task navigation", async () => {
    recordRecentTask(task("first", "company-a", "Old cached title"), "owner", 10);
    fixture.summaries.mockImplementation(async (id: string) => id === "company-a" ? [task("first", id, "Prepare launch")] : [task("second", id, "Campaign results", "done")]);
    await render();
    expect(host.textContent).not.toContain("Old cached title");
    await click("Return to: Prepare launch");
    expect(navigate).toHaveBeenLastCalledWith({ panel: "work", companyId: "company-a", taskId: "first", mode: "combined" });
    await act(async () => { recordRecentTask(task("second", "company-b", "Outdated report title"), "owner", 20); }); await settle();
    await click("View completed work: Campaign results");
    expect(navigate).toHaveBeenLastCalledWith({ panel: "work", companyId: "company-b", taskId: "second", mode: "combined" });
    fixture.summaries.mockResolvedValue([]);
    await act(async () => { await client.invalidateQueries({ queryKey: ["issues"] }); }); await settle();
    expect(host.textContent).not.toContain("Return to:"); expect(host.textContent).not.toContain("View completed work:");
    await click("Start something new"); expect(onNew).toHaveBeenCalledOnce();
  });

  it("withholds cached personal titles while checking access and after failure or omission", async () => {
    const saved = task("private", "company-a", "Cached private task");
    recordRecentTask(saved, "owner", 10);
    client.setQueryData(queryKeys.issues.summaryBatch("company-a", "owner", ["private"]), [saved]);
    let reject!: (reason: Error) => void;
    fixture.summaries.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    await render([companies[0]]);
    expect(host.textContent).not.toContain("Cached private task");
    await act(async () => { reject(new Error("Access changed")); }); await settle();
    expect(host.textContent).not.toContain("Cached private task");
    expect(host.textContent).toContain("Some suggestions could not be refreshed");
    fixture.summaries.mockResolvedValue([task("foreign", "company-b", "Wrong company"), task("unrequested", "company-a", "Unrequested task"), { ...saved, status: "cancelled" }]);
    await act(async () => { await client.invalidateQueries({ queryKey: ["issues"] }); }); await settle();
    expect(host.textContent).not.toContain("Wrong company"); expect(host.textContent).not.toContain("Unrequested task");
    expect(host.textContent).not.toContain("Cached private task");
  });

  it("drops a removed company and old account's activity without requesting their IDs again", async () => {
    recordRecentTask(task("old"), "owner", 10);
    recordRecentTask(task("new", "company-b"), "other", 20);
    fixture.summaries.mockImplementation(async (companyId: string, ids: string[]) => ids.map(id => task(id, companyId)));
    await render(); expect(host.textContent).toContain("Return to: old");
    await render([companies[1]]); expect(host.textContent).not.toContain("Return to: old");
    fixture.summaries.mockClear();
    fixture.identity = { userId: "other", settled: false, failed: false };
    await render(); expect(fixture.summaries).not.toHaveBeenCalled(); expect(host.textContent).not.toContain("Return to:");
    fixture.identity = { userId: "other", settled: true, failed: false };
    await render(); expect(host.textContent).toContain("Return to: new");
    expect(fixture.summaries).toHaveBeenCalledExactlyOnceWith("company-b", ["new"], expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("keeps empty-portfolio suggestions useful without fetching unrelated companies", async () => {
    await render([]);
    expect(fixture.work).not.toHaveBeenCalled(); expect(fixture.attention).not.toHaveBeenCalled(); expect(fixture.summaries).not.toHaveBeenCalled();
    await click("Start something new"); expect(onNew).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });
});
