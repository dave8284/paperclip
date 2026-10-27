import { pgTable, uuid, text, integer, timestamp, jsonb, boolean, foreignKey, index } from "drizzle-orm/pg-core";
import type { PerformanceValues } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
export const companyPerformanceReports = pgTable("company_performance_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id"), period: text("period").notNull(), currency: text("currency"), basis: text("basis").notNull(),
  values: jsonb("values").$type<PerformanceValues>().notNull(),
  revenueComplete: boolean("revenue_complete").notNull().default(false), costsComplete: boolean("costs_complete").notNull().default(false),
  sourceLabel: text("source_label").notNull(), evidenceRef: text("evidence_ref").notNull(),
  revision: integer("revision").notNull(), createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  project: foreignKey({ columns: [table.companyId, table.projectId], foreignColumns: [projects.companyId, projects.id] }).onDelete("cascade"),
  period: index("company_performance_period_idx").on(table.companyId, table.period, table.projectId),
}));
