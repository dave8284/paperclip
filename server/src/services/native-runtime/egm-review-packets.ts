import { and, eq, sql } from "drizzle-orm";
import { agents, heartbeatRuns, issues, issueThreadInteractions, nativeRunFinalizations, nativeRunResults, type Db } from "@paperclipai/db";
import { egmPacketBindingSchema, prepareEgmPacketSchema, type PrepareEgmPacket, type EgmPacketBinding } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import { evaluateAgentInvokabilityFromDb } from "../agent-invokability.js";
import { agentRunWritesRevoked } from "../../agent-run-cancellation.js";
import { persistActivity, publishActivity, type ActivityPublication } from "../activity-log.js";
import { getNativeReviewAssignment, readNativeReviewAssignmentContext, type NativeReviewAssignment } from "./native-review-participant.js";
import { canonicalEgmJson, parseRetainedEgmPacket, prepareEgmPacketContent, revalidateEgmPacketSources, type EgmPacketPreparation } from "./egm-packet-content.js";
import { egmCreatorAuthority, egmExecutionActor, refreshEgmActor } from "./egm-packet-authority.js";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const unavailable = "independent_review_unavailable";
type Scope = { issueId: string; sourceRunId: string };

/** Common executor admission, including injected and non-runnerd backends.
 * Preparation cannot opt into an ordinary provider path on recovery. */
export async function assertOrdinaryNativeReviewExecution(db: Db, binding: { companyId: string; issueId: string; agentId: string; runId: string }) {
  const [run] = await db.select({ contextSnapshot: heartbeatRuns.contextSnapshot, runnerProfileJson: heartbeatRuns.runnerProfileJson })
    .from(heartbeatRuns).where(and(eq(heartbeatRuns.id, binding.runId), eq(heartbeatRuns.companyId, binding.companyId), eq(heartbeatRuns.agentId, binding.agentId))).limit(1);
  if (record(run?.runnerProfileJson).nativeEgmPacketReceipt) throw new Error("independent_review_unavailable: prepared EGM execution is not supported");
  const context = readNativeReviewAssignmentContext(run?.contextSnapshot);
  if (!context) return;
  const review = await getNativeReviewAssignment(db, { ...binding, contextSnapshot: context });
  if (!review) throw new Error("native_review_assignment_no_longer_available");
  if (record(review.interaction.payload).egmPacketPreparation !== undefined || record(review.sourceRun.runnerProfileJson).nativeEgmPacketPreparation)
    throw new Error("independent_review_unavailable: frozen EGM packets cannot use ordinary review execution");
}

async function requireRead(db: Db, actor: AuthorizationActor, companyId: string, issueId: string) {
  actor = await refreshEgmActor(db, actor);
  if (actor.companyIds !== undefined && !actor.companyIds.includes(companyId)) throw notFound("EGM packet not found");
  const result = await authorizationService(db).decide({ actor, action: "issue:read", resource: { type: "issue", companyId, issueId } });
  if (!result.allowed) throw notFound("EGM packet not found");
}
export async function requirePacketAuthority(db: Db, packet: EgmPacketPreparation) {
  const creator = await refreshEgmActor(db, packet.creatorAuthority);
  await requireRead(db, creator, packet.companyId, packet.issueId);
  await requireRead(db, await egmExecutionActor(db, { ...packet, agentId: packet.authorAgentId, runId: packet.sourceRunId }), packet.companyId, packet.issueId);
  await requireRead(db, await egmExecutionActor(db, { ...packet, agentId: packet.request.reviewerAgentId }), packet.companyId, packet.issueId);
  const [reviewer] = await db.select().from(agents).where(and(eq(agents.id, packet.request.reviewerAgentId), eq(agents.companyId, packet.companyId))).limit(1);
  if (!reviewer || !(await evaluateAgentInvokabilityFromDb(db, reviewer)).invokable) throw conflict("The selected EGM reviewer is unavailable");
  await revalidateEgmPacketSources(db, packet);
}
function assertSourceBinding(packet: EgmPacketPreparation, source: typeof heartbeatRuns.$inferSelect, issueId: string) {
  if (packet.companyId !== source.companyId || packet.issueId !== issueId || packet.sourceRunId !== source.id
    || packet.authorAgentId !== source.agentId || source.nativeIssueId !== issueId || source.runtimeMode !== "native")
    throw conflict("EGM packet source binding does not match");
}
function preparationResponse(packet: EgmPacketPreparation, binding: unknown) {
  return { packet, binding: binding ?? null, stage: "server_prepared" as const, execution: "pending_native_admission" as const,
    providerDelivery: "not_observed" as const, message: "Packet prepared. Execution requires a separate eligible native reviewer admission; preparation alone does not deliver a packet or complete a review." };
}

