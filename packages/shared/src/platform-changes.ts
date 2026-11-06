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
}).strict().refine(input => input.leadAgentId !== input.reviewerAgentId, {
  message: "Choose a reviewer other than the implementation lead", path: ["reviewerAgentId"],
});
export type RequestPlatformChange = z.infer<typeof requestPlatformChangeSchema>;
export interface PlatformChangeRequestResult {
  created: boolean;
  task: { id: string; identifier: string | null; status: string };
  request: { documentId: string; revisionId: string; sha256: string };
}
