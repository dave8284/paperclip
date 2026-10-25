import type { IssueAttachment, IssueDocument, IssueWorkProduct } from "@paperclipai/shared";
import { isHtmlPreview } from "./html-preview";

export const fridayCanvasKey = (attachmentId: string) => `friday-canvas-${attachmentId}`;
export function fridayCanvases(issueId: string | null, attachments: IssueAttachment[], products: IssueWorkProduct[]) {
  const available = new Map(attachments.filter(file => file.issueId === issueId && isHtmlPreview(file.contentType, file.originalFilename)).map(file => [file.id, file]));
  return products.flatMap(product => {
    const id = product.metadata?.attachmentId;
    const attachment = typeof id === "string" ? available.get(id) : undefined;
    if (product.issueId !== issueId || product.type !== "artifact" || !attachment || ["archived", "closed", "failed"].includes(product.status)) return [];
    return [{ product, attachment }];
  }).sort((a, b) => new Date(b.attachment.createdAt).getTime() - new Date(a.attachment.createdAt).getTime() || a.attachment.id.localeCompare(b.attachment.id));
}
export type FridayCanvas = ReturnType<typeof fridayCanvases>[number];
export function savedFridayCanvases(documents: IssueDocument[], canvases: FridayCanvas[]) {
  const available = new Set(canvases.map(canvas => canvas.attachment.id));
  const saved = new Set<string>();
  for (const document of documents) {
    if (!document.key.startsWith("friday-canvas-")) continue;
    try {
      const data = JSON.parse(document.body);
      if (data.version === 1 && typeof data.attachmentId === "string" && document.key === fridayCanvasKey(data.attachmentId) && available.has(data.attachmentId)) saved.add(data.attachmentId);
    } catch { /* User-authored or malformed documents are not executable contracts. */ }
  }
  return saved;
}