export function egmReviewPacketService(db: Db) {
  async function source(actor: AuthorizationActor, scope: Scope, tx: Db, lock: boolean) {
    // Match native finalization ordering: coordinator, issue, run. This makes
    // preparation/clear serialize with the effect that binds the reviewer.
    const [candidate] = await tx.select({ companyId: issues.companyId }).from(issues).where(eq(issues.id, scope.issueId)).limit(1);
    if (!candidate) throw notFound("EGM packet not found");
    await requireRead(tx, actor, candidate.companyId, scope.issueId);
    if (lock) await tx.select({ id: nativeRunFinalizations.runId }).from(nativeRunFinalizations).where(and(eq(nativeRunFinalizations.runId, scope.sourceRunId), eq(nativeRunFinalizations.companyId, candidate.companyId), eq(nativeRunFinalizations.issueId, scope.issueId))).for("update");
    const issueQuery = tx.select().from(issues).where(eq(issues.id, scope.issueId)).limit(1);
    const [issue] = await (lock ? issueQuery.for("update") : issueQuery);
    if (!issue) throw notFound("EGM packet not found");
    await requireRead(tx, actor, issue.companyId, issue.id);
    const runQuery = tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, scope.sourceRunId), eq(heartbeatRuns.companyId, issue.companyId), eq(heartbeatRuns.nativeIssueId, issue.id))).limit(1);
    const [run] = await (lock ? runQuery.for("update") : runQuery);
    if (!run || run.runtimeMode !== "native") throw notFound("EGM packet not found");
    return { issue, run, profile: record(run.runnerProfileJson) };
  }
  async function assertAuthor(tx: Db, actor: AuthorizationActor, run: typeof heartbeatRuns.$inferSelect, issue: typeof issues.$inferSelect, allowSubmittedClear = false) {
    actor = await refreshEgmActor(tx, actor);
    if (actor.type !== "board" && (actor.type !== "agent" || actor.agentId !== run.agentId || actor.runId !== run.id)) throw forbidden("Only the active author run or task operator may prepare this packet");
    if (actor.type === "board" && !actor.userId) throw forbidden("Packet preparation requires an identified operator");
    const mutation = await authorizationService(tx).decide({ actor, action: "issue:mutate", resource: { type: "issue", companyId: issue.companyId, issueId: issue.id } });
    if (!mutation.allowed) throw forbidden("The current actor cannot prepare this task's review packet");
    if (run.status !== "running" || run.nativeIssueId !== issue.id || issue.assigneeAgentId !== run.agentId || issue.executionRunId !== run.id || agentRunWritesRevoked(run))
      throw conflict("The author run is no longer active; its packet cannot be changed");
    const [result] = await tx.select({ id: nativeRunResults.id }).from(nativeRunResults).where(and(eq(nativeRunResults.companyId, issue.companyId), eq(nativeRunResults.runId, run.id))).limit(1);
    if (result && !allowSubmittedClear) throw conflict("The author already submitted its result; a new packet cannot be prepared");
  }
  async function audit(tx: Db, actor: AuthorizationActor, packet: EgmPacketPreparation, action: string) {
    return (await persistActivity(tx, { companyId: packet.companyId, actorType: actor.type === "agent" ? "agent" : "user",
      actorId: actor.agentId ?? actor.userId!, agentId: actor.type === "agent" ? actor.agentId : null,
      runId: packet.sourceRunId, action, entityType: "issue", entityId: packet.issueId, issueId: packet.issueId,
      details: { requestSha256: packet.requestSha256, reviewerAgentId: packet.request.reviewerAgentId, stage: "server_prepared", execution: unavailable } })).publication;
  }
  return {
    prepare: async (actor: AuthorizationActor, scope: Scope, raw: PrepareEgmPacket) => {
      const request = prepareEgmPacketSchema.parse(raw);
      let publication: ActivityPublication | undefined;
      const response = await db.transaction(async transaction => {
        const tx = transaction as unknown as Db;
        const { issue, run, profile } = await source(actor, scope, tx, true);
        if (profile.nativeEgmPacketBinding) throw conflict("The packet is bound to a review; use native review cancellation");
        await assertAuthor(tx, actor, run, issue);
        if (request.reviewerAgentId === run.agentId) throw conflict("The reviewer must differ from the author");
        if (profile.nativeEgmPacketPreparation) {
          const retained = parseRetainedEgmPacket(profile.nativeEgmPacketPreparation);
          assertSourceBinding(retained, run, issue.id);
          if (canonicalEgmJson(retained.request) !== canonicalEgmJson(request)) throw conflict("A different packet is prepared; clear its exact receipt first");
          await requirePacketAuthority(tx, retained);
          return preparationResponse(retained, null);
        }
        // Author and reviewer must read the owning task before any source body
        // is materialized. Document ownership is checked by exact native joins.
        await requireRead(tx, await egmExecutionActor(tx, { companyId: run.companyId, issueId: issue.id, agentId: run.agentId, runId: run.id }), run.companyId, issue.id);
        await requireRead(tx, await egmExecutionActor(tx, { companyId: run.companyId, issueId: issue.id, agentId: request.reviewerAgentId }), run.companyId, issue.id);
        const packet = await prepareEgmPacketContent(tx, { companyId: issue.companyId, issueId: issue.id, sourceRunId: run.id, authorAgentId: run.agentId, request,
          creatorAuthority: egmCreatorAuthority(await refreshEgmActor(tx, actor)),
          preparedBy: actor.type === "agent" ? { type: "agent", id: actor.agentId! } : { type: "user", id: actor.userId! } });
        await requirePacketAuthority(tx, packet);
        await tx.update(heartbeatRuns).set({ runnerProfileJson: sql`jsonb_set(coalesce(${heartbeatRuns.runnerProfileJson}, '{}'::jsonb), '{nativeEgmPacketPreparation}', ${JSON.stringify(packet)}::jsonb)`, updatedAt: new Date() }).where(eq(heartbeatRuns.id, run.id));
        publication = await audit(tx, actor, packet, "issue.egm_packet_prepared");
        return preparationResponse(packet, null);
      });
      if (publication) publishActivity(publication);
      return response;
    },
    read: async (actor: AuthorizationActor, scope: Scope) => {
      const { issue, run, profile } = await source(actor, scope, db, false);
      if (!profile.nativeEgmPacketPreparation) throw notFound("EGM packet not found");
      const packet = parseRetainedEgmPacket(profile.nativeEgmPacketPreparation);
      assertSourceBinding(packet, run, issue.id);
      if (actor.type === "agent" && actor.agentId !== run.agentId && actor.agentId !== packet.request.reviewerAgentId) throw notFound("EGM packet not found");
      const binding = record(profile.nativeEgmPacketBinding);
      if (binding.interactionId) {
        const assignment = await getNativeReviewAssignment(db, { companyId: issue.companyId, issueId: issue.id, agentId: packet.request.reviewerAgentId,
          contextSnapshot: { nativeReviewInteractionId: binding.interactionId, nativeReviewDecisionId: binding.decisionId } });
        if (!assignment) throw notFound("EGM review assignment is no longer available");
      } else if (run.status !== "running" || issue.executionRunId !== run.id || agentRunWritesRevoked(run)) throw notFound("EGM author run is no longer available");
      await requirePacketAuthority(db, packet);
      return preparationResponse(packet, profile.nativeEgmPacketBinding);
    },
    clear: async (actor: AuthorizationActor, scope: Scope, expectedSha256: string) => {
      let publication: ActivityPublication | undefined;
      await db.transaction(async transaction => {
        const tx = transaction as unknown as Db;
        const { issue, run, profile } = await source(actor, scope, tx, true);
        // Explicit opt-out may recover an unbound reviewer mismatch after the
        // result was submitted. It never changes that result or a bound review.
        await assertAuthor(tx, actor, run, issue, true);
        if (profile.nativeEgmPacketBinding) throw conflict("The packet is bound to a review; use native review cancellation");
        if (!profile.nativeEgmPacketPreparation) throw notFound("EGM packet not found");
        const packet = parseRetainedEgmPacket(profile.nativeEgmPacketPreparation);
        assertSourceBinding(packet, run, issue.id);
        if (packet.requestSha256 !== expectedSha256) throw conflict("The packet receipt changed; reload before clearing");
        await tx.update(heartbeatRuns).set({ runnerProfileJson: sql`${heartbeatRuns.runnerProfileJson} - 'nativeEgmPacketPreparation'`, updatedAt: new Date() }).where(eq(heartbeatRuns.id, run.id));
        publication = await audit(tx, actor, packet, "issue.egm_packet_cleared");
      });
      if (publication) publishActivity(publication);
      return { cleared: true, providerDelivery: "not_observed" };
    },
  };
}

