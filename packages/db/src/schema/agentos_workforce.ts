import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, unique, uniqueIndex, foreignKey, check, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

// Portfolio metadata is owner-scoped. Business data and execution remain in
// native company tables; membership here never grants native company access.
export const agentosPortfolios = pgTable("agentos_portfolios", {
  id: uuid("id").primaryKey().defaultRandom(),
  homeCompanyId: uuid("home_company_id").notNull().references(() => companies.id),
  ownerUserId: text("owner_user_id").notNull(),
  name: text("name").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({ owner: index("agentos_portfolios_owner_idx").on(table.ownerUserId) }));

export const agentosPortfolioCompanies = pgTable("agentos_portfolio_companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  portfolioId: uuid("portfolio_id").notNull().references(() => agentosPortfolios.id),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  company: unique("agentos_portfolio_companies_company_uq").on(table.companyId),
  membership: unique("agentos_portfolio_companies_membership_uq").on(table.portfolioId, table.companyId),
}));

export const agentosEmployees = pgTable("agentos_employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  portfolioId: uuid("portfolio_id").notNull().references(() => agentosPortfolios.id),
  name: text("name").notNull(),
  specialty: text("specialty").notNull().default(""),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  identity: unique("agentos_employees_portfolio_id_uq").on(table.portfolioId, table.id),
  portfolio: index("agentos_employees_portfolio_idx").on(table.portfolioId),
}));

export const agentosAssignments = pgTable("agentos_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  portfolioId: uuid("portfolio_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  companyId: uuid("company_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  department: text("department"),
  status: text("status").notNull().default("active"),
  revision: integer("revision").notNull().default(1),
  retirementReason: text("retirement_reason"),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  employee: foreignKey({ name: "agentos_assignments_employee_fk", columns: [table.portfolioId, table.employeeId], foreignColumns: [agentosEmployees.portfolioId, agentosEmployees.id] }),
  company: foreignKey({ name: "agentos_assignments_company_fk", columns: [table.portfolioId, table.companyId], foreignColumns: [agentosPortfolioCompanies.portfolioId, agentosPortfolioCompanies.companyId] }),
  runtime: foreignKey({ name: "agentos_assignments_agent_fk", columns: [table.companyId, table.agentId], foreignColumns: [agents.companyId, agents.id] }),
  agent: unique("agentos_assignments_agent_uq").on(table.agentId),
  activeEmployee: uniqueIndex("agentos_assignments_active_employee_uq").on(table.employeeId, table.companyId).where(sql`${table.status} = 'active'`),
  status: check("agentos_assignments_status_check", sql`${table.status} in ('active', 'retired')`),
  retirement: check("agentos_assignments_retirement_check", sql`(${table.status} = 'active' and ${table.retiredAt} is null and ${table.retirementReason} is null) or (${table.status} = 'retired' and ${table.retiredAt} is not null and ${table.retirementReason} is not null and length(${table.retirementReason}) > 0)`),
  companyLookup: index("agentos_assignments_company_idx").on(table.companyId, table.employeeId),
}));
