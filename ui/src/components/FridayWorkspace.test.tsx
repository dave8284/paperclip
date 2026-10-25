// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueAttachment, IssueWorkProduct } from "@paperclipai/shared";
import type { AgentConversationFocusData } from "@/lib/conversation-focus";
import { FridayWorkspace, type FridayPanel } from "./FridayWorkspace";
import { fridayCanvases, savedFridayCanvases } from "@/lib/friday-canvas";

const api = vi.hoisted(() => ({ listDocuments: vi.fn(async () => []), upsertDocument: vi.fn(async () => ({})) }));
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
  beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); });
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
});
