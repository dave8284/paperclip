import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import type { ModelProfileBinding } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issues } from "./issues.js";
import { issueExecutionDecisions } from "./issue_execution_decisions.js";
import { issueThreadInteractions } from "./issue_thread_interactions.js";

/** Native host attestation, separate from the independent model policy store.
 * Evidence and profile bindings are immutable; revocation only removes access. */
export const modelProfileQualifications = pgTable("model_profile_qualifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => heartbeatRuns.id),
  issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
  reviewDecisionId: uuid("review_decision_id").references(() => issueExecutionDecisions.id, { onDelete: "set null" }),
  nativeReviewInteractionId: uuid("native_review_interaction_id").references(() => issueThreadInteractions.id, { onDelete: "set null" }),
  requestKey: uuid("request_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  state: text("state").$type<"access_verified" | "workflow_qualified">().notNull(),
  accountFingerprint: text("account_fingerprint").notNull(),
  profile: jsonb("profile").$type<ModelProfileBinding>().notNull(),
  evidenceFingerprint: text("evidence_fingerprint").notNull(),
  observedProviderVersion: text("observed_provider_version").notNull(),
  observedModel: text("observed_model").notNull(),
  observedEffort: text("observed_effort"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  qualifiedByUserId: text("qualified_by_user_id").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByUserId: text("revoked_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  request: uniqueIndex("model_profile_qualification_request_uq").on(table.companyId, table.requestKey),
  candidates: index("model_profile_qualification_candidates_idx").on(table.companyId, table.agentId, table.accountFingerprint, table.validUntil),
  state: check("model_profile_qualification_state_check", sql`${table.state} in ('access_verified','workflow_qualified') and ${table.validUntil} > ${table.observedAt}`),
}));
