// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CompanyArtifact } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentOSArtifactBrowser } from "./AgentOSArtifactBrowser";
import { AgentOSArtifactDetail } from "./AgentOSArtifactDetail";
import { queryKeys } from "@/lib/queryKeys";

const mocks = vi.hoisted(() => ({ list: vi.fn(), documents: vi.fn(), revisions: vi.fn(), attachments: vi.fn() }));
vi.mock("@/api/artifacts", () => ({ artifactsApi: { list: mocks.list } }));
vi.mock("@/api/issues", () => ({ issuesApi: { listDocuments: mocks.documents, listDocumentRevisions: mocks.revisions, listAttachments: mocks.attachments } }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: any) => <a href={to}>{children}</a> }));
vi.mock("./MarkdownBody", () => ({ MarkdownBody: ({ children }: any) => <div>{children}</div> }));
vi.mock("./task-side-panel/TaskAttachmentPanel", () => ({ TaskAttachmentPanel: () => <div>File preview</div> }));

const artifact = {
  id: "document:private-doc", source: "document", mediaKind: "document", title: "Confidential plan",
  project: { id: "project", name: "Private project" }, issue: { id: "task", identifier: "A-1", title: "Private task" },
  updatedAt: "2026-11-01T00:00:00Z", href: "/issues/task", openPath: "/api/private-file", downloadPath: null,
} as CompanyArtifact;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("artefact access refresh", () => {
  let host: HTMLDivElement, root: Root, client: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue({ artifacts: [artifact], nextCursor: null });
    mocks.documents.mockResolvedValue([{ id: "private-doc", key: "plan" }]);
    mocks.revisions.mockResolvedValue([{ id: "revision", revisionNumber: 1, body: "Confidential document body", createdAt: "2026-11-01T00:00:00Z", changeSummary: "Private revision summary" }]);
    mocks.attachments.mockResolvedValue([]);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); client.clear(); });
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
  async function render(children: ReactNode) {
    await act(async () => root.render(<QueryClientProvider client={client}>{children}</QueryClientProvider>));
    await settle(); await settle();
  }
  it("hides cached project files after the list loses access", async () => {
    await render(<AgentOSArtifactBrowser companyId="company" />);
    expect(host.textContent).toContain("Confidential plan");
    mocks.list.mockRejectedValue(new Error("Access revoked"));
    await act(async () => { await client.invalidateQueries(); }); await settle();
    expect(host.textContent).toContain("Access revoked");
    expect(host.textContent).not.toContain("Confidential plan");
    expect(host.textContent).not.toContain("Private project");
  });
  it("closes selected detail when its owning list loses access", async () => {
    await render(<AgentOSArtifactBrowser companyId="company" />);
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Confidential plan"))!.click());
    await settle(); await settle();
    expect(host.textContent).toContain("Confidential document body");
    mocks.list.mockRejectedValue(new Error("Access revoked"));
    await act(async () => { await client.invalidateQueries({ predicate: query => query.queryKey.includes("artifact-files") }); }); await settle();
    expect(host.textContent).not.toContain("Confidential document body");
    expect(host.querySelector('a[href$="/api/private-file"]')).toBeNull();
  });
  it("withholds cached document content and downloads after revision access fails", async () => {
    await render(<AgentOSArtifactDetail artifact={artifact} onClose={() => {}} />);
    expect(host.textContent).toContain("Confidential document body");
    mocks.revisions.mockRejectedValue(new Error("Revision access revoked"));
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.issues.documentRevisions("task", "plan") }); }); await settle();
    expect(host.textContent).toContain("Revision access revoked");
    expect(host.textContent).not.toContain("Confidential document body");
    expect(host.textContent).not.toContain("Download this version");
    expect(host.querySelector('a[href$="/api/private-file"]')).toBeNull();
    mocks.revisions.mockResolvedValue([{ id: "current-revision", revisionNumber: 2, body: "Currently authorized body", createdAt: "2026-11-01T00:00:00Z" }]);
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Try again")!.click());
    await settle();
    expect(host.textContent).toContain("Currently authorized body");
    expect(host.textContent).toContain("Download this version");
  });
  it("removes an open file when a successful refresh no longer lists it", async () => {
    await render(<AgentOSArtifactBrowser companyId="company" />);
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Confidential plan"))!.click());
    await settle(); await settle();
    expect(host.textContent).toContain("Confidential document body");
    mocks.list.mockResolvedValue({ artifacts: [], nextCursor: null });
    await act(async () => { await client.invalidateQueries({ predicate: query => query.queryKey.includes("artifact-files") }); }); await settle();
    expect(host.textContent).toContain("no longer available");
    expect(host.textContent).not.toContain("Confidential plan");
    expect(host.textContent).not.toContain("Confidential document body");
  });
  it("withholds cached revisions when the parent document is no longer readable", async () => {
    await render(<AgentOSArtifactDetail artifact={artifact} onClose={() => {}} />);
    mocks.documents.mockRejectedValue(new Error("Document access revoked"));
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.issues.documents("task"), exact: true }); }); await settle();
    expect(host.textContent).toContain("Document access revoked");
    expect(host.textContent).not.toContain("Confidential plan");
    expect(host.textContent).not.toContain("Confidential document body");
    expect(host.textContent).not.toContain("Download this version");
  });
  it("withholds attachment preview, history and links after access fails", async () => {
    mocks.attachments.mockResolvedValue([{ id: "file", originalFilename: "Private output", createdAt: "2026-11-01T00:00:00Z" }]);
    await render(<AgentOSArtifactDetail artifact={{ ...artifact, id: "attachment:file", source: "attachment" }} onClose={() => {}} />);
    expect(host.textContent).toContain("File preview");
    mocks.attachments.mockRejectedValue(new Error("Attachment access revoked"));
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.issues.attachments("task") }); }); await settle();
    expect(host.textContent).toContain("Attachment access revoked");
    expect(host.textContent).not.toContain("File preview");
    expect(host.textContent).not.toContain("Private output");
    expect(host.querySelector("a")).toBeNull();
  });
});
