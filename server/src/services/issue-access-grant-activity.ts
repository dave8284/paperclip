import { and, eq, sql } from "drizzle-orm";
import { activityLog, issueAccessGrants, issues, type Db } from "@paperclipai/db";
import { isUuidLike } from "@paperclipai/shared";

// Historical audit entity IDs are text. Guard the cast rather than casting the
// indexed grant ID, so malformed history cannot fail the whole activity feed.
export const activityIssueAccessGrantId = sql<string | null>`case
  when ${activityLog.entityId} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then ${activityLog.entityId}::uuid end`;

export function issueAccessGrantActivityDetailsCondition() {
  return sql<boolean>`(${activityLog.details} is null or (
    jsonb_typeof(${activityLog.details}) = 'object' and (
      not (${activityLog.details} ? 'issueId') or (
        jsonb_typeof(${activityLog.details} -> 'issueId') = 'string'
        and ${activityLog.details} ->> 'issueId' = ${issues.id}::text
      )
    )
  ))`;
}

/** Resolve retained and revoked grants through their company-owned task. Never
 * infer authority from an audit detail or an explicit publication hint alone. */
export async function resolveIssueAccessGrantActivityIssueId(db: Db, input: {
  companyId: string;
  entityId: unknown;
  issueId?: unknown;
  details?: unknown;
}): Promise<string | null> {
  if (typeof input.entityId !== "string" || !isUuidLike(input.entityId)) return null;
  const [issue] = await db.select({ id: issues.id }).from(issueAccessGrants)
    .innerJoin(issues, and(eq(issues.id, issueAccessGrants.issueId), eq(issues.companyId, input.companyId)))
    .where(eq(issueAccessGrants.id, input.entityId)).limit(1);
  if (!issue || (input.issueId != null && input.issueId !== issue.id)) return null;
  if (input.details != null) {
    if (typeof input.details !== "object" || Array.isArray(input.details)) return null;
    if (Object.hasOwn(input.details, "issueId")
      && (input.details as Record<string, unknown>).issueId !== issue.id) return null;
  }
  return issue.id;
}