/** Called only by the native committer while it owns finalization/issue locks. */
export async function egmBindingForReviewer(db: Db, input: { companyId: string; issueId: string; sourceRunId: string; reviewerAgentId: string | null }) {
  const [source] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, input.sourceRunId), eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.nativeIssueId, input.issueId))).for("update").limit(1);
  const saved = record(source?.runnerProfileJson).nativeEgmPacketPreparation;
  if (!saved) return undefined;
  const packet = parseRetainedEgmPacket(saved);
  if (packet.request.reviewerAgentId !== input.reviewerAgentId) throw conflict("An EGM packet is prepared for another reviewer; select that reviewer or clear and reprepare the packet before submitting work");
  assertSourceBinding(packet, source!, input.issueId);
  await requirePacketAuthority(db, packet);
  return egmPacketBindingSchema.parse({ schema: "agentos.egm-review-binding.v1", sourceRunId: source!.id, requestSha256: packet.requestSha256 });
}

export async function bindEgmPacketInteraction(db: Db, binding: EgmPacketBinding, interactionId: string, decisionId: string) {
  const [source] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, binding.sourceRunId)).for("update").limit(1);
  const profile = record(source?.runnerProfileJson), saved = parseRetainedEgmPacket(profile.nativeEgmPacketPreparation);
  if (saved.requestSha256 !== binding.requestSha256) throw conflict("The prepared EGM packet changed before binding");
  const linked = { interactionId, decisionId, requestSha256: binding.requestSha256 };
  if (profile.nativeEgmPacketBinding && canonicalEgmJson(profile.nativeEgmPacketBinding) !== canonicalEgmJson(linked)) throw conflict("This EGM packet is already bound to another review");
  await db.update(heartbeatRuns).set({ runnerProfileJson: sql`jsonb_set(coalesce(${heartbeatRuns.runnerProfileJson}, '{}'::jsonb), '{nativeEgmPacketBinding}', ${JSON.stringify(linked)}::jsonb)` }).where(eq(heartbeatRuns.id, binding.sourceRunId));
}

