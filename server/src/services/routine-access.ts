import { routineRevisions, type Db } from "@paperclipai/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { RoutineDetail, RoutineListItem, RoutineRevision, RoutineRunSummary } from "@paperclipai/shared";
import { authorizationService, type AuthorizationActor } from "./authorization.js";

type RoutineScope = { companyId: string; projectId?: string | null; parentIssueId?: string | null };
type RoutineHistoryScope = RoutineScope & { id: string; latestRevisionId: string | null; latestRevisionNumber: number };
const routineKey = (row: { companyId: string; id: string }) => `${row.companyId}:${row.id}`;
const validSnapshot = sql<boolean>`coalesce(
  ${routineRevisions.snapshot}->>'version' = '1'
  and jsonb_typeof(${routineRevisions.snapshot}->'routine') = 'object'
  and (${routineRevisions.snapshot}->'routine') ? 'projectId'
  and (${routineRevisions.snapshot}->'routine') ? 'parentIssueId'
  and ${routineRevisions.snapshot}->'routine'->>'id' = ${routineRevisions.routineId}::text
  and ${routineRevisions.snapshot}->'routine'->>'companyId' = ${routineRevisions.companyId}::text,
false)`;

/** A routine inherits the visibility of its project and parent task. Reuse the
 * native read evaluator, including responsible-user and execution boundaries.
 * Deduplicate references in one request-scoped batch rather than reading access
 * once per routine/cycle. No authorization result survives the request. */
