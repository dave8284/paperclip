import { z } from "zod";

/** Qualification records refer to native evidence; callers cannot supply a
 * model, account, score, provider observation, or executable configuration. */
export const registerModelProfileQualificationSchema = z.object({
  requestKey: z.string().uuid(),
  runId: z.string().uuid(),
  reviewDecisionId: z.string().uuid().optional(),
  nativeReviewInteractionId: z.string().uuid().optional(),
  validUntil: z.string().datetime({ offset: true }),
}).strict().refine(value => !(value.reviewDecisionId && value.nativeReviewInteractionId), { message: "Choose one native review source" });
export type RegisterModelProfileQualification = z.infer<typeof registerModelProfileQualificationSchema>;

export interface ModelProfileBinding {
  schema: "agentos.model-profile-binding.v1";
  provider: "openai";
  model: string;
  requestedEffort: string | null;
  taskType: string;
  complexity: "routine" | "complex";
  promptFingerprint: string;
  configurationFingerprint: string;
  accountFingerprint: string;
}

export interface ModelProfileQualification {
  id: string;
  agentId: string;
  runId: string;
  issueId: string;
  reviewDecisionId: string | null;
  nativeReviewInteractionId: string | null;
  state: "access_verified" | "workflow_qualified" | "revoked" | "stale";
  profile: ModelProfileBinding;
  observedProviderVersion: string;
  observedModel: string;
  observedEffort: string | null;
  observedAt: string;
  validUntil: string;
  qualifiedByUserId: string;
  /** Access was observed for this session; this is not a future entitlement guarantee. */
  evidenceScope: "completed_native_session";
}

export interface ModelProfileQualificationEvidence {
  runId: string;
  issueId: string;
  issueIdentifier: string | null;
  issueTitle: string;
  agentId: string;
  agentName: string;
  model: string;
  reviewDecisionId: string | null;
  nativeReviewInteractionId: string | null;
  state: "access_verified" | "workflow_qualified";
  observedAt: string;
  maximumValidUntil: string;
}
export interface ModelProfileQualificationList {
  qualifications: ModelProfileQualification[];
  availableEvidence: ModelProfileQualificationEvidence[];
  limit: number;
  evidenceLimit: number;
}