/** Retain a receipt before the unavailable execution boundary. No provider call. */
export async function retainEgmReviewPreparation(db: Db, runId: string, review: NativeReviewAssignment, packetExecution = false) {
  const raw = record(review.interaction.payload).egmPacketPreparation;
  if (raw === undefined) {
    if (record(review.sourceRun.runnerProfileJson).nativeEgmPacketPreparation) throw conflict("The explicit EGM preparation has no matching review binding");
    return false;
  }
  const binding = egmPacketBindingSchema.parse(raw);
  await db.transaction(async transaction => {
    const tx = transaction as unknown as Db;
    await tx.select({ id: issues.id }).from(issues).where(and(eq(issues.id, review.interaction.issueId), eq(issues.companyId, review.interaction.companyId))).for("update");
    await tx.select({ id: issueThreadInteractions.id }).from(issueThreadInteractions).where(and(eq(issueThreadInteractions.id, review.interaction.id), eq(issueThreadInteractions.companyId, review.interaction.companyId), eq(issueThreadInteractions.issueId, review.interaction.issueId))).for("update");
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.companyId, review.interaction.companyId))).for("update").limit(1);
    if (!run || run.status !== "running" || agentRunWritesRevoked(run)) throw conflict("Review execution is no longer active");
    const current = await getNativeReviewAssignment(tx, { companyId: run.companyId, issueId: review.interaction.issueId, agentId: run.agentId, contextSnapshot: run.contextSnapshot, actingRunId: run.id });
    if (!current || current.interaction.id !== review.interaction.id || current.sourceRun.id !== binding.sourceRunId) throw conflict("The EGM review assignment changed");
    if (canonicalEgmJson(record(current.interaction.payload).egmPacketPreparation) !== canonicalEgmJson(binding)) throw conflict("The EGM review binding changed during preparation");
    const packet = parseRetainedEgmPacket(record(current.sourceRun.runnerProfileJson).nativeEgmPacketPreparation);
    const linked = record(record(current.sourceRun.runnerProfileJson).nativeEgmPacketBinding);
    assertSourceBinding(packet, current.sourceRun, current.interaction.issueId);
    if (packet.requestSha256 !== binding.requestSha256 || packet.request.reviewerAgentId !== run.agentId
      || linked.interactionId !== current.interaction.id || linked.decisionId !== current.sourceDecision.id || linked.requestSha256 !== binding.requestSha256)
      throw conflict("The frozen EGM packet does not match this review");
    await requirePacketAuthority(tx, packet);
    await requireRead(tx, await egmExecutionActor(tx, { companyId: run.companyId, issueId: current.interaction.issueId, agentId: run.agentId, runId: run.id }), run.companyId, current.interaction.issueId);
    const receipt = { schema: "agentos.egm-packet-receipt.v1", stage: "server_prepared", companyId: run.companyId, issueId: current.interaction.issueId,
      reviewerRunId: run.id, reviewerAgentId: run.agentId, sourceRunId: binding.sourceRunId, interactionId: current.interaction.id,
      sourceDecisionId: current.sourceDecision.id, requestSha256: binding.requestSha256, execution: packetExecution ? "packet_review_ready" : unavailable, providerDelivery: "not_observed",
      parentConversationIsolation: "unverified", sourceReadCoverage: "unverified", readOnlyEnforcement: "unverified" };
    const prior = record(run.runnerProfileJson).nativeEgmPacketReceipt;
    if (prior && canonicalEgmJson({ ...record(prior), execution: receipt.execution }) !== canonicalEgmJson(receipt)) throw conflict("The saved EGM review receipt does not match");
    await tx.update(heartbeatRuns).set({ runnerProfileJson: sql`jsonb_set(coalesce(${heartbeatRuns.runnerProfileJson}, '{}'::jsonb), '{nativeEgmPacketReceipt}', ${JSON.stringify(receipt)}::jsonb)` }).where(eq(heartbeatRuns.id, run.id));
  });
  return true;
}

