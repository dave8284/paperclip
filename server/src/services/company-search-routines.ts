import { and, desc, eq, gte, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { issues, projects, routines, type Db } from "@paperclipai/db";
import { COMPANY_SEARCH_UPDATED_WITHIN_OPTIONS, type CompanySearchFilterOptionCounts, type CompanySearchQuery } from "@paperclipai/shared";
import { visibleIssueCondition } from "./issue-visibility.js";

/** Search only native routine metadata. Reuse the route's native privacy SQL
 * before counting/ranking; never load trigger secrets, environments or runs. */
export function routineSearchBranch(db: Db, input: {
  companyId: string;
  query: CompanySearchQuery;
  normalizedQuery: string;
  tokens: string[];
  containsPattern: string;
  tokenPatternArray: SQL;
  fetchLimit: number;
  issueReadCondition?: SQL<boolean>;
  projectReadCondition?: SQL<boolean>;
}) {
  const { companyId, query, normalizedQuery, tokens } = input;
  const readableProject = or(isNull(routines.projectId), sql<boolean>`exists (
    select 1 from ${projects} where ${projects.id} = ${routines.projectId}
    and ${projects.companyId} = ${companyId} and ${input.projectReadCondition ?? sql`true`}
  )`)!;
  const readableParent = or(isNull(routines.parentIssueId), sql<boolean>`exists (
    select 1 from ${issues} where ${issues.id} = ${routines.parentIssueId}
    and ${issues.companyId} = ${companyId} and ${visibleIssueCondition()}
    and ${input.issueReadCondition ?? sql`true`}
  )`)!;
  const textMatch = sql<boolean>`(
    ${routines.title} ilike ${input.containsPattern}
    or coalesce(${routines.description}, '') ilike ${input.containsPattern}
    or ${routines.title} ilike any(${input.tokenPatternArray})
    or coalesce(${routines.description}, '') ilike any(${input.tokenPatternArray})
  )`;
  const haystack = sql`lower(concat_ws(' ', ${routines.title}, ${routines.description}))`;
  const tokenScores = tokens.map(token => sql`case when position(${token} in ${haystack}) > 0 then 20 else 0 end`);
  const score = sql<number>`10 * (
    case when position(${normalizedQuery} in ${haystack}) > 0 then 90 else 0 end
    + case when starts_with(lower(${routines.title}), ${normalizedQuery}) then 80 else 0 end
    ${tokenScores.length ? sql`+ ${sql.join(tokenScores, sql` + `)}` : sql``}
  )`;
  const priority = sql<number>`case ${routines.priority} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`;
  function conditions(filters: CompanySearchQuery) {
    const values: SQL[] = [eq(routines.companyId, companyId), readableProject, readableParent, textMatch];
    // Task status, user assignees and task labels have no routine equivalent.
    if (filters.status.length || filters.assigneeUserId || filters.labelId) values.push(sql`false`);
    if (filters.projectId) values.push(eq(routines.projectId, filters.projectId));
    if (filters.assigneeAgentId !== undefined) values.push(filters.assigneeAgentId === null ? isNull(routines.assigneeAgentId) : eq(routines.assigneeAgentId, filters.assigneeAgentId));
    if (filters.priority.length) values.push(inArray(routines.priority, filters.priority));
    if (filters.updatedAfter) values.push(gte(routines.updatedAt, new Date(filters.updatedAfter)));
    if (filters.updatedWithin) {
      const match = /^(\d+)(h|d|w|m)$/.exec(filters.updatedWithin);
      if (match) {
        const hoursByUnit: Record<string, number> = { h: 1, d: 24, w: 168, m: 720 };
        const hours = Number(match[1]) * (hoursByUnit[match[2]!] ?? 0);
        values.push(gte(routines.updatedAt, new Date(Date.now() - hours * 60 * 60 * 1000)));
      }
    }
    return and(...values);
  }
  return {
    async rows() {
      if (!normalizedQuery) return [];
      const order = query.sort === "created" ? [desc(routines.createdAt), desc(routines.updatedAt)]
        : query.sort === "updated" ? [desc(routines.updatedAt), desc(score)]
        : query.sort === "priority" ? [priority, desc(routines.updatedAt), desc(score)]
        : [desc(score), desc(routines.updatedAt)];
      return db.select({ id: routines.id, title: routines.title, description: routines.description, status: routines.status,
        priority: routines.priority, assigneeAgentId: routines.assigneeAgentId, projectId: routines.projectId,
        createdAt: routines.createdAt, updatedAt: routines.updatedAt, score })
        .from(routines).where(conditions(query)).orderBy(...order, desc(routines.id)).limit(input.fetchLimit);
    },
    async count(filters = query) {
      if (!normalizedQuery) return 0;
      const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(routines).where(conditions(filters));
      return Number(row?.count ?? 0);
    },
    async facets(): Promise<CompanySearchFilterOptionCounts> {
      const counts: CompanySearchFilterOptionCounts = {
        status: {}, priority: {}, assigneeAgentId: {}, assigneeUserId: {}, projectId: {}, labelId: {}, updatedWithin: {},
      };
      if (!normalizedQuery) return counts;
      const grouped = (kind: string, column: SQL, filters: CompanySearchQuery) => sql`
        select ${kind}::text as kind, ${column}::text as value, count(*)::int as count
        from ${routines} where ${conditions(filters)} and ${column} is not null group by ${column}`;
      const branches = [
        grouped("priority", sql`${routines.priority}`, { ...query, priority: [] }),
        grouped("assigneeAgentId", sql`${routines.assigneeAgentId}`, { ...query, assigneeAgentId: undefined }),
        grouped("projectId", sql`${routines.projectId}`, { ...query, projectId: undefined }),
        ...COMPANY_SEARCH_UPDATED_WITHIN_OPTIONS.map(option => sql`
          select 'updatedWithin'::text as kind, ${option}::text as value, count(*)::int as count
          from ${routines} where ${conditions({ ...query, updatedWithin: option, updatedAfter: undefined })}`),
      ];
      const rows = await db.execute(sql.join(branches, sql` union all `)) as unknown as Array<{
        kind: "priority" | "assigneeAgentId" | "projectId" | "updatedWithin"; value: string; count: number;
      }>;
      for (const row of rows) (counts[row.kind] as Record<string, number>)[row.value] = Number(row.count);
      return counts;
    },
  };
}
