import { z } from "zod";

export const userApprovalStatusSchema = z.enum(["pending", "approved", "suspended", "rejected"]);
export type UserApprovalStatus = z.infer<typeof userApprovalStatusSchema>;
export const adminPersonSchema = z.object({
  id: z.string(), name: z.string(), email: z.string(), image: z.string().nullable(),
  emailVerified: z.boolean(), approvalStatus: userApprovalStatusSchema, approvalRevision: z.number().int(),
  isInstanceAdmin: z.boolean(), activeCompanyMembershipCount: z.number().int(),
  providers: z.array(z.string()), createdAt: z.string(), lastActiveAt: z.string().nullable(),
});
export type AdminPerson = z.infer<typeof adminPersonSchema>;
export const adminPeopleResponseSchema = z.object({
  people: z.array(adminPersonSchema), total: z.number().int(), pending: z.number().int(),
  offset: z.number().int(), limit: z.number().int(),
});
export type AdminPeopleResponse = z.infer<typeof adminPeopleResponseSchema>;
export const adminPeopleQuerySchema = z.object({
  query: z.string().max(200).default(""),
  status: userApprovalStatusSchema.optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const adminUserUpdateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  action: z.enum(["approve", "suspend", "reject", "promote", "demote", "revoke_sessions", "rename"]),
  name: z.string().trim().min(1).max(120).optional(),
  reason: z.string().trim().max(1000).default(""),
}).strict();
export type AdminUserUpdate = z.infer<typeof adminUserUpdateSchema>;
export const adminUserDeleteSchema = z.object({
  expectedRevision: z.number().int().positive(), confirmEmail: z.string().trim().email(),
}).strict();
export const adminInvitationCreateSchema = z.object({
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  name: z.string().trim().min(1).max(120),
}).strict();
export const adminInvitationSchema = z.object({
  id: z.string(), email: z.string(), name: z.string(), expiresAt: z.string(),
  revokedAt: z.string().nullable(), createdAt: z.string(),
});
export const registrationStateSchema = z.object({
  status: z.enum(["anonymous", "pending", "approved", "suspended", "rejected"]),
  isInstanceAdmin: z.boolean(), userId: z.string().nullable(),
});
export type RegistrationState = z.infer<typeof registrationStateSchema>;
export const publicAuthOptionsSchema = z.object({
  googleEnabled: z.boolean(), passwordSignInEnabled: z.boolean().default(true),
  passwordSignUpEnabled: z.boolean(), approvalRequired: z.boolean(),
});
export const adminOverviewSchema = z.object({
  counts: z.object({users: z.number(), pending: z.number(), approved: z.number(), suspended: z.number(), admins: z.number()}),
  google: z.object({configured: z.boolean(), callbackPath: z.string()}),
  mode: z.enum(["local_trusted", "authenticated"]),
});
export const adminEventSchema = z.object({
  id: z.string(), actorUserId: z.string(), targetUserId: z.string().nullable(),
  action: z.string(), details: z.record(z.string(), z.unknown()), createdAt: z.string(),
});

export const adminModelActivitySchema = z.object({
  taskModels: z.array(z.object({
    companyId: z.string(), companyName: z.string(), taskType: z.string(), provider: z.string(), model: z.string(),
    runs: z.number(), succeeded: z.number(), failed: z.number(), meanDurationMs: z.number().nullable(),
    inputTokens: z.number(), outputTokens: z.number(), unpricedReceipts: z.number(),
  })),
  moreTaskModels: z.boolean(), taskModelLimit: z.number(),
  recentRuns: z.array(z.object({
    id: z.string(), companyId: z.string(), companyName: z.string(), companyPrefix: z.string(), agentId: z.string(), taskId: z.string().nullable(),
    createdAt: z.string(), status: z.string(), taskType: z.string(), durationMs: z.number().nullable(),
    queueDelayMs: z.number().nonnegative().nullable().default(null), firstAgentCommentMs: z.number().nonnegative().nullable().default(null),
    selected: z.object({ provider: z.string(), model: z.string(), reason: z.string(), policyVersion: z.string() }).nullable(),
    nativeProfile: z.object({
      harness: z.string().trim().min(1), model: z.string().trim().min(1),
      sessionRequest: z.enum(["existing", "not_recorded"]),
    }).nullable().default(null),
    runtimeSessionState: z.enum(["fresh", "reused", "conflicting", "unknown"]).default("unknown"),
    executionState: z.enum(["available", "unavailable", "not_recorded"]).default("not_recorded"),
    execution: z.object({
      phase: z.string(), label: z.string(), cause: z.string().nullable(), attempt: z.number().int().nonnegative(), retryAt: z.string().nullable(),
      predecessorRunId: z.string().nullable(), predecessorAgentId: z.string().nullable(),
      successorRunId: z.string().nullable(), successorAgentId: z.string().nullable(),
    }).nullable().default(null),
    triage: z.object({ status: z.string(), reason: z.string(), provider: z.string().nullable(), model: z.string().nullable(),
      elapsedMs: z.number().nullable(), contextStrategy: z.string(), proposedTaskType: z.string().nullable(), proposedCandidateId: z.string().nullable(),
    }).nullable(),
    actualModels: z.array(z.object({ provider: z.string(), model: z.string() })), actualModelsTruncated: z.boolean(),
    review: z.object({ passed: z.boolean(), source: z.string(), evidenceRef: z.string(), iterations: z.number(), latencyMs: z.number() }).nullable(),
  })),
  moreRuns: z.boolean(), runLimit: z.number(), reviewLookupLimit: z.number(),
});
export type AdminModelActivity = z.infer<typeof adminModelActivitySchema>;

export const adminModelIntelligenceSchema = z.object({
  since: z.string(), through: z.string(),
  usage: z.array(z.object({ provider: z.string(), model: z.string(), billingType: z.string(), usageKind: z.string().optional(),
    receipts: z.number(), inputTokens: z.number(), outputTokens: z.number(), recordedCostCents: z.number(),
    unpriced: z.number(),
  })),
  decisions: z.array(z.object({ provider: z.string(), model: z.string(), feature: z.string().optional(), attempts: z.number(),
    succeeded: z.number(), failed: z.number(), unknown: z.number(), running: z.number(),
    meanDurationMs: z.number().nullable(),
  })),
  runs: z.array(z.object({ status: z.string(), count: z.number() })),
  activity: adminModelActivitySchema.optional(),
  triage: z.object({
    localRuntime: z.object({ provider: z.literal("local_laya"), state: z.enum(["disabled", "setup_required", "cold", "warming", "ready", "busy", "unavailable"]), model: z.string(), sdkVersion: z.string(), checkpoint: z.string(), externalFallback: z.literal(false) }).optional(),
    groups: z.array(z.object({ taskType: z.string(), complexity: z.string(), contextStrategy: z.string(), decisionStatus: z.string(), reason: z.string(), provider: z.string().nullable().optional(), requestedModel: z.string().nullable().optional(), resolvedModel: z.string().nullable().optional(), computationKind: z.string().nullable().optional(), proposedTaskType: z.string().nullable().optional(), meanElapsedMs: z.number().nullable().optional(), runs: z.number() })),
    recordedRuns: z.number(), unrecordedRuns: z.number(), nativeReviewPreparedRuns: z.number(),
    quality: z.literal("not_evaluated"),
  }).optional(),
  learning: z.object({ status: z.enum(["not_connected", "connected"]), evaluations: z.number().nullable(), policyReleases: z.number().nullable(),
    selections: z.number().default(0),
    explanation: z.string(),
  }),
});
