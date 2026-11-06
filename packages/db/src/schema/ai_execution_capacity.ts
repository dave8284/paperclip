import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, boolean, timestamp, index, check, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { connectionGrants, toolConnections } from "./tool_access.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

/** Private instance administration. Group membership is explicit, never inferred
 * from company billing identities, plan labels, credentials or model names. */
export const aiExecutionCapacityGroups = pgTable("ai_execution_capacity_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  maxConcurrent: integer("max_concurrent").notNull(),
  interactiveReserved: integer("interactive_reserved").notNull(),
  interactivePriority: boolean("interactive_priority").notNull(),
  waitWarningMs: integer("wait_warning_ms").notNull(),
  revision: integer("revision").notNull().default(1),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  limits: check("ai_execution_capacity_group_limits", sql`${table.maxConcurrent} between 1 and 32 and ${table.interactiveReserved} >= 0 and ${table.interactiveReserved} < ${table.maxConcurrent} and ${table.waitWarningMs} between 1000 and 86400000 and ${table.revision} > 0`),
}));

export const aiExecutionCapacityBindings = pgTable("ai_execution_capacity_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull().references(() => aiExecutionCapacityGroups.id),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull().references(() => toolConnections.id, { onDelete: "cascade" }),
  grantId: uuid("grant_id").notNull().references(() => connectionGrants.id, { onDelete: "cascade" }),
}, table => ({
  grant: uniqueIndex("ai_execution_capacity_binding_grant_uq").on(table.grantId),
  group: index("ai_execution_capacity_binding_group_idx").on(table.groupId),
}));

/** Reservations survive controller loss. A terminal run or elapsed deadline
 * alone does not prove that an admitted provider stopped. */
export const aiExecutionCapacityClaims = pgTable("ai_execution_capacity_claims", {
  runId: uuid("run_id").primaryKey().references(() => heartbeatRuns.id),
  groupId: uuid("group_id").notNull().references(() => aiExecutionCapacityGroups.id),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  grantId: uuid("grant_id").notNull(),
  interactive: boolean("interactive").notNull(),
  queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
  warningAt: timestamp("warning_at", { withTimezone: true }).notNull(),
  warnedAt: timestamp("warned_at", { withTimezone: true }),
  admittedAt: timestamp("admitted_at", { withTimezone: true }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  releaseReason: text("release_reason"),
}, table => ({
  pending: index("ai_execution_capacity_claim_pending_idx").on(table.groupId, table.queuedAt, table.runId).where(sql`${table.releasedAt} is null`),
  company: index("ai_execution_capacity_claim_company_idx").on(table.companyId, table.runId),
}));
