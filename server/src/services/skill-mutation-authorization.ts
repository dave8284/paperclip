import type { Db } from "@paperclipai/db";
import type { SkillPolicyAction, SkillPolicyEvaluationResource } from "@paperclipai/shared";
import { forbidden, unauthorized } from "../errors.js";
import { accessService } from "./access.js";
import type { AuthorizationActor } from "./authorization.js";
import { companySkillPolicyService } from "./company-skill-policy.js";

export type SkillMutationResource = SkillPolicyEvaluationResource | Promise<SkillPolicyEvaluationResource>
  | (() => SkillPolicyEvaluationResource | Promise<SkillPolicyEvaluationResource>);

// Routes retain their native company admission; transactional callers supply
// their current, locked actor. Skill policy is the mutation governance owner,
// while platform containment and company invariants always fail closed.
export async function assertCompanySkillMutation(db: Db, actor: AuthorizationActor, companyId: string,
  action: SkillPolicyAction, resource: SkillMutationResource = {}) {
  if (actor.type === "none") throw unauthorized("Authentication required");
  if (actor.type === "agent" && actor.companyId !== companyId) throw forbidden("Agent key cannot access another company", { code: "skill_company_boundary_denied" });
  const platform = await accessService(db).decide({ actor, action: "skill_config:update", resource: { type: "company", companyId } });
  if (!platform.allowed && !["deny_no_grant", "deny_missing_consent", "deny_missing_grant"].includes(platform.reason)) {
    throw forbidden(platform.explanation, { code: platform.reason === "deny_company_boundary" ? "skill_company_boundary_denied" : "skill_actor_restricted", reason: "platform_invariant" });
  }
  const policies = companySkillPolicyService(db);
  const principal = actor.type === "agent" && actor.agentId
    ? await policies.resolveAgentPrincipal(companyId, actor.agentId)
    : actor.type === "board" ? { type: "board" as const, id: actor.userId ?? "board", role: "board" }
      : null;
  if (!principal) throw unauthorized("Authentication required");
  const decision = await policies.evaluate({ companyId, principal, action, resource: typeof resource === "function" ? await resource() : await resource });
  if (!decision.allowed) throw forbidden("Skill action denied by company policy", { code: "skill_policy_denied", reason: decision.reason,
    ...(typeof decision.remediation === "string" ? { remediation: decision.remediation } : {}) });
}
