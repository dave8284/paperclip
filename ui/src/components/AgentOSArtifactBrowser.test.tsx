// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CompanyArtifact } from "@paperclipai/shared";
import { expect, it, vi } from "vitest";
import { AgentOSArtifactBrowser } from "./AgentOSArtifactBrowser";
const list = vi.hoisted(() => vi.fn());
vi.mock("@/api/artifacts", () => ({ artifactsApi: { list } }));
vi.mock("./AgentOSArtifactDetail", () => ({ AgentOSArtifactDetail: ({ artifact, onClose }: { artifact: CompanyArtifact; onClose: () => void }) => <div>Opened {artifact.title}<button onClick={onClose}>Back</button></div> }));
const output = (id: string, extra: Partial<CompanyArtifact> = {}) => ({ id, source: "document", mediaKind: "document", title: `${id}.md`, project: { id: "p", name: "Project Alpha" }, issue: { id: "task", identifier: "A-1", title: "Launch" }, updatedAt: "2026-11-04T00:00:00Z", ...extra });
it("groups saved outputs by project/type, loads further files without dropping prior folders, and opens details", async () => {
  list.mockImplementation(async (_company, params) => params.cursor ? { artifacts: [output("research", { collection: "research" })], nextCursor: null } : { artifacts: [output("plan"), output("photo", { source: "attachment", mediaKind: "image", title: "photo.png" })], nextCursor: "next" });
  const host = document.createElement("div"), root = createRoot(host), client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); document.body.append(host);
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AgentOSArtifactBrowser companyId="company" projectId="p" /></QueryClientProvider>)); await settle();
    expect(list).toHaveBeenCalledWith("company", expect.objectContaining({ projectId: "p" }));
    expect(host.textContent).toContain("Project Alpha"); expect(host.textContent).toContain("Documents"); expect(host.textContent).toContain("Images");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Load more files")!.click()); await settle();
    expect(host.textContent).toContain("Research & sources"); expect(host.textContent).toContain("plan.md"); expect(host.textContent).toContain("3 loaded");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("research.md"))!.click());
    expect(host.textContent).toContain("Opened research.md");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Back")!.click());
    expect(host.textContent).toContain("photo.png");
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
