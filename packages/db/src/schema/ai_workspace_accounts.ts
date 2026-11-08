import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, boolean, timestamp, foreignKey, unique, index, check } from "drizzle-orm/pg-core";
import { authUsers } from "./auth.js";
import { connectionGrants } from "./tool_access.js";

/** Owner authorization and identity only. Credentials stay in the canonical
 * native connection; company links never contain a copied refresh token. */
export const aiWorkspaceAccounts = pgTable("ai_workspace_accounts", {
  id: uuid("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull().references(() => authUsers.id, { onDelete: "no action" }),
  sourceCompanyId: uuid("source_company_id").notNull(),
  sourceConnectionId: uuid("source_connection_id").notNull(),
  sourceGrantId: uuid("source_grant_id").notNull(),
  revision: integer("revision").notNull().default(1),
  enabled: boolean("enabled").notNull().default(true),
  autoInstall: boolean("auto_install").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({ name: "ai_workspace_accounts_source_fk",
    columns: [table.sourceCompanyId, table.sourceConnectionId, table.sourceGrantId],
    foreignColumns: [connectionGrants.companyId, connectionGrants.connectionId, connectionGrants.id],
  }).onDelete("no action"),
  unique("ai_workspace_accounts_source_grant_uq").on(table.sourceGrantId),
  index("ai_workspace_accounts_owner_idx").on(table.ownerUserId),
  check("ai_workspace_accounts_revision_check", sql`${table.revision} > 0`),
]);

/** A native company-local connection/grant is the execution authority. The
 * immutable account link identifies its credential owner, never company work. */
export const aiWorkspaceAccountLinks = pgTable("ai_workspace_account_links", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id").notNull().references(() => aiWorkspaceAccounts.id, { onDelete: "no action" }),
  companyId: uuid("company_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  grantId: uuid("grant_id").notNull(),
  revision: integer("revision").notNull().default(1),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({ name: "ai_workspace_account_links_target_fk",
    columns: [table.companyId, table.connectionId, table.grantId],
    foreignColumns: [connectionGrants.companyId, connectionGrants.connectionId, connectionGrants.id],
  }).onDelete("cascade"),
  unique("ai_workspace_account_links_account_company_uq").on(table.accountId, table.companyId),
  unique("ai_workspace_account_links_grant_uq").on(table.grantId),
  unique("ai_workspace_account_links_connection_uq").on(table.connectionId),
  index("ai_workspace_account_links_company_idx").on(table.companyId),
  check("ai_workspace_account_links_revision_check", sql`${table.revision} > 0`),
]);
