import { and, eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { agents, agentApiKeys, authUsers, boardApiKeys, companyMemberships, heartbeatRuns, type Db } from "@paperclipai/db";
import { agentApiKeyScopeSchema } from "@paperclipai/shared";
import { z } from "zod";
import type { AuthorizationActor } from "../authorization.js";
import { forbidden } from "../../errors.js";
import { createHeartbeatRunPreparation } from "../heartbeat/run-preparation.js";
import { museRunnerBroker } from "../muse-runner-broker.js";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";

const nullableId = z.string().min(1).nullable();
export const egmCreatorAuthoritySchema = z.object({
  type: z.enum(["board", "agent"]), userId: nullableId, agentId: nullableId, companyId: nullableId,
  runId: nullableId, keyId: nullableId, keyScope: agentApiKeyScopeSchema.nullable(),
  onBehalfOfUserId: nullableId, authorizingUserId: nullableId,
  source: z.enum(["local_implicit", "session", "board_key", "agent_key", "agent_jwt", "mcp_oauth", "cloud_tenant", "cloud_control", "none"]).nullable(),
  ignoreInstanceAdmin: z.boolean(),
  companyIds: z.array(z.string().uuid()).optional(),
}).strict();
export type EgmCreatorAuthority = z.infer<typeof egmCreatorAuthoritySchema>;

/** Retain identity/ceilings only, never cached grants, membership or credentials. */
export function egmCreatorAuthority(actor: AuthorizationActor): EgmCreatorAuthority {
  return egmCreatorAuthoritySchema.parse({ type: actor.type, userId: actor.userId ?? null, agentId: actor.agentId ?? null,
    companyId: actor.companyId ?? null, runId: actor.runId ?? null, keyId: actor.keyId ?? null, keyScope: actor.keyScope ?? null,
    onBehalfOfUserId: actor.onBehalfOfUserId ?? null, authorizingUserId: actor.authorizingUserId ?? null,
    source: actor.source ?? null, ignoreInstanceAdmin: actor.ignoreInstanceAdmin === true,
    ...(actor.companyIds !== undefined ? { companyIds: actor.companyIds } : {}) });
}

async function requireApprovedUser(db: Db, userId: string | null | undefined, companyId?: string | null) {
  if (!userId) throw forbidden("EGM review requires a responsible user");
  const [user] = await db.select({ approvalStatus: authUsers.approvalStatus }).from(authUsers).where(eq(authUsers.id, userId)).limit(1);
  if (user?.approvalStatus !== "approved") throw forbidden("EGM review authority is no longer approved");
  if (companyId) {
    const [membership] = await db.select({ status: companyMemberships.status }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active"))).limit(1);
    if (!membership) throw forbidden("EGM responsible user is no longer a company member");
  }
}

/** New actor object per check drops request memo and pre-lock memberships.
 * The native owner resolves responsible identity; original ceilings can only
 * restrict it. A changed identity requires a new preparation, never substitution. */
export async function refreshEgmActor(db: Db, input: AuthorizationActor | EgmCreatorAuthority): Promise<AuthorizationActor> {
  const saved = egmCreatorAuthority(input as AuthorizationActor);
  const actor: AuthorizationActor = { ...saved, source: saved.source ?? undefined };
  if (actor.type === "board") {
    if (actor.source !== "local_implicit") await requireApprovedUser(db, actor.userId);
    if (actor.source === "board_key") {
      const [key] = actor.keyId ? await db.select().from(boardApiKeys).where(and(eq(boardApiKeys.id, actor.keyId), eq(boardApiKeys.userId, actor.userId ?? ""))).limit(1) : [];
      if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date())) throw forbidden("EGM operator key authority changed");
    }
    // Local instance-admin state is resolved by the native evaluator. Never
    // replay an attested cloud-admin boolean as a durable grant.
    return actor;
  }
  if (actor.keyId) {
    const [key] = await db.select().from(agentApiKeys).where(and(eq(agentApiKeys.id, actor.keyId), eq(agentApiKeys.agentId, actor.agentId ?? ""), eq(agentApiKeys.companyId, actor.companyId ?? ""))).limit(1);
    if (!key || key.revokedAt || !isDeepStrictEqual(key.scopeConfig ?? { kind: "standard" }, actor.keyScope ?? { kind: "standard" }))
      throw forbidden("EGM creator key authority changed");
  }
  if (actor.runId) {
    const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, actor.runId), eq(heartbeatRuns.companyId, actor.companyId ?? ""), eq(heartbeatRuns.agentId, actor.agentId ?? ""))).limit(1);
    if (!run || run.runtimeMode !== "native") throw forbidden("EGM creator run authority unavailable");
    const scope = agentApiKeyScopeSchema.safeParse(run.contextSnapshot?.paperclipAgentJwtScope);
    if (run.contextSnapshot?.paperclipAgentJwtScope !== undefined && !scope.success) throw forbidden("EGM admitted key scope is invalid");
    const admittedScope = scope.success ? scope.data : run.contextSnapshot?.paperclipSkillTest && run.nativeIssueId
      ? { kind: "skill_test" as const, issueId: run.nativeIssueId } : null;
    if (actor.keyScope && admittedScope && !isDeepStrictEqual(actor.keyScope, admittedScope)) throw forbidden("EGM run key scope changed");
    actor.keyScope ??= admittedScope ?? { kind: "standard" };
    const responsible = await createHeartbeatRunPreparation(db).resolveResponsibleUserIdForRunContext(run, run.contextSnapshot ?? {});
    if (actor.onBehalfOfUserId && actor.onBehalfOfUserId !== responsible) throw forbidden("EGM creator responsible user changed");
    actor.onBehalfOfUserId = responsible;
    const raw = run.runnerProfileJson?.nativeExecutionInput;
    if (raw || actor.authorizingUserId) {
      const execution = parseNativeExecutionInput(raw);
      if (execution.binding.runId !== run.id || execution.binding.companyId !== run.companyId || execution.binding.agentId !== run.agentId) throw forbidden("EGM execution authority does not match");
      if (execution.schema === "paperclip.native-execution-input.v8") {
        const authorizer = await museRunnerBroker(db).authorizingUserIdForBinding(execution.provider.binding);
        if (actor.authorizingUserId && actor.authorizingUserId !== authorizer) throw forbidden("EGM external authorizer changed");
        actor.authorizingUserId = authorizer;
      } else if (actor.authorizingUserId) throw forbidden("EGM external authorizer is not bound to this run");
    }
  }
  await requireApprovedUser(db, actor.onBehalfOfUserId, actor.companyId);
  if (actor.authorizingUserId) await requireApprovedUser(db, actor.authorizingUserId, actor.companyId);
  return actor;
}

