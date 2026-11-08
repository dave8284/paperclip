import { z } from "zod";
const uuid = z.uuid().toLowerCase();

// A private read mandate is a prerequisite, never a write grant by itself.
export const setBoardDirectionAuthoritySchema = z.object({
  expectedRevision: z.number().int().positive(), expectedGrantId: uuid.nullable(), enabled: z.boolean(),
}).strict();
export type SetBoardDirectionAuthority = z.infer<typeof setBoardDirectionAuthoritySchema>;
export interface BoardDirectionAuthority { grantId: string; mandateRevision: number }
export const createBoardDirectionSchema = z.object({
  mandateId: uuid, revision: z.number().int().positive(), grantId: uuid,
  targetCompanyId: uuid, executiveAgentId: uuid, projectId: uuid.nullable(),
  idempotencyKey: uuid, title: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).max(16_000), priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
}).strict();
export type CreateBoardDirection = z.infer<typeof createBoardDirectionSchema>;
export const boardDirectionReadQuerySchema = z.object({ revision: z.coerce.number().int().positive() }).strict();
export interface BoardDirectionExecution {
  runId: string; agentId: string; status: string; startedAt: string | null; finishedAt: string | null;
  /** Frozen native task inputs still match this task's current title/description. */
  scopeMatchesCurrentTask: boolean;
  /** Historical exact native review; not business acceptance or artifact freshness. */
  independentReview: { reviewId: string; verdict: "accepted" | "rejected"; evaluator: string; resolvedAt: string } | null;
}
export interface BoardDirectionReceipt {
  id: string; targetCompanyId: string; taskId: string; taskIdentifier: string | null;
  executiveAgentId: string; dispatchState: "pending" | "dispatched" | "cancelled";
  taskStatus: string; currentAssigneeAgentId: string | null; observedAt: string;
  // Dispatch means native admission, never delivery completion or acceptance.
  createdAt: string; dispatchedAt: string | null;
  /** Present only on an outcome read. Null means no native implementation run was found. */
  execution?: BoardDirectionExecution | null;
}
