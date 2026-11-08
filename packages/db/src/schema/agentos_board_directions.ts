import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, foreignKey, unique, index, check } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { issues } from "./issues.js";
import { companies } from "./companies.js";

// Source-only authority/provenance and durable delivery. Native work and its
// execution remain wholly in targetCompanyId; never a foreign task parent.
export const agentosBoardDirections = pgTable("agentos_board_directions", {
  id: uuid("id").primaryKey(), sourceCompanyId: uuid("source_company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sourceAgentId: uuid("source_agent_id").notNull(), sourceRunId: uuid("source_run_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(), authorizingUserId: text("authorizing_user_id"),
  mandateId: uuid("mandate_id").notNull(), mandateRevision: integer("mandate_revision").notNull(), grantId: uuid("grant_id").notNull(),
  targetCompanyId: uuid("target_company_id").notNull(), executiveAgentId: uuid("executive_agent_id").notNull(), issueId: uuid("issue_id").notNull(),
  expectedIssueStatusVersion: integer("expected_issue_status_version").notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(), inputFingerprint: text("input_fingerprint").notNull(),
  wakeupRequestId: uuid("wakeup_request_id").notNull(),
  dispatchState: text("dispatch_state").$type<"pending" | "dispatched" | "cancelled">().notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
}, table => ({
  source: foreignKey({ name: "agentos_board_directions_source_fk", columns: [table.sourceCompanyId, table.sourceAgentId], foreignColumns: [agents.companyId, agents.id] }).onDelete("cascade"),
  task: foreignKey({ name: "agentos_board_directions_task_fk", columns: [table.targetCompanyId, table.issueId], foreignColumns: [issues.companyId, issues.id] }).onDelete("cascade"),
  executive: foreignKey({ name: "agentos_board_directions_executive_fk", columns: [table.targetCompanyId, table.executiveAgentId], foreignColumns: [agents.companyId, agents.id] }),
  intent: unique("agentos_board_directions_intent_uq").on(table.sourceCompanyId, table.sourceAgentId, table.idempotencyKey),
  wake: unique("agentos_board_directions_wake_uq").on(table.wakeupRequestId),
  due: index("agentos_board_directions_due_idx").on(table.nextAttemptAt, table.id).where(sql`${table.dispatchState} = 'pending'`),
  state: check("agentos_board_directions_state_check", sql`${table.dispatchState} in ('pending', 'dispatched', 'cancelled') and ${table.mandateRevision} > 0 and ${table.attemptCount} >= 0`),
}));
