import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, jsonb, timestamp, foreignKey, unique, check } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { agentosPortfolios, agentosPortfolioCompanies } from "./agentos_workforce.js";
import { principalPermissionGrants } from "./principal_permission_grants.js";

// Owner-scoped metadata plus a native grant; neither record is sufficient alone.
export const agentosPortfolioMandates = pgTable("agentos_portfolio_mandates", {
  id: uuid("id").primaryKey(),
  portfolioId: uuid("portfolio_id").notNull().references(() => agentosPortfolios.id),
  ownerUserId: text("owner_user_id").notNull(),
  sourceCompanyId: uuid("source_company_id").notNull(), sourceAgentId: uuid("source_agent_id").notNull(),
  grantId: uuid("grant_id").references(() => principalPermissionGrants.id, { onDelete: "set null" }),
  targetCompanyIds: jsonb("target_company_ids").$type<string[]>().notNull(),
  action: text("action").notNull(), readScope: text("read_scope").notNull(),
  revision: integer("revision").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }), revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  source: foreignKey({ name: "agentos_portfolio_mandates_source_fk", columns: [table.portfolioId, table.sourceCompanyId], foreignColumns: [agentosPortfolioCompanies.portfolioId, agentosPortfolioCompanies.companyId] }).onDelete("cascade"),
  agent: foreignKey({ name: "agentos_portfolio_mandates_agent_fk", columns: [table.sourceCompanyId, table.sourceAgentId], foreignColumns: [agents.companyId, agents.id] }).onDelete("cascade"),
  delegate: unique("agentos_portfolio_mandates_delegate_uq").on(table.sourceAgentId),
  scope: check("agentos_portfolio_mandates_scope_check", sql`${table.action} = 'portfolio_work:read' and ${table.readScope} = 'company_shared_only' and ${table.revision} > 0 and jsonb_typeof(${table.targetCompanyIds}) = 'array' and jsonb_array_length(${table.targetCompanyIds}) between 1 and 50`),
}));