/** Prospective reviewer uses the same issue/routine/default resolver as native
 * automation admission. Actual reviewer runs are rechecked at preparation. */
export async function egmExecutionActor(db: Db, input: { companyId: string; issueId: string; agentId: string; runId?: string }): Promise<AuthorizationActor> {
  if (input.runId) return refreshEgmActor(db, { type: "agent", companyId: input.companyId, agentId: input.agentId, runId: input.runId, source: "agent_jwt" });
  const owner = createHeartbeatRunPreparation(db);
  const issue = await owner.getIssueExecutionContext(input.companyId, input.issueId);
  if (!issue) throw forbidden("EGM task authority unavailable");
  const responsible = await owner.resolveResponsibleUserIdForRunSeed({ companyId: input.companyId,
    contextSnapshot: { issueId: input.issueId, wakeReason: "native_completion_review" }, issueContext: issue,
    routineEnvContext: await owner.getRoutineEnvForExecutionIssue(input.companyId, issue), source: "automation", triggerDetail: "system" });
  const actor: AuthorizationActor = { type: "agent", companyId: input.companyId, agentId: input.agentId,
    source: "agent_jwt", onBehalfOfUserId: responsible, keyScope: issue.workMode === "skill_test" ? { kind: "skill_test", issueId: issue.id } : { kind: "standard" } };
  const [agent] = await db.select().from(agents).where(and(eq(agents.id, input.agentId), eq(agents.companyId, input.companyId))).limit(1);
  if (!agent) throw forbidden("EGM reviewer unavailable");
  if (agent.adapterConfig?.provider === "muse") {
    const binding = await museRunnerBroker(db).snapshot(input.companyId, input.agentId, String(agent.adapterConfig.museBindingId ?? ""));
    actor.authorizingUserId = await museRunnerBroker(db).authorizingUserIdForBinding(binding);
  }
  return refreshEgmActor(db, actor);
}
