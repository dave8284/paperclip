import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { agents, companyMemberships, companySkills, companySkillTestRuns, companySkillVersions,
  agentosAssignments, agentosEmployees, agentosCapabilityReleases, agentosCapabilityDecisions, type Db } from "@paperclipai/db";
import { AGENTOS_CAPABILITY_SKILL_PREFIX, type AgentosCapabilities, type AgentosCapabilityRelease,
  type PublishAgentosCapability, type DecideAgentosCapability, type SkillPolicyAction } from "@paperclipai/shared";
import { readPaperclipSkillSyncPreference, writePaperclipSkillSyncPreference } from "@paperclipai/adapter-utils/server-utils";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { accessService } from "./access.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { persistActivity, type ActivityPublication, type LogActivityInput } from "./activity-log.js";
import { agentosWorkforceService, refreshWorkforceBoardActor } from "./agentos-workforce.js";
import { companySkillService } from "./company-skills.js";
import { lockCompanySkillPolicy, normalizeSkillPolicySourceType } from "./company-skill-policy.js";
import { assertCompanySkillMutation } from "./skill-mutation-authorization.js";
import { withSkillVersionCacheLock } from "./skill-version-cache.js";
import { updateAgentConfigurationInTransaction } from "./agent-configuration-transaction.js";

type Who = Pick<LogActivityInput, "actorType" | "actorId" | "agentId" | "runId">;
type Release = typeof agentosCapabilityReleases.$inferSelect;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function capabilitySkillPolicyActions(action: "adopt" | "rollback", hasSkill: boolean, hasVersion: boolean): SkillPolicyAction[] {
  if (action === "rollback") return ["skills.reset"];
  if (hasVersion) return ["skills.install"];
  // Initial cross-company import creates a local skill; a later release both
  // updates its working bytes and creates an immutable native version.
  return hasSkill ? ["skills.update", "skills.edit", "skills.create", "skills.install"] : ["skills.import", "skills.create", "skills.install"];
}
export function capabilitySelectionHash(config: Record<string, unknown>) {
  return hash(JSON.stringify(readPaperclipSkillSyncPreference(config).desiredSkillEntries
    .map(entry => ({ key: entry.key, versionId: entry.versionId })).sort((a, b) => a.key.localeCompare(b.key))));
}
export function reviewedCapabilityMarkdown(version: { repositorySnapshotId?: string | null; fileInventory: Array<{ path: string; content: string; encoding?: string; executable?: boolean }> }) {
  const [file] = version.fileInventory;
  if (version.repositorySnapshotId || version.fileInventory.length !== 1 || file?.path !== "SKILL.md"
    || file.encoding === "base64" || file.executable || !file.content.trim() || Buffer.byteLength(file.content) > 65536
    || file.content.includes("\0")) throw unprocessable("Publish a reviewed Markdown-only SKILL.md version, up to 64 KiB, without scripts or repository files.");
  return file.content;
}
export function publicCapabilityRelease(row: Release): AgentosCapabilityRelease {
  return { id: row.id, employeeId: row.employeeId, capabilityKey: row.capabilityKey, revision: row.revision,
    name: row.name, markdown: row.markdown, contentHash: row.contentHash, evaluationSummary: row.evaluationSummary,
    createdAt: row.createdAt.toISOString() };
}

