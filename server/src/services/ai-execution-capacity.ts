import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  aiExecutionCapacityGroups as groups, aiExecutionCapacityBindings as bindings,
  aiExecutionCapacityClaims as claims, agentosAdminEvents, companies, connectionGrants,
  toolConnections, heartbeatRuns, heartbeatRunEvents, authUsers, instanceUserRoles, companyMemberships, nativeRunFinalizations, type Db,
  aiWorkspaceAccounts, aiWorkspaceAccountLinks,
} from "@paperclipai/db";
import {
  aiConnectionMetadataSchema, aiExecutionCapacityPolicySchema, saveAiExecutionCapacitySchema,
  type AiExecutionCapacityOverview, type AiExecutionCapacityPolicy, type SaveAiExecutionCapacity,
  type AiConnectionAttribution,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../errors.js";
import { DELIVERY_QUEUES, notifyDeliveryWork, subscribeDeliveryWork } from "./delivery-work-notifications.js";
import { appendHeartbeatRunEvent } from "./heartbeat-run-events.js";
import { isCaseHandoffSourceReleased } from "./heartbeat/case-handoff-lifecycle.js";
import { hasPendingRunCleanup } from "./execution-blocker.js";
import { hasNativeLocalProcessStop, retainedNativeLocalExecutionStopped } from "./native-local-process-stop.js";
import { remoteExecutionHasStopped } from "./remote-execution-termination.js";
import { assertAdministration } from "./agentos-administration.js";
import { isCancelledNativeStartup } from "./cancelled-native-startup.js";
import { hasPendingAiCredentialHandoff } from "./ai-credential-handoff.js";

type Claim = typeof claims.$inferSelect;
type CapacityScope = { userId: string; local: boolean; companyIds: readonly string[] | null };
const terminal = new Set(["succeeded", "failed", "cancelled", "timed_out", "interrupted"]);
const unboundAdmitted = "ai.capacity.unbound_admitted", unboundSettled = "ai.capacity.unbound_settled";
const configurationFence = sql`hashtext('ai_execution_capacity_configuration')`;

type AccountCapacityConnection = { companyId: string; connectionId: string; grantId: string };
/** Called inside the account owner's authorized transaction. Aliases join the
 * same native admission group; a new company never acquires another seat. */
export async function ensureAiWorkspaceAccountCapacity(db: Db, input: {
  ownerUserId: string; source: AccountCapacityConnection; target?: AccountCapacityConnection;
}) {
  await db.execute(sql`select pg_advisory_xact_lock(${configurationFence})`);
  const selected = [input.source, ...(input.target ? [input.target] : [])];
  const [sourceBinding] = await db.select().from(bindings).where(eq(bindings.grantId, input.source.grantId));
  const [source] = await db.select({ connection: toolConnections, grant: connectionGrants }).from(connectionGrants)
    .innerJoin(toolConnections, and(eq(toolConnections.companyId, connectionGrants.companyId), eq(toolConnections.id, connectionGrants.connectionId)))
    .where(and(eq(connectionGrants.companyId, input.source.companyId), eq(connectionGrants.connectionId, input.source.connectionId), eq(connectionGrants.id, input.source.grantId)));
  const metadata = aiConnectionMetadataSchema.safeParse(source?.connection.config.ai);
  if (!source || source.grant.status !== "active" || source.connection.status !== "active" || !source.connection.enabled ||
      !metadata.success || metadata.data.method !== "subscription") throw conflict("The connected subscription is unavailable");
  const existing = await db.select().from(bindings).where(inArray(bindings.grantId, selected.map(row => row.grantId)));
  if (existing.some(row => row.groupId !== sourceBinding?.groupId || !selected.some(item => item.companyId === row.companyId && item.connectionId === row.connectionId && item.grantId === row.grantId))) {
    throw conflict("The account connections already have different capacity bindings");
  }
  const added = selected.filter(row => !existing.some(binding => binding.grantId === row.grantId));
  if (!added.length) return sourceBinding!.groupId;
  if (sourceBinding) {
    const [pending] = await db.select({ id: claims.runId }).from(claims).where(and(eq(claims.groupId, sourceBinding.groupId), isNull(claims.releasedAt))).limit(1);
    if (pending) throw conflict("Wait for current account work to settle before connecting another company");
  }
  await assertAiCapacityBindingsSettled(db, selected);
  let groupId = sourceBinding?.groupId;
  await notifyDeliveryWork(db, DELIVERY_QUEUES.aiExecutionCapacity, groupId);
  if (!groupId) {
    const [group] = await db.insert(groups).values({ name: source.connection.name, provider: metadata.data.provider,
      maxConcurrent: 1, interactiveReserved: 0, interactivePriority: true, waitWarningMs: 60_000,
      createdByUserId: input.ownerUserId }).returning();
    groupId = group.id;
  } else {
    const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).for("update");
    if (!group || group.provider !== metadata.data.provider) throw conflict("The account capacity group changed");
    await db.update(groups).set({ revision: group.revision + 1, updatedAt: new Date() }).where(eq(groups.id, group.id));
  }
  await db.insert(bindings).values(added.map(row => ({ ...row, groupId })));
  await db.insert(agentosAdminEvents).values({ actorUserId: input.ownerUserId, action: "ai_account_capacity_linked",
    details: { groupId, bindings: added } });
  return groupId;
}

