import { integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

// Configuration only. Native conversations, tasks, routines and grants remain
// the owners of execution. Deleting Friday clears the binding but retains the
// organization's model policy. The service validates the agent's company, as
// native project lead bindings do, before changing the binding and grants.
export const companyOperatingProfiles = pgTable("company_operating_profiles", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  fridayAgentId: uuid("friday_agent_id").references(() => agents.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
