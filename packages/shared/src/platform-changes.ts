import { z } from "zod";

export const platformChangeSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document"), issueId: z.string().uuid(), documentId: z.string().uuid(), revisionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("attachment"), issueId: z.string().uuid(), attachmentId: z.string().uuid() }).strict(),
]);

/** An owner requests implementation/review. Release and grants retain their
 * existing authorization; a reusable display never becomes executable code here. */
export const requestPlatformChangeSchema = z.object({
  requestKey: z.string().uuid(), applicationId: z.string().uuid(), projectWorkspaceId: z.string().uuid(),
  leadAgentId: z.string().uuid(), reviewerAgentId: z.string().uuid(),
  title: z.string().trim().min(1).max(200), scope: z.string().trim().min(1).max(12_000),
  source: platformChangeSourceSchema.optional(),
  /** Original private references remain in the source company's audit. The
   * destination receives only the text deliberately selected by this owner. */
  publication: z.object({
    sourceCompanyId: z.string().uuid(), source: platformChangeSourceSchema,
    expectedSourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    selectedText: z.string().min(1).max(65_536).refine(text => new TextEncoder().encode(text).length <= 65_536 && !text.includes("\u0000") && text.trim().length > 0, "Choose nonempty UTF-8 text up to 64 KiB"),
  }).strict().optional(),
}).strict().refine(input => input.leadAgentId !== input.reviewerAgentId, {
  message: "Choose a reviewer other than the implementation lead", path: ["reviewerAgentId"],
}).refine(input => !(input.source && input.publication), {
  message: "Choose an existing local source or publish a selected copy", path: ["publication"],
});
export type RequestPlatformChange = z.infer<typeof requestPlatformChangeSchema>;
export interface PlatformChangeRequestResult {
  created: boolean;
  task: { id: string; identifier: string | null; status: string };
  request: { documentId: string; revisionId: string; sha256: string };
}
