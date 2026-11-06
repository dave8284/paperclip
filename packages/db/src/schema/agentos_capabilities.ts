import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, unique, foreignKey, check, index } from "drizzle-orm/pg-core";
import { agentosPortfolios, agentosEmployees, agentosAssignments } from "./agentos_workforce.js";
import { companies } from "./companies.js";
import { companySkills, companySkillVersions, companySkillTestRuns } from "./company_skills.js";

// Published bytes are deliberately reviewed for portfolio sharing. Private
// source evidence is retained separately and never included in release views.
export const agentosCapabilityReleases = pgTable("agentos_capability_releases", {
  id: uuid("id").primaryKey(),
  portfolioId: uuid("portfolio_id").notNull().references(() => agentosPortfolios.id),
  employeeId: uuid("employee_id").notNull(),
  capabilityKey: text("capability_key").notNull(),
  revision: integer("revision").notNull(),
  name: text("name").notNull(),
  markdown: text("markdown").notNull(),
  contentHash: text("content_hash").notNull(),
  evaluationSummary: text("evaluation_summary").notNull(),
  sourceCompanyId: uuid("source_company_id").notNull().references(() => companies.id),
  sourceSkillId: uuid("source_skill_id").notNull().references(() => companySkills.id),
  sourceVersionId: uuid("source_version_id").notNull().references(() => companySkillVersions.id),
  sourceTestRunId: uuid("source_test_run_id").notNull().references(() => companySkillTestRuns.id),
  reviewedByUserId: text("reviewed_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  employee: foreignKey({ name: "agentos_capability_release_employee_fk", columns: [table.portfolioId, table.employeeId], foreignColumns: [agentosEmployees.portfolioId, agentosEmployees.id] }),
  version: unique("agentos_capability_release_revision_uq").on(table.employeeId, table.capabilityKey, table.revision),
  revision: check("agentos_capability_release_revision_check", sql`${table.revision} > 0`),
  portfolio: index("agentos_capability_release_portfolio_idx").on(table.portfolioId, table.employeeId),
}));

export const agentosCapabilityDecisions = pgTable("agentos_capability_decisions", {
  id: uuid("id").primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  assignmentId: uuid("assignment_id").notNull().references(() => agentosAssignments.id, { onDelete: "cascade" }),
  releaseId: uuid("release_id").notNull().references(() => agentosCapabilityReleases.id),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  expectedAssignmentRevision: integer("expected_assignment_revision").notNull(),
  expectedSelectionHash: text("expected_selection_hash").notNull(),
  importedSkillId: uuid("imported_skill_id").references(() => companySkills.id),
  importedVersionId: uuid("imported_version_id").references(() => companySkillVersions.id),
  actorUserId: text("actor_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  action: check("agentos_capability_decision_action_check", sql`${table.action} in ('adopt', 'refuse', 'rollback')`),
  pin: check("agentos_capability_decision_pin_check", sql`(${table.action} = 'refuse' and ${table.importedSkillId} is null and ${table.importedVersionId} is null) or (${table.action} <> 'refuse' and ${table.importedSkillId} is not null and ${table.importedVersionId} is not null)`),
  history: index("agentos_capability_decision_history_idx").on(table.companyId, table.assignmentId, table.createdAt),
}));
