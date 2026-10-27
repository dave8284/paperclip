// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueAttachment, IssueWorkProduct } from "@paperclipai/shared";
import type { AgentConversationFocusData } from "@/lib/conversation-focus";
import { FridayWorkspace, type FridayPanel } from "./FridayWorkspace";
import { fridayCanvases, savedFridayCanvases } from "@/lib/friday-canvas";
import { queryKeys } from "@/lib/queryKeys";

const api = vi.hoisted(() => ({ listDocuments: vi.fn(async (): Promise<any[]> => []), getDocument: vi.fn(), upsertDocument: vi.fn(async () => ({})) }));
vi.mock("@/api/issues", () => ({ issuesApi: api }));
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
  async function render(next: AgentConversationFocusData, panel: FridayPanel = null) {
    await act(async () => root.render(<QueryClientProvider client={client}><FridayWorkspace companyId="company" data={next} panel={panel} setPanel={setPanel} compact={false} connected /></QueryClientProvider>));
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
  it("keeps a direct home Settings entry after introductions disappear and opens the selected company without a modal", async () => {
    const navigate = vi.fn();
    const renderHome = async (companyId?: string) => act(async () => root.render(<QueryClientProvider client={client}><FridayWorkspace companyId="company" data={data} panel={null} setPanel={setPanel} compact connected view={{ panel: null, companyId }} navigate={navigate} /></QueryClientProvider>));
    await renderHome("selected-company");
    expect(host.textContent).not.toContain("A little clarity.");
    const entry = host.querySelector<HTMLButtonElement>('nav[aria-label="Workspace settings"] button')!;
    expect(entry.textContent).toBe("Settings");
    await act(async () => entry.click());
    expect(navigate).toHaveBeenLastCalledWith({ panel: "settings", companyId: "selected-company" });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await renderHome();
    await act(async () => host.querySelector<HTMLButtonElement>('nav[aria-label="Workspace settings"] button')!.click());
    expect(navigate).toHaveBeenLastCalledWith({ panel: "settings", companyId: "company" });
    await render(data, "library");
    expect(host.querySelector('nav[aria-label="Workspace settings"]')).toBeNull();
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