async function assertWorkspaceAccountCapacity(db: Db, touchedGrantIds: string[]) {
  if (!touchedGrantIds.length) return;
  const affected = await db.select().from(aiWorkspaceAccounts).where(or(
    inArray(aiWorkspaceAccounts.sourceGrantId, touchedGrantIds),
    sql`exists (select 1 from ${aiWorkspaceAccountLinks} l where l.account_id = ${aiWorkspaceAccounts.id} and l.grant_id in (${sql.join(touchedGrantIds.map(id => sql`${id}::uuid`), sql`, `)}))`,
  ));
  for (const account of affected) {
    const links = await db.select().from(aiWorkspaceAccountLinks).where(and(eq(aiWorkspaceAccountLinks.accountId, account.id), eq(aiWorkspaceAccountLinks.enabled, true)));
    const ids = [account.sourceGrantId, ...links.map(link => link.grantId)];
    const current = await db.select().from(bindings).where(inArray(bindings.grantId, ids));
    if (current.length !== ids.length || new Set(current.map(row => row.groupId)).size !== 1) {
      throw conflict("Keep every company using this account in the same capacity group");
    }
  }
}
function assertScope(scope: CapacityScope, companyId: string) {
  if (scope.companyIds !== null && !scope.companyIds.includes(companyId)) throw forbidden("Access to every bound company is required");
}

/** Retain the request's company ceiling, but refresh native operator authority
 * after lock waits. Revocation cannot pass between these reads and commit. */
export async function currentAiCapacityScope(db: Db, scope: CapacityScope, boundCompanyIds?: readonly string[]) {
  if (!scope.local && boundCompanyIds) {
    await db.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.id, scope.userId)).for("share", { noWait: true });
    await db.select({ id: instanceUserRoles.id }).from(instanceUserRoles).where(eq(instanceUserRoles.userId, scope.userId)).for("share", { noWait: true });
  }
  await assertAdministration(db, scope);
  if (scope.local) return scope;
  const query = db.select({ companyId: companyMemberships.companyId, role: companyMemberships.membershipRole }).from(companyMemberships)
    .where(and(eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, scope.userId), eq(companyMemberships.status, "active"),
      boundCompanyIds ? inArray(companyMemberships.companyId, [...boundCompanyIds]) : undefined));
  const memberships = await (boundCompanyIds ? query.for("share", { noWait: true }) : query);
  const current = { ...scope, companyIds: memberships.filter(row => !boundCompanyIds || row.role !== "viewer")
    .map(row => row.companyId).filter(id => scope.companyIds?.includes(id)) };
  for (const companyId of boundCompanyIds ?? []) assertScope(current, companyId);
  return current;
}

async function latestUnboundAdmission(db: Db, companyId: string, runId: string) {
  const [event] = await db.select({ eventType: heartbeatRunEvents.eventType }).from(heartbeatRunEvents)
    .where(and(eq(heartbeatRunEvents.companyId, companyId), eq(heartbeatRunEvents.runId, runId), isNull(heartbeatRunEvents.sourceEventId),
      eq(heartbeatRunEvents.stream, "system"), inArray(heartbeatRunEvents.eventType, [unboundAdmitted, unboundSettled])))
    .orderBy(desc(heartbeatRunEvents.seq)).limit(1);
  return event?.eventType;
}

