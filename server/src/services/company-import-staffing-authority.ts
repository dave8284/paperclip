import { eq } from "drizzle-orm";
import { companies, type Db } from "@paperclipai/db";
import { normalizeAgentUrlKey, type CompanyPortabilityAgentManifestEntry, type CompanyPortabilityPreviewAgentPlan } from "@paperclipai/shared";
import { conflict, forbidden, unprocessable } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { resolveAgentHiringAuthority } from "./agent-hiring-authority.js";

type ManifestAgent = Pick<CompanyPortabilityAgentManifestEntry,
  "slug" | "role" | "reportsToSlug" | "reportsToExistingAgentId" | "reportsToExistingAgentSlug" | "permissionGrants">;
type Manager = { existingId: string } | { importedSlug: string } | null;

/** Validate the selected import before its first write. Audit identities cannot
 * authorize imports: callers must carry the original authenticated actor. */
export async function prepareAgentImportStaffing(db: Db, input: {
  actor: AuthorizationActor;
  companyId: string;
  agents: readonly ManifestAgent[];
  plans: readonly CompanyPortabilityPreviewAgentPlan[];
  existing: readonly { id: string; name: string; companyId: string }[];
}) {
  const { actor, companyId } = input;
  const authority = await resolveAgentHiringAuthority(db, companyId, actor, {});
  const [company] = await db.select({ requiresApproval: companies.requireBoardApprovalForNewAgents }).from(companies).where(eq(companies.id, companyId));
  if (!company) throw forbidden("The target company is unavailable.");
  if (company.requiresApproval && input.plans.some(plan => plan.action !== "skip"))
    throw conflict("This company requires individual hire approvals. Submit the employees through agent hires.");
  const selected = new Map(input.agents.map(agent => [agent.slug, agent]));
  const plans = new Map(input.plans.map(plan => [plan.slug, plan]));
  const existing = new Map(input.existing.filter(agent => agent.companyId === companyId).map(agent => [agent.id, agent]));
  const bySlug = new Map([...existing.values()].map(agent => [normalizeAgentUrlKey(agent.name) ?? agent.id, agent.id]));
  const managers = new Map<string, Manager>();
  for (const plan of input.plans) {
    const agent = selected.get(plan.slug);
    if (!agent) throw unprocessable(`Missing selected employee ${plan.slug}.`);
    if (plan.action === "update") throw forbidden("Agent team imports cannot replace existing employees.");
    if (authority.departmentHead && agent.role === "ceo") throw forbidden("Department heads cannot install a CEO or a top-level company team.");
    if (plan.action === "skip") {
      if (!plan.existingAgentId || !existing.has(plan.existingAgentId)) throw forbidden("The existing employee must belong to this company.");
      if (authority.departmentHead) await resolveAgentHiringAuthority(db, companyId, actor, { role: agent.role, reportsTo: plan.existingAgentId }, { requireDepartmentHead: true });
      continue;
    }
    if (agent.permissionGrants?.length) throw forbidden("A board member must install teams with explicit permission grants.");
    let manager: Manager = null;
    if (agent.reportsToExistingAgentId || agent.reportsToExistingAgentSlug) {
      const id = agent.reportsToExistingAgentId ?? bySlug.get(agent.reportsToExistingAgentSlug!);
      if (!id || !existing.has(id)) throw forbidden("The hiring manager must belong to this company.");
      manager = { existingId: id };
    } else if (agent.reportsToSlug) {
      const parentPlan = plans.get(agent.reportsToSlug);
      if (parentPlan?.action === "skip" && parentPlan.existingAgentId) manager = { existingId: parentPlan.existingAgentId };
      else if (parentPlan) manager = { importedSlug: parentPlan.slug };
      else {
        const id = bySlug.get(agent.reportsToSlug);
        if (!id) throw unprocessable(`Missing manager ${agent.reportsToSlug} for employee ${agent.slug}.`);
        manager = { existingId: id };
      }
    }
    managers.set(agent.slug, manager);
  }
  const ordered: CompanyPortabilityPreviewAgentPlan[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  async function visit(slug: string, depth = 0): Promise<string | null> {
    if (depth > 100 || visiting.has(slug)) throw unprocessable("The imported reporting team contains a cycle or is too deep.");
    const plan = plans.get(slug)!;
    if (plan.action === "skip") {
      if (!visited.has(slug)) { ordered.push(plan); visited.add(slug); }
      return plan.existingAgentId;
    }
    visiting.add(slug);
    const manager = managers.get(slug);
    const root = manager && "importedSlug" in manager ? await visit(manager.importedSlug, depth + 1) : manager?.existingId ?? null;
    visiting.delete(slug);
    if (!visited.has(slug)) {
      // For a head every new branch must explicitly terminate in its current
      // native team. Do not silently turn an unanchored company root into staff.
      await resolveAgentHiringAuthority(db, companyId, actor, { role: selected.get(slug)!.role, reportsTo: root }, { requireDepartmentHead: authority.departmentHead });
      ordered.push(plan);
      visited.add(slug);
    }
    return root;
  }
  for (const plan of input.plans) await visit(plan.slug);
  return {
    departmentHead: authority.departmentHead,
    plans: ordered,
    managerId(slug: string, importedIds: ReadonlyMap<string, string>): string | null {
      const manager = managers.get(slug);
      if (!manager) return null;
      if ("existingId" in manager) return manager.existingId;
      const id = importedIds.get(manager.importedSlug);
      if (!id) throw conflict("An imported manager is not ready. Retry the team installation.");
      return id;
    },
  };
}
