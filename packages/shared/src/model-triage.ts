import { z } from "zod";

/** Observations are advice; native authorization and model pins remain authoritative. */
export const modelTriageReceiptSchema = z.object({
  schema: z.literal("agentos.model-triage.v1"),
  companyId: z.string(), runId: z.string(), taskId: z.string(), agentId: z.string(),
  mode: z.literal("shadow"), policyVersion: z.string(), questionVersion: z.string(),
  inputDigest: z.string(), candidateDigest: z.string(),
  computationKind: z.literal("deterministic_classification"),
  taskType: z.string(), complexity: z.enum(["routine", "complex"]),
  contextStrategy: z.enum(["standard", "context_rich_author_and_independent_review"]),
  reviewEvidence: z.literal("not_established_by_triage"),
  decision: z.object({
    status: z.enum(["not_run", "observed", "abstained"]), reason: z.string(),
    computationKind: z.enum(["not_run", "local_encoder", "remote_typed_decision"]).optional(),
    funding: z.enum(["local_compute", "metered_api"]).optional(), localRequestId: z.string().nullable().optional(),
    inputTokens: z.number().nonnegative().nullable().optional(), outputTokens: z.number().nonnegative().nullable().optional(),
    invocationId: z.string().nullable(), provider: z.string().nullable(), requestedModel: z.string().nullable(), resolvedModel: z.string().nullable(), elapsedMs: z.number().nonnegative().nullable(),
    costCents: z.string().nullable(), costStatus: z.enum(["reported", "estimated", "unpriced"]).nullable(),
    proposedCandidateId: z.string().nullable(), proposedTaskType: z.string().nullable(),
  }),
  selectedCandidateId: z.string(), routeChangedByTriage: z.literal(false),
  revalidationRequired: z.literal(true),
});
export type ModelTriageReceipt = z.infer<typeof modelTriageReceiptSchema>;