/** A configuration change never silently excludes already dispatched work.
 * Only unresolved history is considered, with a hard per-edit work bound. */
export async function assertAiCapacityBindingsSettled(db: Db, selected: SaveAiExecutionCapacity["bindings"]) {
  if (!selected.length) return;
  if (await hasPendingAiCredentialHandoff(db, selected)) {
    throw conflict("Wait for pending account credential cleanup before changing account access or capacity");
  }
  const alreadySettled = sql`coalesce(${heartbeatRuns.status} in ('succeeded', 'failed', 'cancelled', 'timed_out', 'interrupted') and (
    exists (select 1 from ${claims} settled_claim where settled_claim.run_id = ${heartbeatRuns.id}
      and settled_claim.company_id = ${heartbeatRuns.companyId} and settled_claim.released_at is not null)
    or (select event.event_type from ${heartbeatRunEvents} event where event.run_id = ${heartbeatRuns.id}
      and event.company_id = ${heartbeatRuns.companyId} and event.source_event_id is null and event.stream = 'system'
      and event.event_type in (${unboundAdmitted}, ${unboundSettled}) order by event.seq desc limit 1) = ${unboundSettled}
  ), false)`;
  const runs = await db.select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId, status: heartbeatRuns.status, runtimeMode: heartbeatRuns.runtimeMode })
    .from(heartbeatRuns).where(and(or(...selected.map(binding => and(
    eq(heartbeatRuns.companyId, binding.companyId),
    sql`${heartbeatRuns.contextSnapshot} #>> '{aiConnection,grantId}' = ${binding.grantId}`,
    sql`${heartbeatRuns.contextSnapshot} #>> '{aiConnection,connectionId}' = ${binding.connectionId}`,
    sql`${heartbeatRuns.contextSnapshot} #>> '{aiConnection,method}' = 'subscription'`,
  ))), sql`not (${alreadySettled})`)).orderBy(asc(heartbeatRuns.id)).limit(101);
  if (runs.length > 100) throw conflict("More than 100 executions on these connections lack a capacity settlement receipt. Resolve their native execution cleanup before changing capacity bindings");
  for (const run of runs) {
    if (!terminal.has(run.status)) throw conflict("Wait for existing work on these connections to finish before changing capacity bindings");
    const [claim] = await db.select({ releasedAt: claims.releasedAt }).from(claims).where(and(eq(claims.runId, run.id), eq(claims.companyId, run.companyId)));
    if (claim?.releasedAt || await latestUnboundAdmission(db, run.companyId, run.id) === unboundSettled) continue;
    // Pre-capacity runs need existing native stop/cleanup evidence. Do not
    // run provider recovery, infer settlement from terminal status, or trust
    // caller-supplied context as an execution settlement receipt.
    const cleanupPending = await hasPendingRunCleanup(db, run.companyId, run.id);
    let stopped = !cleanupPending && (await remoteExecutionHasStopped(db, run.companyId, run.id) || (run.runtimeMode === "native" && await hasNativeLocalProcessStop(db, run.companyId, run.id)));
    if (!stopped && !cleanupPending && run.status === "succeeded" && run.runtimeMode === "native") {
      // Successful native turns intentionally retain their runner identity for
      // the next turn. Observe the exact stopped local generation without
      // clearing that identity or manufacturing a capacity settlement receipt.
      // NOWAIT preserves the coordinator/run lifecycle's competing lock order.
      const [coordinator] = await db.select().from(nativeRunFinalizations).where(and(eq(nativeRunFinalizations.companyId, run.companyId), eq(nativeRunFinalizations.runId, run.id))).for("share", { noWait: true });
      const [currentRun] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.companyId, run.companyId))).for("share", { noWait: true });
      stopped = !!currentRun && (!coordinator || (!!coordinator.resultId && !coordinator.leaseOwner && coordinator.phase === "committed"))
        && !await hasPendingAiCredentialHandoff(db, selected)
        && !await hasPendingRunCleanup(db, run.companyId, run.id)
        && await retainedNativeLocalExecutionStopped(db, currentRun);
    }
    if (!stopped && !cleanupPending && run.status === "cancelled") {
      const [coordinator] = await db.select().from(nativeRunFinalizations).where(and(eq(nativeRunFinalizations.companyId, run.companyId), eq(nativeRunFinalizations.runId, run.id))).for("share", { noWait: true });
      const [currentRun] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.companyId, run.companyId))).for("share", { noWait: true });
      stopped = !!currentRun && await isCancelledNativeStartup(db, currentRun, coordinator);
    }
    if (!stopped) throw conflict("Wait for existing work on these connections to finish and its native cleanup to be verified before changing capacity bindings");
  }
}

