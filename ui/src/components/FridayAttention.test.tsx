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
vi.mock("./AttentionQueueRow", () => ({ AttentionQueueRow: ({ item, onDismiss, expanded, onToggleExpand }: any) => <div data-native-decision={item.id}>{item.subject.title}<button aria-expanded={expanded} onClick={() => onToggleExpand(item)}>Details {item.id}</button><button onClick={() => onDismiss(item)}>Dismiss {item.id}</button></div> }));

describe("Friday project attention", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  const onProject = vi.fn(), onAsk = vi.fn();
  const item = { id: "decision", dismissalKey: "native-key", whyNow: "Waiting for review", subject: { id: "task", title: "Approve the release", href: "/issues/AGE-1" }, project: { id: "project", name: "Customer application" } };
  const feed = { items: [item], totalCount: 51, nextCursor: "next", generatedAt: "2026-10-25T00:00:00Z" };
  beforeEach(() => { vi.clearAllMocks(); api.list.mockResolvedValue(feed); host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); client.clear(); });
  async function render(projectId?: string, decisionId?: string) {
    await act(async () => { root.render(<QueryClientProvider client={client}><FridayAttention companyId="company" agents={[]} projectId={projectId} decisionId={decisionId} onProject={onProject} onAsk={onAsk} /></QueryClientProvider>); });
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
  it.each([
    { requestedRevisionId: "requested-plan-revision", currentRevisionId: "requested-plan-revision", state: "current" },
    { requestedRevisionId: "requested-plan-revision", currentRevisionId: "newer-plan-revision", state: "changed" },
    { requestedRevisionId: null, currentRevisionId: "newer-plan-revision", state: "unavailable" },
    { requestedRevisionId: "requested-plan-revision", currentRevisionId: null, state: "unavailable" },
  ])("passes the saved plan target separately from the observed $state document when Discuss is clicked", async planTarget => {
    api.list.mockResolvedValue({ ...feed, items: [{ ...item, sourceKind: "issue_thread_interaction", updatedAt: "2026-10-28T00:00:00Z",
      detail: { kind: "plan_approval", planTarget: { issueId: "task", key: "plan", requestedDocumentId: "bound-document", currentDocumentId: "bound-document", ...planTarget }, images: [] } }] });
    await render(); await click("Discuss with Friday");
    const context = onAsk.mock.calls[0]?.[0];
    expect(context).toContain(`Requested review target: task task, document key plan, requested revision ${planTarget.requestedRevisionId ?? "not recorded"}`);
    expect(context).toContain(`Observed current document revision: ${planTarget.currentRevisionId ?? "unavailable"}; target state: ${planTarget.state}`);
    expect(context).toContain("requested document id: bound-document");
    expect(context).toContain("observed document id: bound-document");
    expect(context).toContain("observation timestamp, not a target revision");
    expect(context).toContain("a newer current revision does not replace or approve it");
    expect(context).toContain("through authorized access");
    expect(context).toContain("This discussion is not approval.");
    expect(api.dismiss).not.toHaveBeenCalled();
  });
  it("does not invent a target revision for a legacy plan summary", () => {
    const context = fridayDecisionContext({ ...item, updatedAt: "2026-10-28T00:00:00Z", detail: { kind: "plan_approval", images: [] } } as any, "company");
    expect(context).toContain("Requested review target/revision unavailable");
    expect(context).toContain("Do not infer it from the current document or source update time");
    expect(context).not.toContain("requested revision 2026");
  });
  it("lets a deep-linked decision stay collapsed across a feed refresh", async () => {
    await render("project", "decision");
    expect(host.querySelector('button[aria-expanded="true"]')).not.toBeNull();
    await click("Details decision");
    expect(host.querySelector('button[aria-expanded="false"]')).not.toBeNull();
    await click("Refresh");
    await render("project", "decision");
    expect(host.querySelector('button[aria-expanded="false"]')).not.toBeNull();
    await click("Details decision");
    expect(host.querySelector('button[aria-expanded="true"]')).not.toBeNull();
  });
});
