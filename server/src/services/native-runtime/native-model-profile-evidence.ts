import { and, eq, inArray } from "drizzle-orm";
import { heartbeatRunEvents, type Db, type heartbeatRuns } from "@paperclipai/db";
import { modelAccountFingerprint, type ModelProfileLearningScope } from "../model-profile-binding.js";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function nativeModelTaskMatchesSelection(run: typeof heartbeatRuns.$inferSelect, contextFingerprint: unknown) {
  const task = record(record(run.runnerProfileJson?.nativeExecutionInput).task);
  return !run.contextSnapshot?.nativeReviewInteractionId && task.workMode === "standard" && typeof task.title === "string"
    && (task.description === null || typeof task.description === "string") && typeof contextFingerprint === "string"
    && createHash("sha256").update(JSON.stringify({ title: task.title, description: task.description })).digest("hex") === contextFingerprint;
}

/** Read the native provider session receipt, never model prose, a catalog,
 * requested configuration, or the accounting ledger's configured-model echo. */
export async function readNativeModelProfileEvidence(db: Db, run: typeof heartbeatRuns.$inferSelect) {
  const events = await db.select().from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.companyId, run.companyId),
    eq(heartbeatRunEvents.runId, run.id), inArray(heartbeatRunEvents.eventType, ["session.started", "session.resumed"])))
    .orderBy(heartbeatRunEvents.seq).limit(33);
  if (!events.length || events.length > 32) return null;
  const observations = events.map(event => {
    const prp = record(record(event.payload).prpEvent);
    const descriptor = record(record(prp.payload).providerDescriptor);
    const observation = record(descriptor.observedCodexIdentity);
    if (!event.sourceEventId || !event.sourceInstanceId || event.sourceSeq == null || !event.sourcePayloadSha256 || (event.protocolSchemaVersion ?? 0) < 2
      || prp.runId !== run.id || prp.sourceInstanceId !== event.sourceInstanceId || prp.eventType !== event.eventType
      || prp.sourceSeq !== event.sourceSeq || prp.sourceEventId !== event.sourceEventId
      || typeof observation.cliVersion !== "string" || !observation.cliVersion
      || typeof observation.model !== "string" || !observation.model
      || !["thread/start", "thread/resume"].includes(String(observation.source))) return null;
    return { eventId: event.sourceEventId, sha256: event.sourcePayloadSha256, cliVersion: observation.cliVersion,
      model: observation.model, reasoningEffort: typeof observation.reasoningEffort === "string" ? observation.reasoningEffort : null };
  });
  const first = observations[0];
  if (!first || observations.some(item => !item || item.cliVersion !== first.cliVersion || item.model !== first.model
    || item.reasoningEffort !== first.reasoningEffort)) return null;
  return { cliVersion: first.cliVersion, model: first.model, reasoningEffort: first.reasoningEffort,
    events: observations.map(item => ({ eventId: item!.eventId, sha256: item!.sha256 })) };
}

/** A configured baseline is free to launch without a qualification gate. Its
 * outcome may train a scoped comparison only when the completed native session
 * actually used that scope, including after a binary change or recovery. */
export async function matchesNativeModelLearningScope(db: Db, run: typeof heartbeatRuns.$inferSelect, scope: ModelProfileLearningScope, model: string, contextFingerprint: string | null) {
  const native = record(run.runnerProfileJson?.nativeExecutionInput), binding = record(native.binding), provider = record(native.provider);
  const account = record(run.contextSnapshot?.aiConnection), profile = scope.profile;
  if (!nativeModelTaskMatchesSelection(run, contextFingerprint) || run.runtimeMode !== "native" || run.sessionIdBefore || !run.issueId || run.nativeIssueId !== run.issueId
    || run.costAccountingPending || !run.costAccountedAt || run.usageJson?.accountingReceiptReady !== true || run.usageJson?.accountingCaptureFailed === true
    || binding.companyId !== run.companyId || binding.agentId !== run.agentId || binding.runId !== run.id || binding.issueId !== run.issueId
    || native.executionPurpose || native.executionMode === "plan" || native.homeMode !== "isolated"
    || provider.kind !== "codex" || provider.model !== model || (provider.reasoningEffort ?? null) !== profile.requestedEffort
    || account.provider !== "openai" || account.method !== "subscription" || typeof account.subscriptionId !== "string" || typeof account.sessionIdentity !== "string"
    || modelAccountFingerprint(run.companyId, { provider: "openai", subscriptionId: account.subscriptionId, sessionIdentity: account.sessionIdentity }) !== profile.accountFingerprint) return false;
  const observation = await readNativeModelProfileEvidence(db, run);
  return !!observation && observation.cliVersion === scope.cliVersion && observation.model === model
    && (profile.requestedEffort === null || observation.reasoningEffort === null || observation.reasoningEffort === profile.requestedEffort);
}
import { createHash } from "node:crypto";