type Admission = { admitted: true; governed: boolean } | { admitted: false; warningAt: Date };
/** An active pre-dispatch wait. The one deadline ages this concrete request;
 * settlement/configuration events provide every subsequent wake. */
export async function waitForAiCapacity(input: { signal: AbortSignal; attempt: () => Promise<Admission>; subscribe: (wake: () => void) => () => void }) {
  if (input.signal.aborted) throw input.signal.reason;
  return new Promise<{ governed: boolean }>((resolve, reject) => {
    let running = false, dirty = false, finished = false, aborted = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const clean = () => { finished = true; unsubscribe(); input.signal.removeEventListener("abort", abort); if (deadline) clearTimeout(deadline); };
    // A cancelled attempt must commit/roll back before heartbeat teardown can
    // inspect and release the reservation. Never leave a late claim behind.
    const abort = () => { aborted = true; if (!running) { clean(); reject(input.signal.reason ?? new Error("Capacity wait cancelled")); } };
    const pump = async () => {
      if (finished) return;
      if (running) { dirty = true; return; }
      running = true;
      try {
        const result = await input.attempt();
        if (finished || aborted) return;
        if (result.admitted) { clean(); resolve({ governed: result.governed }); return; }
        if (!deadline && result.warningAt.getTime() > Date.now()) deadline = setTimeout(() => { deadline = undefined; void pump(); }, result.warningAt.getTime() - Date.now());
      } catch (error) { if (!finished && !aborted) { clean(); reject(error); } }
      finally { running = false; if (aborted && !finished) abort(); else if (dirty && !finished) { dirty = false; void pump(); } }
    };
    // Subscribe before the first read: a committed release cannot be missed
    // between observing full capacity and beginning to wait.
    const unsubscribe = input.subscribe(() => { void pump(); });
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort(); else void pump();
  });
}

/** A warning threshold also ages waiting work ahead of newer interactive work.
 * An interactive reserve remains a reserve: background work never consumes it. */
export function nextCapacityClaim(policy: Pick<AiExecutionCapacityPolicy, "maxConcurrent" | "interactiveReserved" | "interactivePriority">,
  rows: Pick<Claim, "runId" | "interactive" | "queuedAt" | "warningAt" | "admittedAt" | "releasedAt">[], now: Date): string | null {
  const pending = rows.filter(row => !row.releasedAt);
  const active = pending.filter(row => row.admittedAt);
  if (active.length >= policy.maxConcurrent) return null;
  const backgroundFull = active.filter(row => !row.interactive).length >= policy.maxConcurrent - policy.interactiveReserved;
  const waiting = pending.filter(row => !row.admittedAt && (row.interactive || !backgroundFull));
  waiting.sort((left, right) => {
    const leftOld = left.warningAt <= now, rightOld = right.warningAt <= now;
    if (leftOld !== rightOld) return leftOld ? -1 : 1;
    if (!leftOld && policy.interactivePriority && left.interactive !== right.interactive) return left.interactive ? -1 : 1;
    return left.queuedAt.getTime() - right.queuedAt.getTime() || left.runId.localeCompare(right.runId);
  });
  return waiting[0]?.runId ?? null;
}