export function agentosCapabilityService(db: Db) {
  const workforce = agentosWorkforceService(db);
  async function freshActor(tx: Db, actor: AuthorizationActor, companyId: string) {
    actor = await refreshWorkforceBoardActor(tx, actor);
    const memberships = actor.source === "local_implicit" ? actor.memberships : await tx.select().from(companyMemberships)
      .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, actor.userId ?? ""), eq(companyMemberships.status, "active")));
    return { ...actor, memberships };
  }
  async function audit(tx: Db, publications: ActivityPublication[], who: Who, companyId: string, action: string, id: string, details: Record<string, unknown>) {
    const receipt = await persistActivity(tx, { ...who, companyId, action, entityType: "agentos_capability", entityId: id, details });
    publications.push(receipt.publication);
  }
  async function assertConfigure(tx: Db, actor: AuthorizationActor, companyId: string, agentId: string) {
    const decision = await accessService(tx).decide({ actor, action: "agent_config:update",
      resource: { type: "agent", companyId, agentId }, scope: { targetAgentId: agentId } });
    if (!decision.allowed) throw forbidden("Capability adoption requires permission to configure this company agent");
  }
  return {
    async read(actor: AuthorizationActor, portfolioId: string, employeeId: string, offset = 0): Promise<AgentosCapabilities> {
      const overview = await workforce.read(actor, portfolioId);
      if (!overview.employees.some(employee => employee.id === employeeId)) throw notFound("Employee not found");
      const page = await db.select().from(agentosCapabilityReleases).where(and(
        eq(agentosCapabilityReleases.portfolioId, portfolioId), eq(agentosCapabilityReleases.employeeId, employeeId),
      )).orderBy(desc(agentosCapabilityReleases.createdAt), desc(agentosCapabilityReleases.id)).limit(101).offset(offset);
      const releases = page.slice(0, 100);
      const latest = await db.select({ key: agentosCapabilityReleases.capabilityKey, revision: sql<number>`max(${agentosCapabilityReleases.revision})` })
        .from(agentosCapabilityReleases).where(and(eq(agentosCapabilityReleases.portfolioId, portfolioId), eq(agentosCapabilityReleases.employeeId, employeeId)))
        .groupBy(agentosCapabilityReleases.capabilityKey);
      const assignments: AgentosCapabilities["assignments"] = [];
      for (const assignment of overview.assignments.filter(row => row.employeeId === employeeId && row.status === "active")) {
        const currentActor = await freshActor(db, actor, assignment.companyId);
        const access = accessService(db);
        const read = await access.decide({ actor: currentActor, action: "agent_config:read", resource: { type: "agent", companyId: assignment.companyId, agentId: assignment.agentId } });
        if (!read.allowed) continue;
        const [agent] = await db.select({ config: agents.adapterConfig }).from(agents).where(and(eq(agents.id, assignment.agentId), eq(agents.companyId, assignment.companyId)));
        if (!agent) continue;
        const decisions = await db.select().from(agentosCapabilityDecisions).where(and(
          eq(agentosCapabilityDecisions.companyId, assignment.companyId), eq(agentosCapabilityDecisions.assignmentId, assignment.id),
        )).orderBy(desc(agentosCapabilityDecisions.createdAt)).limit(100);
        const selectedEntries = readPaperclipSkillSyncPreference(agent.config).desiredSkillEntries;
        const versionIds = [...new Set(selectedEntries.filter(entry => entry.key.startsWith(AGENTOS_CAPABILITY_SKILL_PREFIX) && entry.versionId).map(entry => entry.versionId!))];
        const pinnedVersions = versionIds.length ? await db.select({ id: companySkillVersions.id, releaseId: companySkillVersions.releaseId }).from(companySkillVersions)
          .where(and(eq(companySkillVersions.companyId, assignment.companyId), inArray(companySkillVersions.id, versionIds))) : [];
        const missingReleaseIds = pinnedVersions.map(row => row.releaseId).filter((id): id is string => !!id && /^[a-f0-9-]{36}$/i.test(id) && !releases.some(row => row.id === id));
        if (missingReleaseIds.length) releases.push(...await db.select().from(agentosCapabilityReleases).where(and(
          eq(agentosCapabilityReleases.portfolioId, portfolioId), eq(agentosCapabilityReleases.employeeId, employeeId), inArray(agentosCapabilityReleases.id, missingReleaseIds))));
        const selected: AgentosCapabilities["assignments"][number]["selected"] = [];
        for (const version of pinnedVersions) {
          const release = releases.find(row => row.id === version.releaseId);
          if (!release) continue;
          if (selectedEntries.some(entry => entry.key === `${AGENTOS_CAPABILITY_SKILL_PREFIX}${employeeId}:${release.capabilityKey}` && entry.versionId === version.id)) {
            selected.push({ capabilityKey: release.capabilityKey, releaseId: release.id, versionId: version.id });
          }
        }
        const configure = await access.decide({ actor: currentActor, action: "agent_config:update", resource: { type: "agent", companyId: assignment.companyId, agentId: assignment.agentId }, scope: { targetAgentId: assignment.agentId } });
        assignments.push({ assignmentId: assignment.id, companyId: assignment.companyId, revision: assignment.revision,
          selectionHash: capabilitySelectionHash(agent.config), canManage: overview.canManage && overview.companies.some(row => row.id === assignment.companyId && row.canManage) && configure.allowed,
          selected, previouslyAdoptedReleaseIds: [], decisions: decisions.map(row => ({ id: row.id, releaseId: row.releaseId, action: row.action as "adopt" | "refuse" | "rollback",
            reason: row.reason, importedSkillId: row.importedSkillId, importedVersionId: row.importedVersionId, createdAt: row.createdAt.toISOString() })) });
      }
      for (const assignment of assignments) {
        const prior = releases.length ? await db.selectDistinct({ releaseId: agentosCapabilityDecisions.releaseId }).from(agentosCapabilityDecisions).where(and(
          eq(agentosCapabilityDecisions.companyId, assignment.companyId), eq(agentosCapabilityDecisions.assignmentId, assignment.assignmentId),
          inArray(agentosCapabilityDecisions.releaseId, releases.map(row => row.id)), inArray(agentosCapabilityDecisions.action, ["adopt", "rollback"]))) : [];
        assignment.previouslyAdoptedReleaseIds = prior.map(row => row.releaseId);
      }
      return { releases: releases.map(publicCapabilityRelease), assignments, canPublish: overview.canManage, releaseOffset: offset, hasMoreReleases: page.length > 100,
        latestRevisions: Object.fromEntries(latest.map(row => [row.key, Number(row.revision)])) };
    },

    async publish(actor: AuthorizationActor, who: Who, portfolioId: string, input: PublishAgentosCapability) {
      // The immutable test receipt supplies the target row for native authority
      // locking. Its private issue/output are never included in public views.
      const [knownTest] = await db.select().from(companySkillTestRuns).where(and(eq(companySkillTestRuns.id, input.sourceTestRunId), eq(companySkillTestRuns.companyId, input.sourceCompanyId)));
      if (!knownTest) throw notFound("Reviewed skill test not found");
      return workforce.mutateCapabilities(actor, portfolioId, input.sourceCompanyId, knownTest.agentId, async (tx, publications, owner) => {
        const currentActor = await freshActor(tx, actor, input.sourceCompanyId);
        const [employee] = await tx.select().from(agentosEmployees).where(and(eq(agentosEmployees.id, input.employeeId), eq(agentosEmployees.portfolioId, portfolioId))).for("update");
        if (!employee) throw notFound("Employee not found");
        const skills = companySkillService(tx, { actor: currentActor });
        await tx.select({ id: companySkills.id }).from(companySkills).where(and(eq(companySkills.companyId, input.sourceCompanyId), eq(companySkills.id, input.sourceSkillId))).for("share", { noWait: true });
        const version = await skills.getVersion(input.sourceCompanyId, input.sourceSkillId, input.sourceVersionId);
        if (!version) throw notFound("Source skill version not found");
        const [test] = await tx.select().from(companySkillTestRuns).where(and(eq(companySkillTestRuns.id, input.sourceTestRunId), eq(companySkillTestRuns.companyId, input.sourceCompanyId))).for("share", { noWait: true });
        const readable = test && await authorizationService(tx).decideReads(currentActor, [{ type: "issue", companyId: input.sourceCompanyId, issueId: test.issueId }]);
        if (!test || !readable?.[0]?.allowed || test.skillId !== input.sourceSkillId || test.skillVersionId !== input.sourceVersionId
          || test.status !== "succeeded" || test.deletedAt || test.harnessIssueDeletedAt || test.supersededAt || !test.outputSnapshot.trim()) {
          throw unprocessable("Choose a completed, readable test of this exact skill version with retained output, then review its result.");
        }
        const markdown = reviewedCapabilityMarkdown(version);
        const [existing] = await tx.select().from(agentosCapabilityReleases).where(eq(agentosCapabilityReleases.id, input.id));
        if (existing) {
          if (existing.portfolioId !== portfolioId || existing.employeeId !== input.employeeId || existing.capabilityKey !== input.capabilityKey
            || existing.revision !== input.expectedLatestRevision + 1 || existing.sourceTestRunId !== input.sourceTestRunId
            || existing.sourceVersionId !== input.sourceVersionId || existing.name !== input.name || existing.evaluationSummary !== input.evaluationSummary
            || existing.markdown !== markdown || existing.reviewedByUserId !== (actor.userId ?? "local-board")) throw conflict("This request already published a different capability release");
          return publicCapabilityRelease(existing);
        }
        const [latest] = await tx.select({ revision: agentosCapabilityReleases.revision }).from(agentosCapabilityReleases)
          .where(and(eq(agentosCapabilityReleases.employeeId, input.employeeId), eq(agentosCapabilityReleases.capabilityKey, input.capabilityKey)))
          .orderBy(desc(agentosCapabilityReleases.revision)).limit(1);
        if ((latest?.revision ?? 0) !== input.expectedLatestRevision) throw conflict("A newer capability was published. Refresh before publishing.");
        const [release] = await tx.insert(agentosCapabilityReleases).values({ id: input.id, portfolioId, employeeId: input.employeeId,
          capabilityKey: input.capabilityKey, revision: input.expectedLatestRevision + 1, name: input.name, markdown,
          contentHash: hash(markdown), evaluationSummary: input.evaluationSummary, sourceCompanyId: input.sourceCompanyId,
          sourceSkillId: input.sourceSkillId, sourceVersionId: input.sourceVersionId, sourceTestRunId: input.sourceTestRunId,
          reviewedByUserId: actor.userId ?? "local-board" }).returning();
        // Public audit contains only the deliberately shared release, never a
        // private source task, test output, or evidence reference.
        await audit(tx, publications, who, owner.homeCompanyId, "agentos.capability_published", release.id,
          { employeeId: release.employeeId, capabilityKey: release.capabilityKey, revision: release.revision, contentHash: release.contentHash });
        return publicCapabilityRelease(release);
      });
    },

    async decide(actor: AuthorizationActor, who: Who, portfolioId: string, assignmentId: string, input: DecideAgentosCapability) {
      const [known] = await db.select().from(agentosAssignments).where(and(eq(agentosAssignments.id, assignmentId), eq(agentosAssignments.portfolioId, portfolioId)));
      if (!known) throw notFound("Assignment not found");
      // Native runtime preparation/retention shares this lock. Capture and
      // configuration commits cannot race version cache reclamation.
      return withSkillVersionCacheLock(db, known.companyId, () => workforce.mutateCapabilities(actor, portfolioId, known.companyId, known.agentId, async (tx, publications) => {
        const currentActor = await freshActor(tx, actor, known.companyId);
        await assertConfigure(tx, currentActor, known.companyId, known.agentId);
        const [assignment] = await tx.select().from(agentosAssignments).where(and(eq(agentosAssignments.id, assignmentId), eq(agentosAssignments.portfolioId, portfolioId))).for("update");
        const [agent] = await tx.select().from(agents).where(and(eq(agents.id, known.agentId), eq(agents.companyId, known.companyId))).for("update");
        if (!assignment || assignment.status !== "active" || !agent || agent.lifecycleState !== "ready" || ["terminated", "pending_approval"].includes(agent.status)) throw conflict("Choose an active, available employee assignment");
        const [release] = await tx.select().from(agentosCapabilityReleases).where(and(eq(agentosCapabilityReleases.id, input.releaseId),
          eq(agentosCapabilityReleases.portfolioId, portfolioId), eq(agentosCapabilityReleases.employeeId, assignment.employeeId)));
        if (!release) throw notFound("Capability release not found");
        const [existing] = await tx.select().from(agentosCapabilityDecisions).where(eq(agentosCapabilityDecisions.id, input.id));
        if (existing) {
          if (existing.assignmentId !== assignmentId || existing.releaseId !== input.releaseId || existing.action !== input.action || existing.reason !== input.reason
            || existing.expectedAssignmentRevision !== input.expectedAssignmentRevision || existing.expectedSelectionHash !== input.expectedSelectionHash
            || existing.actorUserId !== (actor.userId ?? "local-board")) throw conflict("This request already recorded a different capability decision");
          return { id: existing.id };
        }
        if (assignment.revision !== input.expectedAssignmentRevision || capabilitySelectionHash(agent.adapterConfig) !== input.expectedSelectionHash) throw conflict("The assignment or selected skills changed. Refresh before deciding.");
        let imported: { skillId: string; key: string; versionId: string } | null = null;
        if (input.action !== "refuse") {
          if (agent.adapterType !== "paperclip_runner" || ["openai_dot", "grok_bot"].includes(String(agent.adapterConfig.provider))) {
            throw unprocessable("Reviewed capability adoption currently requires a skills-capable native Paperclip Runner agent.");
          }
          // Hold an existing policy against concurrent edits, and evaluate the
          // native board policy. Publication never grants target-company use.
          await lockCompanySkillPolicy(tx, known.companyId);
          const key = `${AGENTOS_CAPABILITY_SKILL_PREFIX}${assignment.employeeId}:${release.capabilityKey}`;
          const [existingSkill] = await tx.select().from(companySkills).where(and(eq(companySkills.companyId, known.companyId), eq(companySkills.key, key))).for("update");
          const [existingVersion] = existingSkill ? await tx.select({ id: companySkillVersions.id }).from(companySkillVersions).where(and(
            eq(companySkillVersions.companyId, known.companyId), eq(companySkillVersions.companySkillId, existingSkill.id), eq(companySkillVersions.releaseId, release.id))) : [];
          const resource = { skillKey: key, ...(existingSkill ? { skillId: existingSkill.id } : {}),
            sourceType: normalizeSkillPolicySourceType(existingSkill?.sourceType ?? "generated"),
            ...(existingSkill?.sourceLocator ? { sourceLocator: existingSkill.sourceLocator } : {}) };
          const actions = capabilitySkillPolicyActions(input.action, !!existingSkill, !!existingVersion);
          for (const action of actions) await assertCompanySkillMutation(tx, currentActor, known.companyId, action, resource);
          if (hash(release.markdown) !== release.contentHash) throw conflict("Published capability integrity check failed");
          if (input.action === "rollback") {
            const [prior] = await tx.select().from(agentosCapabilityDecisions).where(and(eq(agentosCapabilityDecisions.assignmentId, assignmentId),
              eq(agentosCapabilityDecisions.releaseId, release.id), inArray(agentosCapabilityDecisions.action, ["adopt", "rollback"]))).limit(1);
            if (!prior?.importedSkillId || !prior.importedVersionId) throw conflict("Rollback requires a release previously adopted by this assignment");
            const [version] = await tx.select().from(companySkillVersions).where(and(eq(companySkillVersions.id, prior.importedVersionId), eq(companySkillVersions.companyId, known.companyId), eq(companySkillVersions.companySkillId, prior.importedSkillId)));
            if (!version || hash(reviewedCapabilityMarkdown(version)) !== release.contentHash) throw conflict("The earlier capability version is unavailable or changed");
            imported = { skillId: prior.importedSkillId, versionId: prior.importedVersionId, key: `${AGENTOS_CAPABILITY_SKILL_PREFIX}${assignment.employeeId}:${release.capabilityKey}` };
          } else {
            imported = await companySkillService(tx, { actor: currentActor }).importReviewedMarkdownRelease(tx, known.companyId,
              { employeeId: assignment.employeeId, capabilityKey: release.capabilityKey, releaseId: release.id, name: release.name, markdown: release.markdown },
              { type: "user", userId: actor.userId ?? "local-board" });
          }
          const current = readPaperclipSkillSyncPreference(agent.adapterConfig).desiredSkillEntries;
          const selected = [...current.filter(entry => entry.key !== imported!.key), { key: imported.key, versionId: imported.versionId }];
          const updated = await updateAgentConfigurationInTransaction(tx, agent.id, {
            adapterConfig: writePaperclipSkillSyncPreference(agent.adapterConfig, selected),
          }, { expectedConfiguration: { adapterType: agent.adapterType, adapterConfig: agent.adapterConfig,
            defaultEnvironmentId: agent.defaultEnvironmentId, runtimeConfig: agent.runtimeConfig }, recordRevision: {
            createdByUserId: actor.userId ?? "local-board", createdByAgentId: null, source: `capability-${input.action}`,
          } });
          if (!updated) throw conflict("The company agent changed during capability adoption");
        }
        await tx.insert(agentosCapabilityDecisions).values({ ...input, companyId: known.companyId, assignmentId,
          importedSkillId: imported?.skillId ?? null, importedVersionId: imported?.versionId ?? null, actorUserId: actor.userId ?? "local-board" });
        await tx.update(agentosAssignments).set({ revision: assignment.revision + 1 }).where(eq(agentosAssignments.id, assignmentId));
        await audit(tx, publications, who, known.companyId, `agentos.capability_${input.action}`, input.id,
          { assignmentId, releaseId: release.id, capabilityKey: release.capabilityKey, revision: release.revision,
            contentHash: release.contentHash, reason: input.reason, versionId: imported?.versionId ?? null });
        return { id: input.id };
      }));
    },
  };
}
