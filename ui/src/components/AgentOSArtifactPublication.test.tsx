// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CompanyArtifact } from "@paperclipai/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentOSArtifactDetail } from "./AgentOSArtifactDetail";

const mocks = vi.hoisted(() => ({ documents: vi.fn(), revisions: vi.fn(), attachments: vi.fn(), publication: vi.fn() }));
vi.mock("@/api/issues", () => ({ issuesApi: { listDocuments: mocks.documents, listDocumentRevisions: mocks.revisions, listAttachments: mocks.attachments } }));
vi.mock("./PlatformChangeRequest", () => ({ PlatformChangeRequest: (props: unknown) => { mocks.publication(props); return <div>Publication entry</div>; } }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: any) => <a href={to}>{children}</a> }));
vi.mock("./MarkdownBody", () => ({ MarkdownBody: ({ children }: any) => <div>{children}</div> }));
vi.mock("./task-side-panel/TaskAttachmentPanel", () => ({ TaskAttachmentPanel: () => <div>Native file preview</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const artifact = { id: "document:doc", source: "document", title: "Generated table", issue: { id: "task", identifier: "BIZ-1" }, href: "/issues/task" } as CompanyArtifact;
beforeEach(() => {
  vi.clearAllMocks(); mocks.documents.mockResolvedValue([{ id: "doc", companyId: "business", key: "component" }]);
  mocks.revisions.mockResolvedValue([{ id: "new", revisionNumber: 2, body: "New", createdAt: "2026-11-07" }, { id: "old", revisionNumber: 1, body: "Old", createdAt: "2026-11-06" }]);
  mocks.attachments.mockResolvedValue([]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
async function render(value: CompanyArtifact) { await act(async () => root.render(<QueryClientProvider client={client}><AgentOSArtifactDetail artifact={value} onClose={() => {}} /></QueryClientProvider>)); await settle(); await settle(); }

it("binds the publication entry to the exact saved revision selected in artifact history", async () => {
  await render(artifact);
  expect(mocks.publication).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: "business", publicationCandidate: { companyId: "business", source: { kind: "document", issueId: "task", documentId: "doc", revisionId: "new" } } }));
  await act(async () => { const select = host.querySelector("select")!; select.value = "old"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(mocks.publication).toHaveBeenLastCalledWith(expect.objectContaining({ publicationCandidate: { companyId: "business", source: { kind: "document", issueId: "task", documentId: "doc", revisionId: "old" } } }));
});
it("uses a work product's native backing file and offers no copy entry for an unavailable file", async () => {
  const workProduct = { ...artifact, id: "work_product:output", source: "work_product", contentPath: "/api/attachments/file/content" } as CompanyArtifact;
  mocks.attachments.mockResolvedValue([{ id: "file", companyId: "business", contentType: "text/html", byteSize: 50, contentPath: workProduct.contentPath, createdAt: "2026-11-07" }]);
  await render(workProduct);
  expect(mocks.publication).toHaveBeenLastCalledWith(expect.objectContaining({ publicationCandidate: { companyId: "business", source: { kind: "attachment", issueId: "task", attachmentId: "file" } } }));
  mocks.attachments.mockRejectedValue(new Error("File access revoked")); mocks.publication.mockClear();
  await act(async () => { await client.invalidateQueries(); }); await settle();
  expect(host.textContent).toContain("File access revoked"); expect(host.textContent).not.toContain("Publication entry");
});
