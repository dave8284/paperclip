import { and, asc, eq, inArray } from "drizzle-orm";
import { agentosDepartments, agentosDepartmentProjects, agents, projects, type Db } from "@paperclipai/db";
import type { FridayAccountability } from "@paperclipai/shared";
import { accessService } from "./access.js";
import { projectReadSqlCondition, type AuthorizationActor } from "./authorization.js";

const MAX_REPORTING_LEVELS = 8;
const MAX_PEOPLE = 512;
const AUTHORIZATION_BATCH_SIZE = 16;

/** Read-only accountability for the already-authorized work page. A title or
 * department membership never grants project access or authority to delegate. */
export async function fridayAccountability(
  db: Db, companyId: string, actor: AuthorizationActor,
  projectIds: string[], ownerIds: string[],
): Promise<FridayAccountability> {
  const rows = projectIds.length ? await db.select({
    projectId: projects.id, leadAgentId: projects.leadAgentId,
    departmentId: agentosDepartments.id, departmentName: agentosDepartments.name,
    departmentLeadAgentId: agentosDepartments.leadAgentId,
  }).from(projects)
    .leftJoin(agentosDepartmentProjects, and(eq(agentosDepartmentProjects.companyId, companyId), eq(agentosDepartmentProjects.projectId, projects.id)))
    .leftJoin(agentosDepartments, and(eq(agentosDepartments.companyId, companyId), eq(agentosDepartments.id, agentosDepartmentProjects.departmentId)))
    .where(and(eq(projects.companyId, companyId), inArray(projects.id, projectIds), await projectReadSqlCondition(db, actor)))
    .orderBy(asc(projects.id)) : [];
  const seeds = [...new Set([...ownerIds, ...rows.flatMap(row => [row.leadAgentId, row.departmentLeadAgentId].filter((id): id is string => !!id))])];
  const people = new Map<string, FridayAccountability["people"][number]>();
  const checked = new Set<string>();
  let pending = seeds;
  let truncated = false;
  const access = accessService(db);
  for (let depth = 0; pending.length && depth < MAX_REPORTING_LEVELS; depth++) {
    const capacity = MAX_PEOPLE - checked.size;
    if (capacity <= 0) { truncated = true; break; }
    if (pending.length > capacity) truncated = true;
    const ids = pending.slice(0, capacity);
    ids.forEach(id => checked.add(id));
    const candidates = await db.select({ id: agents.id, name: agents.name, role: agents.role, title: agents.title, status: agents.status, reportsTo: agents.reportsTo })
      .from(agents).where(and(eq(agents.companyId, companyId), inArray(agents.id, ids))).orderBy(asc(agents.id));
    // Match the native employee read boundary, including responsible-user and
    // restricted-run intersections. Never project instructions or credentials.
    const allowed: typeof candidates = [];
    for (let offset = 0; offset < candidates.length; offset += AUTHORIZATION_BATCH_SIZE) {
      const batch = candidates.slice(offset, offset + AUTHORIZATION_BATCH_SIZE);
      const decisions = await Promise.all(batch.map(person => access.decide({ actor, action: "agent:read", resource: { type: "agent", companyId, agentId: person.id } })));
      allowed.push(...batch.filter((_, index) => decisions[index]?.allowed));
    }
    allowed.forEach(person => people.set(person.id, person));
    pending = [...new Set(allowed.flatMap(person => person.reportsTo && !checked.has(person.reportsTo) ? [person.reportsTo] : []))];
  }
  if (pending.length) truncated = true;
  const visibleId = (id: string | null) => id && people.has(id) ? id : null;
  return {
    projects: rows.map(row => ({ projectId: row.projectId, leadAgentId: visibleId(row.leadAgentId), department: row.departmentId ? {
      id: row.departmentId, name: row.departmentName!, leadAgentId: visibleId(row.departmentLeadAgentId),
    } : null })),
    people: [...people.values()].map(person => ({ ...person, reportsTo: visibleId(person.reportsTo) })),
    reportingChainTruncated: truncated,
  };
}
