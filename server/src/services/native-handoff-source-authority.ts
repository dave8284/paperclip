import { and, eq, isNull } from "drizzle-orm";
import { dotAgentBindings, mcpOauthGrants, museAgentBindings, type heartbeatRuns, type Db } from "@paperclipai/db";
import { forbidden } from "../errors.js";
import { withExternalAdmissionGuard, type ExternalAdmissionTransaction } from "../modules/external-agents/index.js";
import { parseNativeExecutionInput } from "../vendor/paperclip-runner/index.js";
import { authorizeExternalBotBinding } from "./external-bot-authority.js";
import type { AuthorizationActor } from "./authorization.js";

type Run = typeof heartbeatRuns.$inferSelect;
export interface NativeHandoffSourceAuthority {
  /** Signed native authorizer projection (Muse); retained by same-company handoffs. */
  authorizingUserId?: string;
  /** Current connection owner; an additional ceiling for portfolio writes. */
  connectionUserId?: string;
  additionalCeilingUserIds?: string[];
}

export function nativeHandoffSourceContexts(actor: AuthorizationActor, authority: NativeHandoffSourceAuthority) {
  if (actor.type !== "agent") throw forbidden("A handoff requires its original agent identity");
  const authorizer = authority.authorizingUserId ?? authority.connectionUserId;
  if (actor.authorizingUserId && actor.authorizingUserId !== authorizer) throw forbidden("The original external authorizer changed");
  const effectiveActor = { ...actor, authorizingUserId: authorizer };
  return { effectiveActor, contexts: [effectiveActor, ...[...new Set(authority.additionalCeilingUserIds ?? [])]
    .filter(id => id !== authorizer && id !== actor.onBehalfOfUserId).sort().map(authorizingUserId => ({ ...actor, authorizingUserId }))] };
}

/** Called under the source run lock and inside the mutation/admission transaction.
 * Revalidate the persisted binding after a source turn settles; do not require
 * the old provider assignment to remain live or launch a new provider turn. */
export async function nativeHandoffSourceAuthority(db: Db, run: Run): Promise<NativeHandoffSourceAuthority> {
  const raw = run.runnerProfileJson?.nativeExecutionInput as Record<string, unknown> | undefined;
  const provider = raw?.provider as Record<string, unknown> | undefined;
  if (!["openai_dot_mcp", "grok_bot_mcp", "muse_external"].includes(run.driverKind ?? "")
    && !["openai_dot", "grok_bot", "muse"].includes(String(provider?.kind))) return {};
  let execution: ReturnType<typeof parseNativeExecutionInput>;
  try { execution = parseNativeExecutionInput(raw); } catch { throw forbidden("Pinned handoff source authority is unavailable"); }
  if (execution.binding.companyId !== run.companyId || execution.binding.agentId !== run.agentId || execution.binding.runId !== run.id
    || execution.binding.issueId !== (run.nativeIssueId ?? run.issueId ?? run.contextSnapshot?.issueId)) throw forbidden("Pinned handoff source identity changed");
  return withExternalAdmissionGuard(db as unknown as ExternalAdmissionTransaction, run.companyId, run.agentId, async () => {
    if (execution.schema === "paperclip.native-execution-input.v8") {
      const ref = execution.provider.binding;
      const [binding] = await db.select().from(museAgentBindings).where(and(eq(museAgentBindings.id, ref.bindingId),
        eq(museAgentBindings.companyId, run.companyId), eq(museAgentBindings.agentId, run.agentId),
        eq(museAgentBindings.generation, ref.bindingGeneration), isNull(museAgentBindings.revokedAt))).for("share", { noWait: true });
      if (!binding) throw forbidden("Handoff source connection was revoked or replaced");
      if (binding.grantId) {
        const [grant] = await db.select().from(mcpOauthGrants).where(and(eq(mcpOauthGrants.id, binding.grantId), isNull(mcpOauthGrants.revokedAt))).for("share", { noWait: true });
        if (!grant) throw forbidden("Handoff source connection was revoked");
      }
      const { museRunnerBroker } = await import("./muse-runner-broker.js");
      const authorizingUserId = await museRunnerBroker(db).authorizingUserIdForBinding(ref);
      return { authorizingUserId, connectionUserId: authorizingUserId };
    }
    if (execution.schema === "paperclip.native-execution-input.v6") {
      const ref = execution.provider.binding;
      const [binding] = await db.select().from(dotAgentBindings).where(and(eq(dotAgentBindings.id, ref.bindingId), eq(dotAgentBindings.companyId, run.companyId),
        eq(dotAgentBindings.agentId, run.agentId), eq(dotAgentBindings.generation, ref.bindingGeneration), isNull(dotAgentBindings.revokedAt))).for("share", { noWait: true });
      const [grant] = binding?.grantId ? await db.select().from(mcpOauthGrants).where(and(eq(mcpOauthGrants.id, binding.grantId), isNull(mcpOauthGrants.revokedAt))).for("share", { noWait: true }) : [];
      if (!binding || !grant) throw forbidden("Handoff source connection was revoked");
      const current = await authorizeExternalBotBinding(db, { grant, actor: { type: "agent", agentId: binding.agentId, companyId: binding.companyId },
        company: { id: binding.companyId, name: "", issuePrefix: "", status: "active" } }, { provider: execution.provider.kind });
      if (current.id !== binding.id || current.generation !== ref.bindingGeneration) throw forbidden("Handoff source connection was replaced");
      return { connectionUserId: grant.userId,
        additionalCeilingUserIds: current.operatorId && current.operatorId !== grant.userId ? [current.operatorId] : [] };
    }
    throw forbidden("Pinned external handoff authority is unavailable");
  });
}
