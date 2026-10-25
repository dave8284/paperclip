import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, index, unique, foreignKey, primaryKey, check } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

// The home project's existing ACL is the application's audience. Linking another
// project never grants access to that project or its tasks.
export const managedApplications = pgTable("managed_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  homeProjectId: uuid("home_project_id").notNull(),
  name: text("name").notNull(),
  brief: text("brief").notNull(),
  source: text("source").notNull(),
  stage: text("stage").notNull().default("discovery"),
  kind: text("kind").notNull().default("application"),
  creationKey: text("creation_key").notNull(),
  creationHash: text("creation_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  companyIdUq: unique("managed_applications_company_id_uq").on(table.companyId, table.id),
  creationKeyUq: unique("managed_applications_creation_key_uq").on(table.companyId, table.creationKey),
  homeProjectUq: unique("managed_applications_home_project_uq").on(table.companyId, table.homeProjectId),
  companyIdx: index("managed_applications_company_idx").on(table.companyId, table.id),
  homeProjectFk: foreignKey({ columns: [table.companyId, table.homeProjectId], foreignColumns: [projects.companyId, projects.id] }).onDelete("cascade"),
  stageCheck: check("managed_applications_stage_check", sql`${table.stage} in ('discovery', 'building', 'operating', 'archived')`),
  sourceCheck: check("managed_applications_source_check", sql`${table.source} in ('existing', 'new')`),
  kindCheck: check("managed_applications_kind_check", sql`${table.kind} in ('application', 'platform')`),
}));

export const managedApplicationProjects = pgTable("managed_application_projects", {
  companyId: uuid("company_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  projectId: uuid("project_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  pk: primaryKey({ columns: [table.applicationId, table.projectId] }),
  applicationFk: foreignKey({ columns: [table.companyId, table.applicationId], foreignColumns: [managedApplications.companyId, managedApplications.id] }).onDelete("cascade"),
  projectFk: foreignKey({ columns: [table.companyId, table.projectId], foreignColumns: [projects.companyId, projects.id] }).onDelete("cascade"),
  projectIdx: index("managed_application_projects_project_idx").on(table.companyId, table.projectId),
}));
