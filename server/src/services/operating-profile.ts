import { and, eq, sql } from "drizzle-orm";
import { agents, companyOperatingProfiles, type Db } from "@paperclipai/db";
import type { OperatingProfile, UpdateOperatingProfile } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../errors.js";
import { accessService } from "./access.js";
import { persistActivity, publishActivity, type LogActivityInput } from "./activity-log.js";
import type { AuthorizationActor } from "./authorization.js";

type MutationActor = Pick<LogActivityInput, "actorType" | "actorId" | "agentId" | "runId">;

export function operatingProfileService(db: Db) {
  async function read(companyId: string, connection: Db = db): Promise<OperatingProfile> {
    const [row] = await connection.select().from(companyOperatingProfiles).where(eq(companyOperatingProfiles.companyId, companyId));
    return { companyId, fridayAgentId: row?.fridayAgentId ?? null, revision: row?.revision ?? 0, modelBilling: "subscription_only" };
  }

  return {
    read,
    async update(companyId: string, actor: AuthorizationActor, who: MutationActor, input: UpdateOperatingProfile) {
      const result = await db.transaction(async transaction => {
        const tx = transaction as unknown as Db;
        const access = accessService(tx);
        // Binding Friday also grants portfolio mutation, so permission management
        // belongs to the same authority as other native principal grants.
        const decision = await access.decide({ actor, action: "users:manage_permissions", resource: { type: "company", companyId } });
        if (!decision.allowed) throw forbidden(decision.explanation);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`operating-profile:${companyId}`}, 0))`);
        const current = await read(companyId, tx);
        if (current.revision !== input.expectedRevision) throw conflict("Friday configuration changed. Refresh before saving.");
        if (input.fridayAgentId) {
          const [agent] = await tx.select().from(agents).where(and(eq(agents.id, input.fridayAgentId), eq(agents.companyId, companyId)));
          if (!agent) throw notFound("Agent not found");
          const readable = await access.decide({ actor, action: "agent:read", resource: { type: "agent", companyId, agentId: agent.id } });
          if (!readable.allowed) throw notFound("Agent not found");
          if (["terminated", "pending_approval"].includes(agent.status) || ["rejected", "deleting"].includes(agent.lifecycleState)) {
            throw conflict("Choose an approved, available agent for Friday");
          }
        }
        if (current.fridayAgentId === input.fridayAgentId) return { profile: current, publication: null };
        if (current.fridayAgentId) await access.setPrincipalPermission(companyId, "agent", current.fridayAgentId, "applications:manage", false, actor.userId ?? null);
        if (input.fridayAgentId) await access.setPrincipalPermission(companyId, "agent", input.fridayAgentId, "applications:manage", true, actor.userId ?? null);
        const profile = { companyId, fridayAgentId: input.fridayAgentId, revision: current.revision + 1 };
        await tx.insert(companyOperatingProfiles).values(profile).onConflictDoUpdate({
          target: companyOperatingProfiles.companyId, set: { ...profile, updatedAt: new Date() },
        });
        const { publication } = await persistActivity(tx, { ...who, companyId, action: "operating_profile.updated", entityType: "company", entityId: companyId,
          details: { fridayAgentId: profile.fridayAgentId, revision: profile.revision } });
        return { profile, publication };
      });
      if (result.publication) publishActivity(result.publication);
      return { ...result.profile, modelBilling: "subscription_only" as const };
    },
  };
}
