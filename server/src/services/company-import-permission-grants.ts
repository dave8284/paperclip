import type { Db } from "@paperclipai/db";
import type { CompanyPortabilityAgentManifestEntry } from "@paperclipai/shared";
import { conflict, forbidden } from "../errors.js";
import { authorizeBoardAgentPermissionGrant } from "./agent-application-grants.js";
import type { AuthorizationActor } from "./authorization.js";
import { accessService } from "./access.js";
import { persistActivity } from "./activity-log.js";
import { createAgentLifecycle, createAgentImportLifecycle } from "./agent-lifecycle.js";

type Grant = CompanyPortabilityAgentManifestEntry["permissionGrants"][number];
type Authority = { companyId: string; actor?: AuthorizationActor; grants: readonly Grant[]; baselineTaskAssignment?: boolean; baselineGrantedByUserId?: string | null };
type ImportLifecycle = ReturnType<typeof createAgentImportLifecycle>;
function authenticated(input: Authority) {
  if (input.actor?.type !== "board") throw forbidden("A board member must authorize imported permission grants.");
  return { companyId: input.companyId, actor: input.actor,
    requireApplicationManagement: input.grants.some(grant => grant.permissionKey === "applications:manage") };
}
function authorityFailure(error: unknown): never {
  const failure = error as { code?: string; cause?: { code?: string } };
  if ((failure?.cause?.code ?? failure?.code) === "55P03") throw conflict("Import permission authority is changing. Retry the import.", { retryable: true });
  throw error;
}

/** Run once for all selected, non-skipped grants before any import mutation.
 * Existing grant keys keep native board permission-management authority; the
 * new applications capability additionally requires the same granting ceiling. */
export async function preflightImportedAgentPermissionGrants(db: Db, input: Authority) {
  if (!input.grants.length) return;
  const authority = authenticated(input);
  await db.transaction(tx => authorizeBoardAgentPermissionGrant(tx as unknown as Db, authority)).catch(authorityFailure);
}

/** Revalidate after adapter/file preparation and commit the employee and its
 * grants together. Package fetching and file materialization stay outside the
 * native lifecycle transaction. */
export async function mutateImportedAgentWithGrants<T extends { id: string }>(db: Db, input: Authority,
  mutate: (lifecycle: ImportLifecycle) => Promise<T | null>): Promise<T | null> {
  if (!input.grants.length) {
    const employee = await mutate(createAgentLifecycle(db));
    if (employee && input.baselineTaskAssignment) await accessService(db).setPrincipalPermission(
      input.companyId, "agent", employee.id, "tasks:assign", true, input.baselineGrantedByUserId ?? null);
    return employee;
  }
  const authority = authenticated(input);
  const lifecycle = createAgentImportLifecycle(db, {
    companyId: input.companyId,
    authorize: async tx => { await authorizeBoardAgentPermissionGrant(tx, authority); },
    writeGrants: async (tx, publications, employee) => {
      // The native single-key writer preserves every existing role/status.
      // Baseline grants precede scoped manifest rules, as in ordinary imports.
      const access = accessService(tx);
      if (input.baselineTaskAssignment) await access.setPrincipalPermission(input.companyId, "agent", employee.id,
        "tasks:assign", true, authority.actor.userId ?? null);
      for (const grant of input.grants) await access.setPrincipalPermission(input.companyId, "agent", employee.id,
        grant.permissionKey, true, authority.actor.userId ?? null, grant.scope ?? null);
      const activity = await persistActivity(tx, { companyId: input.companyId, actorType: "user", actorId: authority.actor.userId ?? "local-board",
        action: "agent.permissions_updated", entityType: "agent", entityId: employee.id,
        details: { source: "company_import", permissionKeys: input.grants.map(grant => grant.permissionKey) } });
      publications.push(activity.publication);
    },
  });
  return mutate(lifecycle).catch(authorityFailure);
}
