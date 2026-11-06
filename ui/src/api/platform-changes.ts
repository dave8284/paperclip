import type { Agent, Company, IssueAttachment, ManagedApplicationPage, PlatformChangeRequestResult, ProjectWorkspace, RequestPlatformChange } from "@paperclipai/shared";
import type { CurrentBoardAccess } from "./access";
import { api, requestResponse } from "./client";
import { readApiJson } from "./response";

export type ComponentPublicationSource = { companyId: string; source: NonNullable<RequestPlatformChange["source"]> };
export const componentTextLimit = 65_536;
const sourceTextLimit = 262_144;
export const isComponentText = (contentType: string) => /^(text\/|application\/(json|javascript|xml|xhtml\+xml)(;|$))/i.test(contentType);
async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  return readApiJson<T>(await requestResponse(path, { method: "GET", cache: "no-store", signal }));
}
export async function componentTextHash(text: string) {
  const bytes = new TextEncoder().encode(text);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function boundedText(response: Response, limit = sourceTextLimit) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The source file could not be read");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let size = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new Error("Choose a source up to 256 KiB");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel(); reader.releaseLock(); }
}
const company = (id: string) => `/companies/${encodeURIComponent(id)}`;

// Account-sensitive reads bypass the shared URL-only in-flight cache. The
// publication form supplies account/company query keys and abort signals.
export const platformChangesApi = {
  access: (signal?: AbortSignal) => read<CurrentBoardAccess>("/cli-auth/me", signal),
  companies: (signal?: AbortSignal) => read<Company[]>("/companies?scope=accessible&includeInternal=true", signal),
  applications: (id: string, signal?: AbortSignal) => read<ManagedApplicationPage>(`${company(id)}/managed-applications?kind=platform`, signal),
  workspaces: (id: string, projectId: string, signal?: AbortSignal) => read<ProjectWorkspace[]>(`/projects/${encodeURIComponent(projectId)}/workspaces?companyId=${encodeURIComponent(id)}`, signal),
  employees: (id: string, signal?: AbortSignal) => read<Agent[]>(`${company(id)}/agents`, signal),
  request: (id: string, input: RequestPlatformChange) => api.post<PlatformChangeRequestResult>(`${company(id)}/friday/platform-changes`, input),
  async source(candidate: ComponentPublicationSource, signal?: AbortSignal): Promise<{ text: string; sha256: string }> {
    const { source, companyId } = candidate;
    const task = `/issues/${encodeURIComponent(source.issueId)}`;
    if (source.kind === "document") {
      // The exact native revision owner avoids downloading every historical
      // body. Allow JSON escape overhead while bounding the response itself.
      const path = `${company(companyId)}/friday/platform-component-sources/${encodeURIComponent(source.issueId)}/documents/${encodeURIComponent(source.documentId)}/revisions/${encodeURIComponent(source.revisionId)}`;
      const response = await requestResponse(path, { method: "GET", cache: "no-store", signal });
      const revision = JSON.parse(await boundedText(response, 2_000_000)) as { text?: unknown; sha256?: unknown };
      if (typeof revision.text !== "string" || new TextEncoder().encode(revision.text).length > sourceTextLimit) throw new Error("Choose an available source revision up to 256 KiB");
      const sha256 = await componentTextHash(revision.text);
      if (sha256 !== revision.sha256) throw new Error("The source revision does not match its saved hash");
      return { text: revision.text, sha256 };
    }
    const attachments = await read<IssueAttachment[]>(`${task}/attachments`, signal);
    const attachment = attachments.find(row => row.id === source.attachmentId && row.companyId === companyId && row.issueId === source.issueId);
    if (!attachment || !isComponentText(attachment.contentType) || attachment.byteSize > sourceTextLimit) throw new Error("Choose an available text or HTML file up to 256 KiB");
    // Never follow an artifact URL or execute its HTML. Read the native owner and
    // display literal UTF-8 in the review textarea, then verify its stored hash.
    const text = await boundedText(await requestResponse(`/attachments/${encodeURIComponent(attachment.id)}/content`, { method: "GET", cache: "no-store", signal }));
    const sha256 = await componentTextHash(text);
    if (sha256 !== attachment.sha256) throw new Error("The source file does not match its saved hash");
    return { text, sha256 };
  },
};