/** The native assignment and frozen source remain the authority on every read,
 * launch, recovery and findings write. Caller-supplied packet text is ignored. */
export async function loadEgmReviewPacket(db: Db, binding: { companyId: string; issueId: string; agentId: string; runId: string }) {
  const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, binding.runId),
    eq(heartbeatRuns.companyId, binding.companyId), eq(heartbeatRuns.agentId, binding.agentId))).limit(1);
  if (!run || run.status !== "running" || run.runtimeMode !== "native" || run.nativeIssueId !== binding.issueId || agentRunWritesRevoked(run)) throw forbidden("EGM review execution is no longer active");
  const [issue] = await db.select({ executionRunId: issues.executionRunId }).from(issues).where(and(eq(issues.id, binding.issueId), eq(issues.companyId, binding.companyId))).limit(1);
  if (issue?.executionRunId !== run.id) throw forbidden("The EGM review no longer owns this execution");
  const context = readNativeReviewAssignmentContext(run.contextSnapshot);
  const review = context && await getNativeReviewAssignment(db, { ...binding, contextSnapshot: context, actingRunId: run.id });
  if (!review) throw forbidden("EGM review assignment is no longer available");
  const declared = egmPacketBindingSchema.parse(record(review.interaction.payload).egmPacketPreparation);
  const packet = parseRetainedEgmPacket(record(review.sourceRun.runnerProfileJson).nativeEgmPacketPreparation);
  const receipt = record(record(run.runnerProfileJson).nativeEgmPacketReceipt);
  const linked = record(record(review.sourceRun.runnerProfileJson).nativeEgmPacketBinding);
  assertSourceBinding(packet, review.sourceRun, binding.issueId);
  if (declared.sourceRunId !== packet.sourceRunId || declared.requestSha256 !== packet.requestSha256
    || packet.request.reviewerAgentId !== binding.agentId || linked.interactionId !== review.interaction.id
    || linked.decisionId !== review.sourceDecision.id || linked.requestSha256 !== packet.requestSha256
    || receipt.requestSha256 !== packet.requestSha256 || receipt.reviewerRunId !== run.id
    || receipt.reviewerAgentId !== binding.agentId || receipt.sourceRunId !== packet.sourceRunId) {
    throw conflict("The frozen EGM packet does not match this review");
  }
  await requirePacketAuthority(db, packet);
  await requireRead(db, await egmExecutionActor(db, binding), binding.companyId, binding.issueId);
  return { packet, run, review };
}
