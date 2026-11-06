import { expect, it } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { documentService } from "../services/documents.js";

it("reads one exact bounded company/task/document revision without substituting latest content", async () => {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const db = drizzle(async (text, params) => { calls.push({ text, params }); return { rows: [] }; });
  const input = { companyId: "company", issueId: "task", documentId: "document", revisionId: "revision", maxBodyBytes: 65_536 };
  expect(await documentService(db as never).getIssueDocumentRevision(input)).toBeNull();
  expect(calls).toHaveLength(1);
  expect(calls[0].params).toEqual(["company", "task", "document", "revision", 65_536, 1]);
  expect(calls[0].text).toContain('"document_revisions"."body"');
  expect(calls[0].text).toContain('octet_length("document_revisions"."body")');
  expect(calls[0].text).not.toContain('"latest_body"');
  expect(calls[0].text).toContain('"document_revisions"."company_id" = "documents"."company_id"');
});

it("rejects invalid bounds before reading any document body", async () => {
  const db = drizzle(async () => { throw new Error("unexpected read"); });
  await expect(documentService(db as never).getIssueDocumentRevision({ companyId: "c", issueId: "i", documentId: "d", revisionId: "r", maxBodyBytes: 0 })).rejects.toMatchObject({ status: 422 });
});
