import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { assets, caseAttachments, cases, issues, projects, runnerApiResponseReservations, type Db } from "@paperclipai/db";
import type { PortfolioAttachmentQuery, PortfolioRecordsQuery } from "@paperclipai/shared";
import { notFound } from "../errors.js";
import { assertCasesEnabled, caseRetainedSourceReadCondition } from "./case-access.js";

/** Internal to the private portfolio gateway after its native company-read,
 * current Friday, owner and authorizer checks. Reuses the case owner's retained
 * source invariant with the gateway's stricter task/project privacy predicates. */
export function portfolioCaseFiles(db: Db, companyId: string, rights: { issue: SQL; project: SQL }) {
  const caseAccess = and(
    caseRetainedSourceReadCondition(eq(cases.companyId, companyId), rights.issue, rights.project),
    or(isNull(cases.workIssueId), inArray(cases.workIssueId, db.select({ id: issues.id }).from(issues).where(rights.issue))),
    or(isNull(cases.projectId), inArray(cases.projectId, db.select({ id: projects.id }).from(projects).where(rights.project))),
  );
  const originalCase = sql<string>`case when split_part(${assets.objectKey}, '/', 2) = 'assets'
    then split_part(${assets.objectKey}, '/', 4) else split_part(${assets.objectKey}, '/', 3) end`;
  const attachmentAccess = and(caseAccess, eq(caseAttachments.companyId, companyId), eq(assets.companyId, companyId),
    sql`split_part(${assets.objectKey}, '/', 1) = ${companyId}`,
    sql`(split_part(${assets.objectKey}, '/', 2) = 'cases'
      or (split_part(${assets.objectKey}, '/', 2) = 'assets' and split_part(${assets.objectKey}, '/', 3) = 'cases'))`,
    // File ownership is the upload case, never a task or another case that later
    // links the same asset. Keep its full retained-source privacy after handoff.
    sql`${originalCase} = ${cases.id}::text`,
    sql`not exists (${db.select({ id: runnerApiResponseReservations.id }).from(runnerApiResponseReservations)
      .where(eq(runnerApiResponseReservations.assetId, assets.id))})`,
  );
  return {
    async attachment(query: PortfolioAttachmentQuery) {
      await assertCasesEnabled(db);
      const [row] = await db.select({ attachmentId: caseAttachments.id, taskId: sql<null>`null`, caseId: cases.id, assetId: assets.id,
        provider: assets.provider, objectKey: assets.objectKey, contentType: assets.contentType,
        byteSize: assets.byteSize, sha256: assets.sha256, filename: assets.originalFilename,
      }).from(caseAttachments).innerJoin(assets, and(eq(assets.id, caseAttachments.assetId), eq(assets.companyId, caseAttachments.companyId)))
        .innerJoin(cases, and(eq(cases.id, caseAttachments.caseId), eq(cases.companyId, caseAttachments.companyId)))
        .where(and(attachmentAccess, eq(cases.id, query.caseId!), eq(caseAttachments.id, query.attachmentId), eq(assets.sha256, query.sha256))).limit(1);
      if (!row) throw notFound("Attachment is unavailable or changed; rediscover the authorized record");
      return row;
    },
    async records(query: PortfolioRecordsQuery) {
      await assertCasesEnabled(db);
      if (query.kind === "cases") {
        const rows = await db.select({ id: cases.id, title: sql<string>`left(${cases.title}, 1000)`, updatedAt: cases.updatedAt })
          .from(cases).where(caseAccess).orderBy(desc(cases.updatedAt), desc(cases.id)).offset(query.offset).limit(query.limit + 1);
        return { kind: query.kind, taskId: null, records: rows.slice(0, query.limit).map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
          nextOffset: rows.length > query.limit ? query.offset + query.limit : null };
      }
      const rows = await db.select({ id: caseAttachments.id, title: sql<string | null>`left(${assets.originalFilename}, 1000)`,
        updatedAt: assets.updatedAt, contentType: assets.contentType, byteSize: assets.byteSize, sha256: assets.sha256,
      }).from(caseAttachments).innerJoin(assets, and(eq(assets.id, caseAttachments.assetId), eq(assets.companyId, caseAttachments.companyId)))
        .innerJoin(cases, and(eq(cases.id, caseAttachments.caseId), eq(cases.companyId, caseAttachments.companyId)))
        .where(and(attachmentAccess, eq(cases.id, query.caseId!))).orderBy(asc(caseAttachments.createdAt), asc(caseAttachments.id))
        .offset(query.offset).limit(query.limit + 1);
      return { kind: query.kind, taskId: null, caseId: query.caseId!, records: rows.slice(0, query.limit).map(({ contentType, byteSize, sha256, ...row }) => ({
        ...row, updatedAt: row.updatedAt.toISOString(), attachment: { contentType, byteSize, sha256 },
      })), nextOffset: rows.length > query.limit ? query.offset + query.limit : null };
    },
  };
}
