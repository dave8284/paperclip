import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { agents, agentosAssignments, agentosEmployees, companies, type Db } from "@paperclipai/db";
import { employeeAwarenessQuerySchema, type EmployeeAwareness, type EmployeeAwarenessQuery } from "@paperclipai/shared";
import { forbidden, notFound } from "../errors.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { fridayAwarenessService } from "./friday-awareness.js";

const assignmentSelection = {
  assignmentId: agentosAssignments.id, companyId: companies.id, companyName: companies.name,
  agentId: agents.id, agentName: agents.name, agentStatus: agents.status, department: agentosAssignments.department,
};

/** On-demand shared-identity lookup; no credentials, transcripts or execution.
 * Only metadata discovery grows with the employee's admitted assignments.
 * Native authorization runs in batches of eight and at most five work pages
 * (25 tasks each) are read. Counts and pagination follow authorization. */
export function employeeAwarenessService(db: Db) {
  return {
    async read(companyId: string, agentId: string, actor: AuthorizationActor, input: EmployeeAwarenessQuery): Promise<EmployeeAwareness> {
      const query = employeeAwarenessQuerySchema.parse(input);
      if (actor.type === "none" || (actor.type === "agent" && (
        actor.companyId !== companyId || actor.agentId !== agentId
        || (actor.keyScope && actor.keyScope.kind !== "standard")
      ))) throw forbidden("Employee awareness requires your own standard company assignment");

      // Refresh membership decisions for this read, preserving every identity,
      // responsible user, run, consented company and restricted-key boundary.
      // A caller's previously captured membership arrays are not current proof.
      const readActor: AuthorizationActor = { ...actor, memberships: undefined, onBehalfOfMemberships: undefined };
      Reflect.deleteProperty(readActor, "__responsibleUserSnapshotMemo");
      const authorization = authorizationService(db);
      const unrestrictedBoard = actor.type === "board" && (actor.source === "local_implicit"
        || (actor.isInstanceAdmin === true && actor.ignoreInstanceAdmin !== true && actor.source !== "mcp_oauth"));
      const admittedCompanyIds = actor.type === "agent" ? [companyId] : actor.companyIds ?? [];
      const admitted = (id: string) => unrestrictedBoard || admittedCompanyIds.includes(id);
      async function canRead(targetCompanyId: string, targetAgentId: string) {
        if (!admitted(targetCompanyId)) return false;
        const [company] = await authorization.decideReads(readActor, [{ type: "company", companyId: targetCompanyId }]);
        if (!company?.allowed) return false;
        return (await authorization.decide({ actor: readActor, action: "agent:read",
          resource: { type: "agent", companyId: targetCompanyId, agentId: targetAgentId } })).allowed;
      }
      if (!await canRead(companyId, agentId)) throw notFound("Employee not found");

      const [source] = await db.select({ ...assignmentSelection, portfolioId: agentosAssignments.portfolioId,
        employeeId: agentosEmployees.id, employeeName: agentosEmployees.name, specialty: agentosEmployees.specialty,
      }).from(agents).innerJoin(companies, eq(companies.id, agents.companyId))
        .leftJoin(agentosAssignments, and(eq(agentosAssignments.companyId, agents.companyId), eq(agentosAssignments.agentId, agents.id), eq(agentosAssignments.status, "active")))
        .leftJoin(agentosEmployees, and(eq(agentosEmployees.id, agentosAssignments.employeeId), eq(agentosEmployees.portfolioId, agentosAssignments.portfolioId)))
        .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).limit(1);
      if (!source) throw notFound("Employee not found");

      const candidates = source.employeeId && source.portfolioId
        ? await db.select(assignmentSelection).from(agentosAssignments)
          .innerJoin(agents, and(eq(agents.id, agentosAssignments.agentId), eq(agents.companyId, agentosAssignments.companyId)))
          .innerJoin(companies, eq(companies.id, agentosAssignments.companyId))
          .where(and(eq(agentosAssignments.employeeId, source.employeeId), eq(agentosAssignments.portfolioId, source.portfolioId), eq(agentosAssignments.status, "active"),
            unrestrictedBoard ? undefined : admittedCompanyIds.length ? inArray(agentosAssignments.companyId, admittedCompanyIds) : sql`false`))
          .orderBy(asc(companies.name), asc(companies.id), asc(agentosAssignments.id))
        : [source];
      const visible: Array<(typeof candidates)[number]> = [];
      for (let offset = 0; offset < candidates.length; offset += 8) {
        const batch = candidates.slice(offset, offset + 8);
        const decisions = await Promise.all(batch.map(candidate => canRead(candidate.companyId, candidate.agentId)));
        visible.push(...batch.filter((_, index) => decisions[index]));
      }
      const work = fridayAwarenessService(db);
      const assignments: EmployeeAwareness["assignments"] = [];
      for (const candidate of visible.slice(query.offset, query.offset + query.limit)) {
        assignments.push({ assignmentId: candidate.assignmentId,
          company: { id: candidate.companyId, name: candidate.companyName },
          agent: { id: candidate.agentId, name: candidate.agentName, status: candidate.agentStatus },
          department: candidate.department,
          work: await work.work(candidate.companyId, readActor, { agentId: candidate.agentId, offset: 0, projectOffset: 0, limit: 25, status: "all" }),
        });
      }
      return { observedAt: new Date().toISOString(), scope: actor.type === "agent" ? "current_company" : "authorized_companies",
        employee: source.employeeId ? { id: source.employeeId, name: source.employeeName!, specialty: source.specialty! } : null,
        assignments, nextOffset: visible.length > query.offset + query.limit ? query.offset + query.limit : null };
    },
  };
}
