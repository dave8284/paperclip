// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Company, IssueAttachment, IssueWorkProduct } from "@paperclipai/shared";
import type { FridayNavigation } from "@/lib/friday-navigation";
import type { AgentConversationFocusData } from "@/lib/conversation-focus";
import { FridayWorkspace, type FridayPanel } from "./FridayWorkspace";
import { fridayCanvases, savedFridayCanvases } from "@/lib/friday-canvas";
import { queryKeys } from "@/lib/queryKeys";

const api = vi.hoisted(() => ({ listDocuments: vi.fn(async (): Promise<any[]> => []), getDocument: vi.fn(), upsertDocument: vi.fn(async () => ({})) }));
const workApi = vi.hoisted(() => ({ work: vi.fn() }));
vi.mock("@/api/issues", () => ({ issuesApi: api }));
vi.mock("@/api/friday", () => ({ fridayKey: (id: string) => ["friday", id], fridayApi: workApi }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: async () => [] } }));
vi.mock("./FridayOrb", () => ({ FridayOrb: ({ state }: { state: string }) => <div data-state={state} /> }));
vi.mock("./PortfolioGalaxy", () => ({ PortfolioGalaxy: () => <div>Real portfolio</div> }));
vi.mock("./task-side-panel/TaskAttachmentPanel", () => ({ TaskAttachmentPanel: ({ attachmentId }: { attachmentId: string }) => <div data-preview={attachmentId} /> }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));

