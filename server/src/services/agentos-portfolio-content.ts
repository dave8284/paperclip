import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { agents, assets, caseAttachments, documents, issueAttachments, issueComments, issueDocuments, issues, projects, runnerApiResponseReservations, type Db } from "@paperclipai/db";
import { SYSTEM_ISSUE_DOCUMENT_KEYS, type PortfolioAttachmentQuery, type PortfolioContentQuery, type PortfolioRecordsQuery } from "@paperclipai/shared";
import { notFound } from "../errors.js";
import { portfolioOwnerReadSqlConditions, type AuthorizationActor } from "./authorization.js";
import { visibleIssueCondition } from "./issue-visibility.js";
import { companyExecutiveRoleCondition } from "./friday-board-role.js";
import { portfolioCaseFiles } from "./portfolio-case-files.js";

/** Internal projection for the mandate gateway, after its exact private grant,
 * current Friday, owner/authorizer and lifecycle locks. Never a public bypass.
 * Each content statement joins its native owner and applies current resource
 * predicates before projecting text. No configuration, run logs or tool payloads. */
export function portfolioPrivateContentProjection(db: Db, actor: AuthorizationActor, companyId: string) {
  const rights = portfolioOwnerReadSqlConditions(actor);
  const projectAccess = and(eq(projects.companyId, companyId), rights.project);
  const readableProjects = db.select({ id: projects.id }).from(projects).where(projectAccess);
  const issueAccess = and(eq(issues.companyId, companyId), visibleIssueCondition(), rights.issue,
    or(isNull(issues.projectId), inArray(issues.projectId, readableProjects)),
    // Persistent chats remain personal even when an administrator can inspect
    // ordinary private work. An external authorizer cannot broaden that scope.
    or(isNull(issues.conversationAgentId), and(eq(issues.conversationUserId, actor.onBehalfOfUserId ?? ""),
      actor.authorizingUserId ? eq(issues.conversationUserId, actor.authorizingUserId) : undefined)));
  const documentAccess = and(eq(issueDocuments.companyId, companyId),
    notInArray(issueDocuments.key, [...SYSTEM_ISSUE_DOCUMENT_KEYS]), issueAccess);
  const commentAccess = and(eq(issueComments.companyId, companyId), isNull(issueComments.deletedAt), issueAccess);
  // Attachment lineage never widens the original file's privacy. Ordinary task
  // uploads retain their source task in the storage namespace, even if relinked.
  // Drafts become readable through their attached task. Cases and API captures
  // retain separate native owners and are outside this task-file gateway.
  const originalTask = sql<string>`case when split_part(${assets.objectKey}, '/', 2) = 'assets'
    then split_part(${assets.objectKey}, '/', 4) else split_part(${assets.objectKey}, '/', 3) end`;
  const taskUpload = sql`(split_part(${assets.objectKey}, '/', 2) = 'issues'
    or (split_part(${assets.objectKey}, '/', 2) = 'assets' and split_part(${assets.objectKey}, '/', 3) = 'issues'))`;
  const attachmentAccess = and(issueAccess, eq(issueAttachments.companyId, companyId), eq(assets.companyId, companyId),
    sql`split_part(${assets.objectKey}, '/', 1) = ${companyId}`, taskUpload,
    or(sql`(split_part(${assets.objectKey}, '/', 2) = 'assets' and ${originalTask} = 'drafts')`,
      inArray(originalTask, db.select({ id: sql<string>`${issues.id}::text` }).from(issues).where(issueAccess))),
    or(isNull(issueAttachments.issueCommentId), sql`exists (${db.select({ id: issueComments.id }).from(issueComments)
      .where(and(eq(issueComments.id, issueAttachments.issueCommentId), eq(issueComments.companyId, companyId),
        eq(issueComments.issueId, issueAttachments.issueId), isNull(issueComments.deletedAt)))})`),
    sql`not exists (${db.select({ id: runnerApiResponseReservations.id }).from(runnerApiResponseReservations)
      .where(eq(runnerApiResponseReservations.assetId, assets.id))})`,
    sql`not exists (${db.select({ id: caseAttachments.id }).from(caseAttachments).where(eq(caseAttachments.assetId, assets.id))})`);
  function bodyFields(column: SQL, query: PortfolioContentQuery) {
    const body = sql`coalesce(${column}, '')`;
    const hash = sql<string>`encode(sha256(convert_to(${body}, 'UTF8')), 'hex')`;
    return { fields: {
      // Untyped bound parameters can select PostgreSQL's (text, text, text)
      // regexp overload, interpreting a page length as an invalid escape string.
      body: sql<string>`substring(${body} from ${query.offset + 1}::integer for ${query.limit}::integer)`,
      bodySha256: hash, bodyCharacters: sql<number>`char_length(${body})`,
    }, version: query.bodySha256 ? sql`${hash} = ${query.bodySha256}` : undefined };
  }
  return {
    async attachment(query: PortfolioAttachmentQuery) {
      if (query.caseId) return portfolioCaseFiles(db, companyId, { issue: issueAccess!, project: projectAccess! }).attachment(query);
      const [row] = await db.select({ attachmentId: issueAttachments.id, taskId: issues.id, assetId: assets.id,
        provider: assets.provider, objectKey: assets.objectKey, contentType: assets.contentType,
        byteSize: assets.byteSize, sha256: assets.sha256, filename: assets.originalFilename,
      }).from(issueAttachments).innerJoin(assets, and(eq(assets.id, issueAttachments.assetId), eq(assets.companyId, issueAttachments.companyId)))
        .innerJoin(issues, and(eq(issues.id, issueAttachments.issueId), eq(issues.companyId, issueAttachments.companyId)))
        .where(and(attachmentAccess, eq(issueAttachments.id, query.attachmentId), eq(issues.id, query.taskId!), eq(assets.sha256, query.sha256))).limit(1);
      if (!row) throw notFound("Attachment is unavailable or changed; rediscover the authorized record");
      return row;
    },
    async content(query: PortfolioContentQuery) {
      let row: { id: string; title: string | null; body: string; bodySha256: string; bodyCharacters: number; updatedAt: Date;
        authorAgentId?: string | null; authorUserId?: string | null; createdAt?: Date } | undefined;
      if (query.kind === "project") {
        const body = bodyFields(sql`${projects.description}`, query);
        [row] = await db.select({ id: projects.id, title: sql<string>`left(${projects.name}, 1000)`, updatedAt: projects.updatedAt, ...body.fields })
          .from(projects).where(and(projectAccess, eq(projects.id, query.resourceId), body.version)).limit(1);
      } else if (query.kind === "task") {
        const body = bodyFields(sql`${issues.description}`, query);
        [row] = await db.select({ id: issues.id, title: sql<string>`left(${issues.title}, 1000)`, updatedAt: issues.updatedAt, ...body.fields })
          .from(issues).where(and(issueAccess, eq(issues.id, query.resourceId), body.version)).limit(1);
      } else if (query.kind === "comment") {
        const body = bodyFields(sql`${issueComments.body}`, query);
        [row] = await db.select({ id: issueComments.id, title: sql<null>`null`, updatedAt: issueComments.updatedAt, ...body.fields,
          authorAgentId: issueComments.authorAgentId, authorUserId: issueComments.authorUserId, createdAt: issueComments.createdAt })
          .from(issueComments).innerJoin(issues, and(eq(issues.id, issueComments.issueId), eq(issues.companyId, issueComments.companyId)))
          .where(and(commentAccess, eq(issueComments.id, query.resourceId), body.version)).limit(1);
      } else {
        const body = bodyFields(sql`${documents.latestBody}`, query);
        [row] = await db.select({ id: documents.id, title: sql<string | null>`left(${documents.title}, 1000)`, updatedAt: documents.updatedAt, ...body.fields })
          .from(issueDocuments).innerJoin(documents, and(eq(documents.id, issueDocuments.documentId), eq(documents.companyId, issueDocuments.companyId)))
          .innerJoin(issues, and(eq(issues.id, issueDocuments.issueId), eq(issues.companyId, issueDocuments.companyId)))
          .where(and(documentAccess, eq(documents.id, query.resourceId), body.version)).limit(1);
      }
      if (!row) throw notFound("Content is unavailable or changed; rediscover the authorized record");
      const end = query.offset + Array.from(row.body).length; // PostgreSQL offsets count Unicode characters.
      return { kind: query.kind, resourceId: row.id, title: row.title, body: row.body, bodySha256: row.bodySha256,
        bodyCharacters: row.bodyCharacters, offset: query.offset, nextOffset: end < row.bodyCharacters ? end : null,
        updatedAt: row.updatedAt.toISOString(), ...(query.kind === "comment" ? {
          comment: { authorAgentId: row.authorAgentId ?? null, authorUserId: row.authorUserId ?? null, createdAt: row.createdAt!.toISOString() },
        } : {}) };
    },
    async records(query: PortfolioRecordsQuery) {
      if (query.kind === "cases" || query.kind === "case_attachments")
        return portfolioCaseFiles(db, companyId, { issue: issueAccess!, project: projectAccess! }).records(query);
      if (query.kind === "attachments") {
        const rows = await db.select({ id: issueAttachments.id, title: sql<string | null>`left(${assets.originalFilename}, 1000)`,
          updatedAt: assets.updatedAt, contentType: assets.contentType, byteSize: assets.byteSize, sha256: assets.sha256,
        }).from(issueAttachments).innerJoin(assets, and(eq(assets.id, issueAttachments.assetId), eq(assets.companyId, issueAttachments.companyId)))
          .innerJoin(issues, and(eq(issues.id, issueAttachments.issueId), eq(issues.companyId, issueAttachments.companyId)))
          .where(and(attachmentAccess, eq(issues.id, query.taskId!))).orderBy(asc(issueAttachments.createdAt), asc(issueAttachments.id))
          .offset(query.offset).limit(query.limit + 1);
        return { kind: query.kind, taskId: query.taskId!, records: rows.slice(0, query.limit).map(({ contentType, byteSize, sha256, ...row }) => ({
          ...row, updatedAt: row.updatedAt.toISOString(), attachment: { contentType, byteSize, sha256 },
        })), nextOffset: rows.length > query.limit ? query.offset + query.limit : null };
      }
      if (query.kind === "executives") {
        // The mandate owner has current company administration/read authority;
        // any external authorizer retains the native company-read ceiling.
        // A selected private project must also be readable in this statement.
        // Discovery supplies identity facts, never permission to assign or run.
        const selectedProject = query.projectId ? sql`exists (${db.select({ id: projects.id }).from(projects)
          .where(and(projectAccess, eq(projects.id, query.projectId)))})` : undefined;
        const candidates = await db.select({ id: agents.id, title: sql<string>`left(${agents.name}, 1000)`, updatedAt: agents.updatedAt,
          kind: sql<"ceo" | "department_head">`case when ${agents.role} = 'ceo' then 'ceo' else 'department_head' end`,
          status: agents.status, lifecycleState: agents.lifecycleState,
        }).from(agents).where(and(companyExecutiveRoleCondition(companyId, query.projectId), selectedProject,
          inArray(agents.status, ["active", "idle", "running", "error", "paused"]), inArray(agents.lifecycleState, ["ready", "paused"])))
          .orderBy(asc(agents.id)).offset(query.offset).limit(query.limit + 1);
        return { kind: query.kind, taskId: null, projectId: query.projectId ?? null,
          records: candidates.slice(0, query.limit).map(({ kind, status, lifecycleState, ...row }) => ({
            ...row, updatedAt: row.updatedAt.toISOString(), executive: { kind, status, lifecycleState },
          })), nextOffset: candidates.length > query.limit ? query.offset + query.limit : null };
      }
      let rows: Array<{ id: string; title: string | null; updatedAt: Date }>;
      if (query.kind === "conversations") {
        rows = await db.select({ id: issues.id, title: sql<string>`left(${issues.title}, 1000)`, updatedAt: issues.updatedAt })
          .from(issues).where(and(issueAccess, isNotNull(issues.conversationAgentId)))
          .orderBy(desc(issues.updatedAt), desc(issues.id)).offset(query.offset).limit(query.limit + 1);
      } else if (query.kind === "comments") {
        rows = await db.select({ id: issueComments.id, title: sql<null>`null`, updatedAt: issueComments.updatedAt })
          .from(issueComments).innerJoin(issues, and(eq(issues.id, issueComments.issueId), eq(issues.companyId, issueComments.companyId)))
          .where(and(commentAccess, eq(issues.id, query.taskId!)))
          .orderBy(asc(issueComments.createdAt), asc(issueComments.id)).offset(query.offset).limit(query.limit + 1);
      } else {
        rows = await db.select({ id: documents.id, title: sql<string | null>`left(${documents.title}, 1000)`, updatedAt: documents.updatedAt })
          .from(issueDocuments).innerJoin(documents, and(eq(documents.id, issueDocuments.documentId), eq(documents.companyId, issueDocuments.companyId)))
          .innerJoin(issues, and(eq(issues.id, issueDocuments.issueId), eq(issues.companyId, issueDocuments.companyId)))
          .where(and(documentAccess, eq(issues.id, query.taskId!)))
          .orderBy(asc(issueDocuments.key), asc(documents.id)).offset(query.offset).limit(query.limit + 1);
      }
      return { kind: query.kind, taskId: query.taskId ?? null,
        records: rows.slice(0, query.limit).map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
        nextOffset: rows.length > query.limit ? query.offset + query.limit : null };
    },
  };
}
