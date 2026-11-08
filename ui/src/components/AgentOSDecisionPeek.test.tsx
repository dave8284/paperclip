// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AttentionFeed, AttentionItem, Company } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentOSDecisionPeek } from "./AgentOSPortfolio";
import { queryKeys } from "@/lib/queryKeys";

const list = vi.hoisted(() => vi.fn());
vi.mock("@/api/attention", () => ({ attentionApi: { list } }));

const companies = [{ id: "first", name: "First company" }, { id: "later", name: "Later company" }] as Company[];
function item(companyId: string, id: string, overrides: Partial<AttentionItem> = {}): AttentionItem {
  return { id, companyId, sourceKind: "approval", subject: { kind: "approval", id, title: id },
    whyNow: "Recorded native proposal", inlineResolvable: true, decisionVerbs: [],
    project: null, relatedIssue: null, detail: null, severity: "low", rank: 1, dedupKey: `approval:${id}`,
    decideBy: null, expiresAt: null, activityAt: "2026-11-08T10:00:00Z", ...overrides } as AttentionItem;
}
const feed = (rows: AttentionItem[]): AttentionFeed => ({ items: rows, totalCount: rows.length, nextCursor: null,
  generatedAt: "2026-11-08T12:00:00Z" } as AttentionFeed);

describe("portfolio attention preview", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  const navigate = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-08T12:00:00Z"));
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); });
  async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
  async function render(selected = companies) {
    await act(async () => root.render(<QueryClientProvider client={client}><AgentOSDecisionPeek companies={selected} navigate={navigate} /></QueryClientProvider>));
    await flush();
  }
  const titles = () => [...host.querySelectorAll(".agentos-decision-cards strong")].map(node => node.textContent);

  it("surfaces another company's deadline and critical blocker before the first company's low-priority records", async () => {
    const ordinary = [1, 2, 3].map(n => item("first", `ordinary-${n}`));
    const urgent = [item("later", "overdue", { decideBy: "2026-11-07" }),
      item("later", "critical-blocker", { sourceKind: "blocker_attention", severity: "critical", inlineResolvable: false,
        subject: { kind: "issue", id: "blocked-task", companyId: "later", title: "critical-blocker", identifier: "LATER-1", status: "blocked", href: "/issues/blocked-task" },
        project: { id: "later-project", name: "Later project", urlKey: "later-project", color: null, icon: null } })];
    list.mockImplementation((companyId: string) => Promise.resolve(feed(companyId === "first" ? ordinary : urgent)));
    await render();
    expect(titles()).toEqual(["overdue", "critical-blocker", "ordinary-1"]);
    expect(list).toHaveBeenCalledWith("first", { limit: 3, sort: "decide" });
    expect(list).toHaveBeenCalledWith("later", { limit: 3, sort: "decide" });
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".agentos-decision-cards button")[0].click());
    expect(navigate).toHaveBeenLastCalledWith({ panel: "attention", companyId: "later", projectId: undefined, decisionId: "overdue" });
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".agentos-decision-cards button")[1].click());
    expect(navigate).toHaveBeenLastCalledWith({ panel: "work", companyId: "later", projectId: "later-project", taskId: "blocked-task", mode: "combined" });
    expect(host.textContent).not.toMatch(/Approve|Disapprove/);
    await render([...companies].reverse());
    expect(titles()).toEqual(["overdue", "critical-blocker", "ordinary-1"]);
  });

  it("keeps expiring native actions ahead of severity when deadlines are equal", async () => {
    list.mockImplementation((companyId: string) => Promise.resolve(feed(companyId === "first"
      ? [item("first", "critical", { severity: "critical" })]
      : [item("later", "expires-soon", { expiresAt: "2026-11-08T13:00:00Z" })])));
    await render();
    expect(titles()).toEqual(["expires-soon", "critical"]);
  });

  it("excludes mismatched companies and hides cached records after a revoked-access refresh", async () => {
    list.mockImplementation((companyId: string) => Promise.resolve(feed([
      item(companyId, `${companyId}-visible`), item("unauthorized", "foreign-secret", { severity: "critical" }),
    ])));
    await render();
    expect(titles()).toEqual(["first-visible", "later-visible"]);
    expect(host.textContent).not.toContain("foreign-secret");
    list.mockImplementation((companyId: string) => companyId === "first" ? Promise.reject(new Error("Access revoked")) : Promise.resolve(feed([])));
    await act(async () => { await client.refetchQueries({ queryKey: queryKeys.attention("first") }); });
    await flush();
    expect(host.textContent).not.toContain("first-visible");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Some companies could not be checked");
  });

  it("updates the preview from refreshed native signals without mutating or generating decisions", async () => {
    list.mockResolvedValue(feed([]));
    await render();
    expect(titles()).toEqual([]);
    expect(host.textContent).toContain("No decisions or blockers currently need you");
    list.mockImplementation((companyId: string) => Promise.resolve(feed(companyId === "later"
      ? [item("later", "new-blocker", { sourceKind: "failed_run", severity: "high", inlineResolvable: false })] : [])));
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.attention("later") }); });
    await flush();
    expect(titles()).toEqual(["new-blocker"]);
  });

  it("does no company requests when no companies are authorized", async () => {
    await render([]);
    expect(list).not.toHaveBeenCalled();
    expect(titles()).toEqual([]);
    expect(host.textContent).toContain("No decisions or blockers currently need you");
  });

  it("reports a pending recheck as unknown rather than an empty agenda", async () => {
    list.mockResolvedValue(feed([item("first", "known-proposal")]));
    await render([companies[0]]);
    expect(titles()).toEqual(["known-proposal"]);
    let finish!: (result: AttentionFeed) => void;
    list.mockImplementation(() => new Promise<AttentionFeed>(resolve => { finish = resolve; }));
    let refresh!: Promise<void>;
    await act(async () => { refresh = client.refetchQueries({ queryKey: queryKeys.attention("first") }); });
    await flush();
    expect(titles()).toEqual([]);
    expect(host.textContent).toContain("Checking what needs you");
    expect(host.textContent).not.toContain("No decisions or blockers currently need you");
    await act(async () => { finish(feed([])); await refresh; });
    await flush();
    expect(host.textContent).not.toContain("Checking what needs you");
    expect(host.textContent).toContain("No decisions or blockers currently need you");
  });
});
