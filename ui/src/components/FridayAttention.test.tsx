// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FridayAttention, fridayDecisionContext } from "./FridayAttention";
import { queryKeys } from "../lib/queryKeys";

const api = vi.hoisted(() => ({ list: vi.fn(), dismiss: vi.fn(async () => ({})), session: vi.fn(async () => ({ user: { id: "operator" } })) }));
vi.mock("../api/attention", () => ({ attentionApi: { list: api.list } }));
vi.mock("../api/auth", () => ({ authApi: { getSession: api.session } }));
vi.mock("../api/inboxDismissals", () => ({ inboxDismissalsApi: { dismiss: api.dismiss } }));
vi.mock("./AttentionQueueRow", () => ({ AttentionQueueRow: ({ item, onDismiss }: any) => <div data-native-decision={item.id}>{item.subject.title}<button onClick={() => onDismiss(item)}>Dismiss {item.id}</button></div> }));

describe("Friday project attention", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  const onProject = vi.fn(), onAsk = vi.fn();
  const item = { id: "decision", dismissalKey: "native-key", whyNow: "Waiting for review", subject: { id: "task", title: "Approve the release", href: "/issues/AGE-1" }, project: { id: "project", name: "Customer application" } };
  const feed = { items: [item], totalCount: 51, nextCursor: "next", generatedAt: "2026-10-25T00:00:00Z" };
  beforeEach(() => { vi.clearAllMocks(); api.list.mockResolvedValue(feed); host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); client.clear(); });
  async function render(projectId?: string) {
    await act(async () => { root.render(<QueryClientProvider client={client}><FridayAttention companyId="company" agents={[]} projectId={projectId} onProject={onProject} onAsk={onAsk} /></QueryClientProvider>); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
  async function click(label: string) { await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === label)!.click()); }
  it("surfaces native decisions automatically, groups them by project and preserves native actions", async () => {
    await render();
    expect(host.textContent).toContain("51 current decisions"); expect(host.textContent).toContain("Customer application");
    expect(host.querySelector('[data-native-decision="decision"]')).not.toBeNull();
    await click("See project"); expect(onProject).toHaveBeenCalledWith("project");
    await click("Discuss with Friday"); expect(onAsk).toHaveBeenCalledWith(expect.stringContaining("/issues/AGE-1"));
    await click("Dismiss decision"); expect(api.dismiss).toHaveBeenCalledWith("company", "native-key");
  });
  it("keeps project scope across native pagination and hides cached decisions after access fails", async () => {
    await render("project"); expect(api.list).toHaveBeenLastCalledWith("company", expect.objectContaining({ category: "proposals", projectId: "project", limit: 50 }));
    await click("Next decisions"); expect(api.list).toHaveBeenLastCalledWith("company", expect.objectContaining({ projectId: "project", cursor: "next" }));
    api.list.mockRejectedValue(new Error("Access revoked"));
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.attention("company") }); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(host.textContent).toContain("Access revoked"); expect(host.textContent).not.toContain("Approve the release");
  });
  it("describes an empty proposal category without labelling raw blockers as decisions", async () => {
    api.list.mockResolvedValue({ ...feed, items: [], totalCount: 0, nextCursor: null }); await render("project");
    expect(host.textContent).toContain("0 current decisions"); expect(host.textContent).toContain("Work blockers remain in the Work view");
    expect(host.textContent).not.toContain("Discuss with Friday");
  });
  it("supplies native identity, task, scope and observed proposal to the spoken discussion", () => {
    const context = fridayDecisionContext({ ...item, sourceKind: "decision", updatedAt: "2026-10-28T00:00:00Z", detail: { kind: "generic", summaryExcerpt: "Approve staged rollout", images: [] }, relatedIssue: { id: "task-id", href: "/issues/AGE-2" } } as any, "company");
    for (const expected of ["Company: company", "Project: project", "Native source kind: decision", "id: task", "Related task id: task-id", "/issues/AGE-2", "2026-10-28T00:00:00Z", "Approve staged rollout", "current revision"]) expect(context).toContain(expected);
  });
});
