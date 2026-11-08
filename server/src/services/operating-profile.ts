import { and, eq, sql } from "drizzle-orm";
import { agents, companyOperatingProfiles, type Db } from "@paperclipai/db";
import type { OperatingProfile, UpdateOperatingProfile } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../errors.js";
import { accessService } from "./access.js";
import { persistActivity, publishActivity, type LogActivityInput } from "./activity-log.js";
import type { AuthorizationActor } from "./authorization.js";
import { agentExecutionsHaveStopped } from "./agent-execution-stop.js";

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
        // Binding changes the board-role ceiling. It requires native permission
        // management authority, but never grants operational write permissions.
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
        // Final native provider entry takes this same configuration lock in
        // shared mode. A new coordinator must first finish its existing work;
        // terminal status alone is not proof that providers/resources stopped.
        // Reuse lifecycle evidence without cancelling work or clearing owners.
        if (input.fridayAgentId && !await agentExecutionsHaveStopped(tx, [input.fridayAgentId], { readOnly: true })) {
          throw conflict("Wait for this employee's current work and cleanup to finish before making them Friday.", {
            code: "friday_execution_pending",
          });
        }
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