export function routineAccessService(db: Db) {
  const access = authorizationService(db);
  async function filterScopes<T extends RoutineScope>(actor: AuthorizationActor, rows: T[]): Promise<T[]> {
    const resources = new Map<string, Parameters<typeof access.decideReads>[1][number]>();
    const keys = rows.map(row => {
      const references = [{ key: `company:${row.companyId}`, resource: { type: "company" as const, companyId: row.companyId } },
        ...(row.projectId ? [{ key: `project:${row.companyId}:${row.projectId}`, resource: { type: "project" as const, companyId: row.companyId, projectId: row.projectId } }] : []),
        ...(row.parentIssueId ? [{ key: `issue:${row.companyId}:${row.parentIssueId}`, resource: { type: "issue" as const, companyId: row.companyId, issueId: row.parentIssueId } }] : [])];
      for (const reference of references) resources.set(reference.key, reference.resource);
      return references.map(reference => reference.key);
    });
    if (!resources.size) return [];
    const decisions = await access.decideReads(actor, [...resources.values()]);
    const allowed = new Set([...resources.keys()].filter((_key, index) => decisions[index]?.allowed));
    return rows.filter((_row, index) => keys[index]!.every(key => allowed.has(key)));
  }
  async function filterRuns(actor: AuthorizationActor, rows: RoutineRunSummary[]) {
    const revisionIds = [...new Set(rows.flatMap(run => run.routineRevisionId ? [run.routineRevisionId] : []))];
    const revisions = [];
    for (let offset = 0; offset < revisionIds.length; offset += 500) {
      revisions.push(...await db.select({ id: routineRevisions.id, companyId: routineRevisions.companyId, routineId: routineRevisions.routineId,
        projectId: sql<string | null>`${routineRevisions.snapshot}->'routine'->>'projectId'`,
        parentIssueId: sql<string | null>`${routineRevisions.snapshot}->'routine'->>'parentIssueId'`,
      }).from(routineRevisions).where(and(inArray(routineRevisions.id, revisionIds.slice(offset, offset + 500)), validSnapshot)));
    }
    const visibleRevisions = new Map((await filterScopes(actor, revisions)).map(revision => [revision.id, revision]));
    const visibleTasks = new Set((await filterScopes(actor, rows.map(run => ({ ...run, parentIssueId: run.linkedIssueId })))).map(run => run.id));
    return rows.filter(run => {
      const revision = run.routineRevisionId ? visibleRevisions.get(run.routineRevisionId) : null;
      return visibleTasks.has(run.id) && (!run.routineRevisionId || (revision?.companyId === run.companyId && revision?.routineId === run.routineId));
    });
  }
  async function readableHistories(actor: AuthorizationActor, rows: RoutineHistoryScope[]) {
    // Document anchors and trigger markers do not pin the routine's original
    // scope. Require every possible historical scope; never infer provenance
    // from timestamps. Batch all selected routines and read scope IDs only.
    const candidates = rows.filter(row => row.latestRevisionId && row.latestRevisionNumber > 0);
    if (!candidates.length) return new Set<string>();
    const projectId = sql<string | null>`${routineRevisions.snapshot}->'routine'->>'projectId'`;
    const parentIssueId = sql<string | null>`${routineRevisions.snapshot}->'routine'->>'parentIssueId'`;
    const scopes = await db.select({ companyId: routineRevisions.companyId, routineId: routineRevisions.routineId, projectId, parentIssueId,
      count: sql<number>`count(*)::int`, first: sql<number>`min(${routineRevisions.revisionNumber})`, last: sql<number>`max(${routineRevisions.revisionNumber})`,
      currentId: sql<string | null>`max(case when ${inArray(routineRevisions.id, candidates.map(row => row.latestRevisionId!))} then ${routineRevisions.id}::text else null end)`,
      valid: sql<boolean>`bool_and(${validSnapshot})`,
    }).from(routineRevisions).where(inArray(routineRevisions.routineId, candidates.map(row => row.id)))
      .groupBy(routineRevisions.companyId, routineRevisions.routineId, projectId, parentIssueId).limit(1001);
    if (scopes.length > 1000) return new Set<string>();
    const readable = new Set(await filterScopes(actor, scopes));
    const allowed = new Set<string>();
    for (const row of candidates) {
      const history = scopes.filter(scope => scope.companyId === row.companyId && scope.routineId === row.id);
      if (!history.length || history.some(scope => !scope.valid || !readable.has(scope))
        || !history.some(scope => scope.currentId === row.latestRevisionId)
        || history.reduce((sum, scope) => sum + Number(scope.count), 0) !== row.latestRevisionNumber
        || Math.min(...history.map(scope => Number(scope.first))) !== 1
        || Math.max(...history.map(scope => Number(scope.last))) !== row.latestRevisionNumber) continue;
      allowed.add(routineKey(row));
    }
    return allowed;
  }
  function hasHistoryMarkers(row: RoutineListItem | RoutineDetail) {
    return Boolean(row.lastTriggeredAt || row.lastEnqueuedAt || row.triggers.some(trigger => trigger.lastFiredAt || trigger.lastResult || ("lastWebhookDelivery" in trigger && trigger.lastWebhookDelivery)));
  }
  return {
    filterScopes,
    canRead: async (actor: AuthorizationActor, row: RoutineScope) => (await filterScopes(actor, [row])).length === 1,
    canReadAnnotationHistory: async (actor: AuthorizationActor, row: RoutineHistoryScope) => (await readableHistories(actor, [row])).has(routineKey(row)),
    filterRuns,
    filterRevisions: async (actor: AuthorizationActor, rows: RoutineRevision[]) => {
      const scopes = rows.map(revision => ({ ...revision.snapshot.routine, revision }));
      return (await filterScopes(actor, scopes)).map(row => row.revision);
    },
    filterList: async (actor: AuthorizationActor, rows: RoutineListItem[]) => {
      const visible = await filterScopes(actor, rows);
      const related = visible.flatMap(row => row.activeIssue ? [{ companyId: row.companyId, parentIssueId: row.activeIssue.id }] : []);
      const readable = new Set((await filterScopes(actor, related)).map(row => `${row.companyId}:${row.parentIssueId}`));
      const visibleRuns = new Set((await filterRuns(actor, visible.flatMap(row => row.lastRun ? [row.lastRun] : []))).map(run => `${run.companyId}:${run.id}`));
      const completeHistory = await readableHistories(actor, visible.filter(hasHistoryMarkers));
      return visible.map(row => {
        const activeHidden = Boolean(row.activeIssue && !readable.has(`${row.companyId}:${row.activeIssue.id}`));
        const lastHidden = Boolean(row.lastRun && !visibleRuns.has(`${row.companyId}:${row.lastRun.id}`));
        const historyHidden = activeHidden || lastHidden || (hasHistoryMarkers(row) && !completeHistory.has(routineKey(row)));
        return { ...row, activeIssue: activeHidden ? null : row.activeIssue, lastRun: lastHidden ? null : row.lastRun,
          lastTriggeredAt: historyHidden ? null : row.lastTriggeredAt,
          lastEnqueuedAt: historyHidden ? null : row.lastEnqueuedAt,
          triggers: historyHidden ? row.triggers.map(trigger => ({ ...trigger, lastFiredAt: null, lastResult: null })) : row.triggers,
        };
      });
    },
    filterDetail: async (actor: AuthorizationActor, row: RoutineDetail): Promise<RoutineDetail | null> => {
      if (!(await filterScopes(actor, [row])).length) return null;
      const activeReadable = !row.activeIssue || (await filterScopes(actor, [{ companyId: row.companyId, parentIssueId: row.activeIssue.id }])).length > 0;
      const recentRuns = await filterRuns(actor, row.recentRuns);
      const completeHistory = !hasHistoryMarkers(row) || (await readableHistories(actor, [row])).has(routineKey(row));
      const historyHidden = !activeReadable || recentRuns.length !== row.recentRuns.length || !completeHistory;
      return { ...row, activeIssue: activeReadable ? row.activeIssue : null, recentRuns,
        lastTriggeredAt: historyHidden ? null : row.lastTriggeredAt,
        lastEnqueuedAt: historyHidden ? null : row.lastEnqueuedAt,
        triggers: historyHidden ? row.triggers.map(trigger => ({ ...trigger, lastFiredAt: null, lastResult: null, lastWebhookDelivery: null })) : row.triggers,
      };
    },
  };
}
