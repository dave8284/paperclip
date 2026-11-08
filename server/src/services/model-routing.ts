import { eq } from "drizzle-orm";
import { taskFamilyCatalog } from "@agentos/model-intelligence";
import { activityLog, companies, type Db } from "@paperclipai/db";
import { configureModelRoutingSchema, rollbackModelRoutingSchema, type ConfigureModelRouting, type RollbackModelRouting, type ModelRoutingDiscovery } from "@paperclipai/shared";
import { conflict } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertModelComparisonOwner } from "./model-comparisons.js";
import { modelIntelligenceProduct } from "./model-intelligence.js";
import { modelProfileDigest } from "./model-profile-binding.js";
import { nativeModelRoutingAuthority } from "./model-routing-authority.js";
import { persistActivity, publishActivity } from "./activity-log.js";
import type { ActivityPublication } from "../types/activity-publication.js";

export function modelRoutingService(db: Db) {
  const product = () => { const value = modelIntelligenceProduct(); if (!value) throw conflict("Model Intelligence is not configured"); return value; };
  async function mutate<T>(operation: () => T | Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) {
      // Store policy/evidence conflicts are reviewable 409s; database/system
      // failures retain their original error and retry classification.
      if (error instanceof Error && error.constructor === Error && !("code" in error)) throw conflict(error.message);
      throw error;
    }
  }
  return {
    async discover(companyId: string, actor: AuthorizationActor): Promise<ModelRoutingDiscovery> {
      return db.transaction(async connection => {
        const tx = connection as unknown as Db;
        await assertModelComparisonOwner(tx, companyId, actor);
        const engine = modelIntelligenceProduct();
        if (!engine) return { enabled: false, families: [] };
        const families: ModelRoutingDiscovery["families"] = [];
        for (const family of taskFamilyCatalog()) {
          const report = await engine.routingRollouts({ namespace: companyId, taskType: family.id });
          families.push({ id: family.id, name: family.name,
            policy: report.policy ? { revision: report.policy.revision, mode: report.policy.mode, pinnedReleaseId: report.policy.pinnedReleaseId,
              limits: report.policy.limits, authorityCurrent: await nativeModelRoutingAuthority(tx, companyId, report.policy) } : null,
            releases: report.releases.map(item => ({ id: item.id, version: item.version, state: item.state, baselineModel: item.baseline.model,
              candidateModel: item.candidate.model, createdAt: item.createdAt })), events: report.events });
        }
        return { enabled: true, families };
      });
    },
    async configure(companyId: string, actor: AuthorizationActor, supplied: ConfigureModelRouting) {
      const input = configureModelRoutingSchema.parse(supplied);
      let publication: ActivityPublication | null = null;
      const result = await db.transaction(async connection => {
        const tx = connection as unknown as Db, userId = await assertModelComparisonOwner(tx, companyId, actor);
        await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
        const { requestKey, ...settings } = input;
        const engine = product();
        if (!taskFamilyCatalog().some(family => family.id === input.taskType)) throw conflict("Choose a supported task family");
        const policy = await mutate(() => engine.configureRoutingPolicy({ ...settings, namespace: companyId, id: requestKey }));
        const fingerprint = modelProfileDigest(policy);
        const [existing] = await tx.select().from(activityLog).where(eq(activityLog.id, requestKey)).limit(1);
        if (existing) {
          if (existing.companyId !== companyId || existing.actorId !== userId || existing.action !== "model_routing.policy_configured"
            || existing.details?.policyFingerprint !== fingerprint) throw conflict("This request key belongs to a different routing policy action");
        } else {
          ({ publication } = await persistActivity(tx, { id: requestKey, companyId, actorType: "user", actorId: userId,
            responsibleUserIdOverride: userId, action: "model_routing.policy_configured", entityType: "model_routing_policy", entityId: input.taskType,
            details: { policyFingerprint: fingerprint, revision: policy.revision, mode: policy.mode, reason: policy.reason } }));
        }
        return { revision: policy.revision, mode: policy.mode };
      });
      if (publication) publishActivity(publication);
      return result;
    },
    async rollback(companyId: string, actor: AuthorizationActor, supplied: RollbackModelRouting) {
      const input = rollbackModelRoutingSchema.parse(supplied);
      let publication: ActivityPublication | null = null;
      const result = await db.transaction(async connection => {
        const tx = connection as unknown as Db, userId = await assertModelComparisonOwner(tx, companyId, actor);
        await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
        const fingerprint = modelProfileDigest(input);
        const [existing] = await tx.select().from(activityLog).where(eq(activityLog.id, input.requestKey)).limit(1);
        if (existing && (existing.companyId !== companyId || existing.actorId !== userId || existing.details?.requestFingerprint !== fingerprint)) throw conflict("This request key belongs to a different routing action");
        const item = await mutate(() => product().rollbackRoutingRelease({ namespace: companyId, releaseId: input.releaseId, reason: input.reason }));
        if (!existing) ({ publication } = await persistActivity(tx, { id: input.requestKey, companyId, actorType: "user", actorId: userId,
          responsibleUserIdOverride: userId, action: "model_routing.rolled_back", entityType: "model_routing_release", entityId: item.id,
          details: { requestFingerprint: fingerprint, version: item.version, reason: input.reason } }));
        return { releaseId: item.id, state: item.state };
      });
      if (publication) publishActivity(publication);
      return result;
    },
  };
}