export function aiExecutionCapacityService(db: Db) {
  async function overview(scope: CapacityScope): Promise<AiExecutionCapacityOverview> {
    scope = await currentAiCapacityScope(db, scope);
    const [groupRows, bindingRows, claimRows, connections] = await Promise.all([
      db.select().from(groups).orderBy(asc(groups.createdAt)),
      db.select().from(bindings),
      db.select().from(claims).where(isNull(claims.releasedAt)),
      db.select({ grant: connectionGrants, connection: toolConnections, companyName: companies.name }).from(connectionGrants)
        .innerJoin(toolConnections, and(eq(toolConnections.companyId, connectionGrants.companyId), eq(toolConnections.id, connectionGrants.connectionId)))
        .innerJoin(companies, eq(companies.id, connectionGrants.companyId))
        .where(and(eq(connectionGrants.status, "active"), eq(toolConnections.connectionPurpose, "ai"), eq(toolConnections.enabled, true), eq(toolConnections.status, "active"))),
    ]);
    const visible = (companyId: string) => scope.companyIds === null || scope.companyIds.includes(companyId);
    const visibleGroups = groupRows.filter(group => bindingRows.filter(row => row.groupId === group.id).every(row => visible(row.companyId)));
    const visibleIds = new Set(visibleGroups.map(group => group.id));
    return {
      groups: visibleGroups.map(group => {
        const work = claimRows.filter(row => row.groupId === group.id);
        return { ...aiExecutionCapacityPolicySchema.parse({ name: group.name, provider: group.provider, maxConcurrent: group.maxConcurrent,
          interactiveReserved: group.interactiveReserved, interactivePriority: group.interactivePriority, waitWarningMs: group.waitWarningMs }), id: group.id, revision: group.revision,
          bindings: bindingRows.filter(row => row.groupId === group.id).map(({ companyId, connectionId, grantId }) => ({ companyId, connectionId, grantId })),
          active: work.filter(row => row.admittedAt).length, waiting: work.filter(row => !row.admittedAt).length,
          overdue: work.filter(row => !row.admittedAt && row.warningAt <= new Date()).length };
      }),
      connections: connections.flatMap(({ grant, connection, companyName }) => {
        const metadata = aiConnectionMetadataSchema.safeParse(connection.config.ai);
        if (!visible(grant.companyId) || !metadata.success || metadata.data.method !== "subscription") return [];
        const binding = bindingRows.find(row => row.grantId === grant.id);
        // Omit connections bound to a group containing an inaccessible company.
        if (binding && !visibleIds.has(binding.groupId)) return [];
        return [{ companyId: grant.companyId, connectionId: connection.id, grantId: grant.id,
          companyName, connectionName: connection.name, provider: metadata.data.provider, groupId: binding?.groupId ?? null }];
      }),
    };
  }

  async function save(raw: SaveAiExecutionCapacity, scope: CapacityScope) {
    const input = saveAiExecutionCapacitySchema.parse(raw);
    if (new Set(input.bindings.map(row => row.grantId)).size !== input.bindings.length) throw conflict("A connection can appear only once in a capacity group");
    return db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      await tx.execute(sql`select pg_advisory_xact_lock(${configurationFence})`);
      const [existing] = input.id ? await tx.select().from(groups).where(eq(groups.id, input.id)).for("update") : [];
      if (input.id && !existing) throw notFound("Capacity group not found");
      if (existing && (existing.revision !== input.expectedRevision || existing.provider !== input.policy.provider)) throw conflict("The capacity group changed; reload before saving");
      const previous = existing ? await tx.select().from(bindings).where(eq(bindings.groupId, existing.id)) : [];
      scope = await currentAiCapacityScope(tx, scope, [...new Set([...previous, ...input.bindings].map(row => row.companyId))]);
      for (const row of [...previous, ...input.bindings]) assertScope(scope, row.companyId);
      const pending = existing ? await tx.select().from(claims).where(and(eq(claims.groupId, existing.id), isNull(claims.releasedAt))) : [];
      const changed = previous.length !== input.bindings.length || previous.some(row => !input.bindings.some(next => next.grantId === row.grantId && next.connectionId === row.connectionId && next.companyId === row.companyId));
      if (pending.length && changed) throw conflict("Wait for this group's work to settle before changing its connections");
      if (changed) await assertAiCapacityBindingsSettled(tx, [...previous, ...input.bindings]);
      const active = pending.filter(row => row.admittedAt);
      if (active.length > input.policy.maxConcurrent || active.filter(row => !row.interactive).length > input.policy.maxConcurrent - input.policy.interactiveReserved) {
        throw conflict("The new limit is below currently active work. Let it finish before reducing capacity");
      }
      for (const row of input.bindings) {
        const [selection] = await tx.select({ grant: connectionGrants, connection: toolConnections }).from(connectionGrants)
          .innerJoin(toolConnections, and(eq(toolConnections.id, connectionGrants.connectionId), eq(toolConnections.companyId, connectionGrants.companyId)))
          .where(and(eq(connectionGrants.companyId, row.companyId), eq(connectionGrants.id, row.grantId), eq(toolConnections.id, row.connectionId)));
        const metadata = aiConnectionMetadataSchema.safeParse(selection?.connection.config.ai);
        if (!selection || selection.grant.status !== "active" || !selection.connection.enabled || selection.connection.status !== "active" || selection.connection.connectionPurpose !== "ai" ||
            !metadata.success || metadata.data.method !== "subscription" || metadata.data.provider !== input.policy.provider) throw conflict("Choose active subscription connections from the group's provider");
        const [other] = await tx.select().from(bindings).where(eq(bindings.grantId, row.grantId));
        if (other && other.groupId !== existing?.id) throw conflict("This connection already belongs to another capacity group");
      }
      await notifyDeliveryWork(tx, DELIVERY_QUEUES.aiExecutionCapacity);
      const [saved] = existing
        ? await tx.update(groups).set({ ...input.policy, revision: existing.revision + 1, updatedAt: new Date() }).where(eq(groups.id, existing.id)).returning()
        : await tx.insert(groups).values({ ...input.policy, createdByUserId: scope.userId }).returning();
      if (changed || !existing) {
        if (existing) await tx.delete(bindings).where(eq(bindings.groupId, existing.id));
        if (input.bindings.length) await tx.insert(bindings).values(input.bindings.map(row => ({ ...row, groupId: saved.id })));
      }
      await assertWorkspaceAccountCapacity(tx, [...previous, ...input.bindings].map(row => row.grantId));
      await tx.insert(agentosAdminEvents).values({ actorUserId: scope.userId, action: "ai_capacity_group_saved",
        details: { groupId: saved.id, revision: saved.revision, policy: input.policy, bindings: input.bindings } });
      return { id: saved.id, revision: saved.revision };
    }).catch(error => {
      if ((error?.cause?.code ?? error?.code) === "55P03") throw conflict("Capacity administrator authority is changing. Reload and retry.");
      throw error;
    });
  }

  async function tryAcquire(input: { runId: string; companyId: string; attribution: AiConnectionAttribution; interactive: boolean }) {
    if (input.attribution.method !== "subscription") return { admitted: true as const, governed: false as const };
    return db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      // This short shared fence also covers unbound dispatch. A concurrent
      // binding edit either sees the persisted active run, or commits first
      // and this admission observes its new group. No provider work holds it.
      await tx.execute(sql`select pg_advisory_xact_lock_shared(${configurationFence})`);
      const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.companyId, input.companyId))).for("update");
      if (!run || run.status !== "running" || run.resultJson?.cancellation || run.resultJson?.startupCancellation) throw conflict("The execution is no longer eligible for capacity");
      const attribution = run.contextSnapshot?.aiConnection as Partial<AiConnectionAttribution> | undefined;
      if (attribution?.grantId !== input.attribution.grantId || attribution.connectionId !== input.attribution.connectionId || attribution.provider !== input.attribution.provider || attribution.method !== "subscription") {
        throw conflict("The execution's saved AI account differs from capacity admission");
      }
      const [binding] = await tx.select().from(bindings).where(and(eq(bindings.companyId, input.companyId), eq(bindings.grantId, input.attribution.grantId), eq(bindings.connectionId, input.attribution.connectionId)));
      const [prior] = await tx.select().from(claims).where(eq(claims.runId, input.runId));
      if (!binding) {
        const [account] = await tx.select({ id: aiWorkspaceAccounts.id }).from(aiWorkspaceAccounts)
          .where(eq(aiWorkspaceAccounts.sourceGrantId, input.attribution.grantId)).limit(1);
        const [link] = await tx.select({ id: aiWorkspaceAccountLinks.id }).from(aiWorkspaceAccountLinks)
          .where(eq(aiWorkspaceAccountLinks.grantId, input.attribution.grantId)).limit(1);
        if (account || link) throw conflict("This account's shared capacity binding is unavailable");
        if (prior) throw conflict("This execution's capacity binding is no longer available");
        if (await latestUnboundAdmission(tx, input.companyId, input.runId) !== unboundAdmitted) {
          await appendHeartbeatRunEvent(tx, { companyId: run.companyId, agentId: run.agentId, runId: run.id,
            eventType: unboundAdmitted, stream: "system", level: "info", message: "The selected subscription connection has no capacity group. Continuing through normal execution checks." });
        }
        return { admitted: true as const, governed: false as const };
      }
      const [group] = await tx.select().from(groups).where(eq(groups.id, binding.groupId)).for("update");
      if (!group || group.provider !== input.attribution.provider) throw conflict("The selected capacity group changed");
      const [currentBinding] = await tx.select().from(bindings).where(eq(bindings.id, binding.id));
      if (!currentBinding || currentBinding.groupId !== group.id) throw conflict("The capacity binding changed before admission");
      const [selection] = await tx.select({ status: connectionGrants.status, enabled: toolConnections.enabled, connectionStatus: toolConnections.status }).from(connectionGrants)
        .innerJoin(toolConnections, and(eq(toolConnections.id, connectionGrants.connectionId), eq(toolConnections.companyId, connectionGrants.companyId)))
        .where(and(eq(connectionGrants.id, input.attribution.grantId), eq(connectionGrants.companyId, input.companyId), eq(connectionGrants.connectionId, input.attribution.connectionId)));
      if (selection?.status !== "active" || !selection.enabled || selection.connectionStatus !== "active") throw conflict("The selected AI connection is no longer active");
      let [claim] = await tx.select().from(claims).where(eq(claims.runId, input.runId));
      if (claim && (claim.groupId !== group.id || claim.companyId !== input.companyId || claim.grantId !== input.attribution.grantId || claim.releasedAt)) throw conflict("The execution's capacity reservation cannot be reused");
      if (claim?.admittedAt) return { admitted: true as const, governed: true as const };
      const now = new Date();
      if (!claim) {
        await notifyDeliveryWork(tx, DELIVERY_QUEUES.aiExecutionCapacity, group.id);
        [claim] = await tx.insert(claims).values({ runId: run.id, companyId: run.companyId, groupId: group.id,
          grantId: input.attribution.grantId, interactive: input.interactive, warningAt: new Date(now.getTime() + group.waitWarningMs) }).returning();
      }
      // Cancelled waiters never started a provider, so they cannot consume a
      // queue position. Admitted reservations require explicit settlement.
      const waiting = await tx.select({ claim: claims, status: heartbeatRuns.status }).from(claims)
        .innerJoin(heartbeatRuns, and(eq(heartbeatRuns.id, claims.runId), eq(heartbeatRuns.companyId, claims.companyId)))
        .where(and(eq(claims.groupId, group.id), isNull(claims.releasedAt)));
      const cancelled = waiting.filter(row => !row.claim.admittedAt && terminal.has(row.status)).map(row => row.claim.runId);
      if (cancelled.length) {
        await notifyDeliveryWork(tx, DELIVERY_QUEUES.aiExecutionCapacity, group.id);
        await tx.update(claims).set({ releasedAt: now, releaseReason: "cancelled_before_admission" }).where(inArray(claims.runId, cancelled));
      }
      const next = nextCapacityClaim(group, waiting.filter(row => !cancelled.includes(row.claim.runId)).map(row => row.claim), now);
      if (next === run.id) {
        await notifyDeliveryWork(tx, DELIVERY_QUEUES.aiExecutionCapacity, group.id);
        await tx.update(claims).set({ admittedAt: now }).where(eq(claims.runId, run.id));
        await appendHeartbeatRunEvent(tx, { companyId: run.companyId, agentId: run.agentId, runId: run.id,
          eventType: "ai.capacity.admitted", stream: "system", level: "info", message: "AI capacity is available. Continuing through normal execution checks.", payload: { waitedMs: now.getTime() - claim.queuedAt.getTime() } });
        return { admitted: true as const, governed: true as const };
      }
      if (!prior) await appendHeartbeatRunEvent(tx, { companyId: run.companyId, agentId: run.agentId, runId: run.id,
        eventType: "ai.capacity.waiting", stream: "system", level: "info", message: "Waiting for available AI capacity. Provider work has not started.", payload: { warningAt: claim.warningAt.toISOString() } });
      if (claim.warningAt <= now && !claim.warnedAt) {
        await tx.update(claims).set({ warnedAt: now }).where(eq(claims.runId, run.id));
        await appendHeartbeatRunEvent(tx, { companyId: run.companyId, agentId: run.agentId, runId: run.id,
          eventType: "ai.capacity.delayed", stream: "system", level: "warn", message: "AI capacity is still occupied. The request is saved and will continue when capacity is released.", payload: { providerWorkStarted: false } });
      }
      return { admitted: false as const, warningAt: claim.warningAt };
    });
  }

  async function acquire(input: Parameters<typeof tryAcquire>[0] & { signal: AbortSignal }) {
    return waitForAiCapacity({ signal: input.signal,
      attempt: async () => { await reconcile(input.companyId, input.runId); return tryAcquire(input); },
      subscribe: wake => {
        const unsubscribes = [DELIVERY_QUEUES.aiExecutionCapacity, DELIVERY_QUEUES.executionFinalization,
          DELIVERY_QUEUES.environmentCleanup, DELIVERY_QUEUES.executionDisposition].map(queue => subscribeDeliveryWork(db, queue, wake));
        return () => unsubscribes.forEach(unsubscribe => unsubscribe());
      },
    });
  }

  /** Called only by heartbeat's verified execution-cleanup boundary. Unknown
   * provider ownership keeps its reservation; deadlines never release it. */
  async function releaseSettled(runId: string, companyId: string, providerSettled: boolean) {
    return db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      const [initial] = await tx.select().from(claims).where(and(eq(claims.runId, runId), eq(claims.companyId, companyId)));
      if (!initial) {
        if (!providerSettled) return false;
        const [run] = await tx.select({ agentId: heartbeatRuns.agentId, status: heartbeatRuns.status, context: heartbeatRuns.contextSnapshot }).from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.companyId, companyId))).for("update");
        // The same verified owner boundary also settles early preparation
        // failures after account attribution but before capacity admission.
        if (!run || !terminal.has(run.status) || (run.context?.aiConnection as Partial<AiConnectionAttribution> | undefined)?.method !== "subscription" ||
            await latestUnboundAdmission(tx, companyId, runId) === unboundSettled) return false;
        await appendHeartbeatRunEvent(tx, { companyId, runId, agentId: run.agentId, eventType: unboundSettled, stream: "system", level: "info",
          message: "Native execution cleanup settled the work on this ungrouped subscription connection." });
        return true;
      }
      await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, initial.groupId)).for("update");
      const [claim] = await tx.select().from(claims).where(eq(claims.runId, runId));
      if (!claim || claim.releasedAt || (claim.admittedAt && !providerSettled)) return false;
      await notifyDeliveryWork(tx, DELIVERY_QUEUES.aiExecutionCapacity, claim.groupId);
      await tx.update(claims).set({ releasedAt: new Date(), releaseReason: claim.admittedAt ? "execution_settled" : "cancelled_before_admission" }).where(and(eq(claims.runId, runId), isNull(claims.releasedAt)));
      return true;
    });
  }

  /** Run once on startup and on settlement notifications while a contender is
   * waiting. No recurring scan is kept alive by a configured, idle group. */
  async function reconcile(companyId?: string, contenderRunId?: string) {
    const [contender] = contenderRunId ? await db.select({ groupId: claims.groupId }).from(claims)
      .where(and(eq(claims.runId, contenderRunId), companyId ? eq(claims.companyId, companyId) : undefined)) : [];
    if (contenderRunId && !contender) return;
    const pending = await db.select({ claim: claims, run: heartbeatRuns }).from(claims)
      .innerJoin(heartbeatRuns, and(eq(heartbeatRuns.id, claims.runId), eq(heartbeatRuns.companyId, claims.companyId)))
      .where(and(isNull(claims.releasedAt), inArray(heartbeatRuns.status, [...terminal]), contender ? eq(claims.groupId, contender.groupId) : undefined));
    for (const { claim, run } of pending) {
      if (!claim.admittedAt) { await releaseSettled(run.id, run.companyId, false); continue; }
      const issueId = run.issueId ?? (typeof run.contextSnapshot?.issueId === "string" ? run.contextSnapshot.issueId : null);
      const stopped = issueId ? await isCaseHandoffSourceReleased(db, { runId: run.id, issueId })
        : !await hasPendingRunCleanup(db, run.companyId, run.id) &&
          (await remoteExecutionHasStopped(db, run.companyId, run.id) || (run.runtimeMode === "native" && await hasNativeLocalProcessStop(db, run.companyId, run.id)));
      if (stopped) await releaseSettled(run.id, run.companyId, true);
    }
  }

  return { overview, save, tryAcquire, acquire, releaseSettled, reconcile };
}
