import { pgTable, uuid, text, integer, timestamp, unique, foreignKey, primaryKey } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { agents } from "./agents.js";

// Grouping metadata only: native projects still own access, work and execution.
export const agentosDepartments = pgTable("agentos_departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  leadAgentId: uuid("lead_agent_id"),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  identity: unique("agentos_departments_company_id_uq").on(table.companyId, table.id),
  name: unique("agentos_departments_name_uq").on(table.companyId, table.name),
  lead: foreignKey({ name: "agentos_departments_company_lead_fk", columns: [table.companyId, table.leadAgentId], foreignColumns: [agents.companyId, agents.id] }),
}));
export const agentosDepartmentProjects = pgTable("agentos_department_projects", {
  companyId: uuid("company_id").notNull(),
  departmentId: uuid("department_id").notNull(),
  projectId: uuid("project_id").notNull(),
}, table => ({
  identity: primaryKey({ columns: [table.companyId, table.projectId] }),
  department: foreignKey({ columns: [table.companyId, table.departmentId], foreignColumns: [agentosDepartments.companyId, agentosDepartments.id] }).onDelete("cascade"),
  project: foreignKey({ columns: [table.companyId, table.projectId], foreignColumns: [projects.companyId, projects.id] }).onDelete("cascade"),
}));