describe("Friday published displays", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  const setPanel = vi.fn();
  const file = { id: "file", issueId: "chat", contentType: "text/html", originalFilename: "report.html", createdAt: new Date() } as IssueAttachment;
  const product = { id: "product", issueId: "chat", type: "artifact", title: "Report", status: "ready_for_review", metadata: { attachmentId: "file" } , companyId: "company", projectId: null, executionWorkspaceId: null, runtimeServiceId: null,
    provider: "paperclip", externalId: null, url: null, reviewState: "none", isPrimary: false, healthStatus: "unknown",
    summary: null, createdByRunId: null, createdAt: new Date(), updatedAt: new Date() } satisfies IssueWorkProduct;
  const data: AgentConversationFocusData = { issueId: "chat", attachments: [], workProducts: [], reply: undefined, onTranscript: vi.fn(), voiceDisabled: false, runStatus: "idle", awaitingInput: false, unavailable: false, loading: false };
  beforeEach(() => { vi.clearAllMocks(); api.listDocuments.mockResolvedValue([]); host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); client.clear(); });
  async function render(next: AgentConversationFocusData, panel: FridayPanel = null, options: { companies?: Company[]; view?: FridayNavigation } = {}) {
    await act(async () => root.render(<QueryClientProvider client={client}><FridayWorkspace companyId="company" data={next} panel={panel} setPanel={setPanel} compact={false} connected {...options} /></QueryClientProvider>));
  }
  it("keeps loaded history quiet, opens a newly published display, and stops its preview", async () => {
    await render({ ...data, loading: true });
    await render({ ...data, attachments: [file], workProducts: [product] });
    expect(setPanel).not.toHaveBeenCalled();
    const second = { ...file, id: "new-file", createdAt: new Date(Date.now() + 1000) };
    const secondProduct = { ...product, id: "new-product", metadata: { attachmentId: second.id } };
    const next = { ...data, attachments: [file, second], workProducts: [product, secondProduct] };
    await render(next);
    expect(setPanel).toHaveBeenCalledWith("canvas");
    await render(next, "canvas");
    expect(host.querySelector('[data-preview="new-file"]')).not.toBeNull();
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Stop preview")!.click());
    expect(host.querySelector("[data-preview]")).toBeNull();
    expect(host.textContent).toContain("Preview stopped");
  });
  it("saves an immutable reference through native revision control and hides cached content after loss of access", async () => {
    const next = { ...data, attachments: [file], workProducts: [product] };
    await render(next, "library");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Report"))!.click());
    await render(next, "canvas");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Save for reuse")!.click());
    expect(api.upsertDocument).toHaveBeenCalledWith("chat", "friday-canvas-file", expect.objectContaining({ baseRevisionId: null, body: JSON.stringify({ version: 1, attachmentId: "file", workProductId: "product" }) }));
    await render({ ...next, unavailable: true }, "canvas");
    expect(host.querySelector("[data-preview]")).toBeNull();
  });
  it("requires both a native work product and its current authorized attachment, never arbitrary metadata URLs", () => {
    expect(fridayCanvases("chat", [file], [product])).toHaveLength(1);
    expect(fridayCanvases("another-chat", [file], [product])).toHaveLength(0);
    expect(fridayCanvases("chat", [], [product])).toHaveLength(0);
    expect(fridayCanvases("chat", [file], [{ ...product, metadata: { url: "https://untrusted.invalid" } }])).toHaveLength(0);
    expect(savedFridayCanvases([{ key: "friday-canvas-file", body: "invalid" } as never], fridayCanvases("chat", [file], [product])).size).toBe(0);
  });
  it("keeps Settings out of the home canvas", async () => {
    await render(data);
    expect(host.querySelector('nav[aria-label="Workspace settings"]')).toBeNull();
    expect([...host.querySelectorAll("button")].some(button => button.textContent === "Settings")).toBe(false);
  });
  it("lists scoped live tables, stops reads, and refreshes data when resumed", async () => {
    const companyId = "00000000-0000-4000-8000-000000000001", otherCompany = "00000000-0000-4000-8000-000000000002";
    const body = { version: 1, kind: "table", title: "Live launch tasks", source: "tasks", companyId };
    const document = { issueId: "chat", companyId: "company", key: "friday-display-launch", latestRevisionId: "one", body: JSON.stringify(body) };
    api.listDocuments.mockResolvedValue([document, { ...document, key: "friday-display-other", body: JSON.stringify({ ...body, companyId: otherCompany, title: "Other company display" }) }]);
    api.getDocument.mockResolvedValue(document);
    const work = (title: string) => ({ projects: [], tasks: [{ id: "task", title, identifier: "APP-1", projectId: null, status: "todo", priority: "high" }], observedAt: new Date().toISOString(), nextOffset: null, nextProjectOffset: null });
    workApi.work.mockResolvedValue(work("Initial task"));
    const companies = [{ id: companyId, name: "Launch Co" }, { id: otherCompany, name: "Other Co" }] as Company[];
    await render(data, "library", { companies, view: { panel: "library", companyId } });
    await vi.waitFor(() => expect(host.textContent).toContain("Live launch tasks"));
    expect(host.textContent).not.toContain("Other company display"); expect(setPanel).not.toHaveBeenCalled();
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Live launch tasks"))!.click());
    await render(data, "canvas", { companies, view: { panel: "canvas", companyId } });
    await vi.waitFor(() => expect(host.textContent).toContain("Initial task"));
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Stop preview")!.click());
    expect(host.querySelector("table")).toBeNull();
    const reads = workApi.work.mock.calls.length;
    await act(async () => { await client.invalidateQueries({ queryKey: ["friday", companyId] }); });
    expect(workApi.work).toHaveBeenCalledTimes(reads);
    workApi.work.mockResolvedValue(work("Fresh task"));
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Resume preview")!.click());
    await vi.waitFor(() => expect(host.textContent).toContain("Fresh task"));
    expect(host.textContent).not.toContain("Initial task"); expect(workApi.work).toHaveBeenCalledTimes(reads + 1);
    await render({ ...data, unavailable: true }, "canvas", { companies, view: { panel: "canvas", companyId } });
    expect(host.querySelector("table")).toBeNull(); expect(host.textContent).toContain("not available in this workspace");
    api.listDocuments.mockResolvedValue([{ ...document, issueId: "other-chat" }]);
    await render({ ...data, issueId: "other-chat" }, "canvas", { companies, view: { panel: "canvas", companyId } });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(host.querySelector("table")).toBeNull(); expect(workApi.work).toHaveBeenCalledTimes(reads + 1);
  });
  it("opens a new saved-display revision once without replaying initial documents", async () => {
    const companyId = "00000000-0000-4000-8000-000000000001";
    const document = { issueId: "chat", companyId: "company", key: "friday-display-current", latestRevisionId: "old", body: JSON.stringify({ version: 1, kind: "table", title: "Current projects", source: "projects", companyId }) };
    api.listDocuments.mockResolvedValue([document]);
    await render(data, "library", { companies: [{ id: companyId, name: "Launch Co" }] as Company[], view: { panel: "library", companyId } });
    await vi.waitFor(() => expect(host.textContent).toContain("Current projects"));
    expect(setPanel).not.toHaveBeenCalled();
    await act(async () => { client.setQueryData(queryKeys.issues.documents("chat"), [{ ...document, latestRevisionId: "new" }]); });
    await vi.waitFor(() => expect(setPanel).toHaveBeenCalledExactlyOnceWith("canvas"));
  });
  it("waits for the first document read before recording history from a stale cache", async () => {
    const companyId = "00000000-0000-4000-8000-000000000001";
    const document = { issueId: "chat", companyId: "company", key: "friday-display-current", latestRevisionId: "cached-A", body: JSON.stringify({ version: 1, kind: "table", title: "Current projects", source: "projects", companyId }) };
    client.setQueryData(queryKeys.issues.documents("chat"), [document]);
    let resolve!: (value: typeof document[]) => void;
    api.listDocuments.mockReturnValue(new Promise(done => { resolve = done; }));
    await render(data, "library", { companies: [{ id: companyId, name: "Launch Co" }] as Company[], view: { panel: "library", companyId } });
    expect(setPanel).not.toHaveBeenCalled();
    await act(async () => { resolve([{ ...document, latestRevisionId: "initial-server-B" }]); await new Promise(done => setTimeout(done, 0)); });
    expect(setPanel).not.toHaveBeenCalled();
    await act(async () => { client.setQueryData(queryKeys.issues.documents("chat"), [{ ...document, latestRevisionId: "new-C" }]); });
    await vi.waitFor(() => expect(setPanel).toHaveBeenCalledExactlyOnceWith("canvas"));
  });
  it("opens newly saved typed view requests without replaying history or executing invalid requests", async () => {
    api.listDocuments.mockResolvedValue([{ key: "friday-view", latestRevisionId: "old" }]);
    api.getDocument.mockResolvedValue({ latestRevisionId: "old", body: '{"version":1,"panel":"work"}' });
    await render(data); await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(setPanel).not.toHaveBeenCalled();
    api.getDocument.mockResolvedValue({ latestRevisionId: "new", body: '{"version":1,"panel":"work","mode":"combined"}' });
    await act(async () => { client.setQueryData(queryKeys.issues.documents("chat"), [{ key: "friday-view", latestRevisionId: "new" }]); await new Promise(resolve => setTimeout(resolve, 0)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(setPanel).toHaveBeenCalledWith("work"); setPanel.mockClear();
    api.getDocument.mockResolvedValue({ latestRevisionId: "invalid", body: '{"version":1,"panel":"deploy","url":"https://untrusted.invalid"}' });
    await act(async () => { client.setQueryData(queryKeys.issues.documents("chat"), [{ key: "friday-view", latestRevisionId: "invalid" }]); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(setPanel).not.toHaveBeenCalled();
  });
});
