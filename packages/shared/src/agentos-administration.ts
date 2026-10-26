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
  googleEnabled: z.boolean(), passwordSignUpEnabled: z.boolean(), approvalRequired: z.boolean(),
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

export const adminModelIntelligenceSchema = z.object({
  since: z.string(), through: z.string(),
  usage: z.array(z.object({ provider: z.string(), model: z.string(), billingType: z.string(),
    receipts: z.number(), inputTokens: z.number(), outputTokens: z.number(), recordedCostCents: z.number(),
    unpriced: z.number(),
  })),
  decisions: z.array(z.object({ provider: z.string(), model: z.string(), attempts: z.number(),
    succeeded: z.number(), failed: z.number(), unknown: z.number(), running: z.number(),
    meanDurationMs: z.number().nullable(),
  })),
  runs: z.array(z.object({ status: z.string(), count: z.number() })),
  learning: z.object({ status: z.literal("not_connected"), evaluations: z.null(), policyReleases: z.null(),
    explanation: z.string(),
  }),
});
