import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

// Instance administration has no customer-company owner. Keep its evidence
// outside company timelines and expose it only through instance-admin routes.
export const agentosAdminEvents = pgTable("agentos_admin_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: text("actor_user_id").notNull(),
  targetUserId: text("target_user_id"),
  action: text("action").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ chronological: index("agentos_admin_events_created_idx").on(t.createdAt) }));

// An administrator can preapprove a verified email without creating a password
// or pretending that an OAuth identity has already proved ownership.
export const agentosUserInvitations = pgTable("agentos_user_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ email: uniqueIndex("agentos_user_invitations_email_uq").on(t.email) }));
