import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Db } from "@paperclipai/db";
import { portfolioAttachmentQuerySchema, portfolioRecordsQuerySchema } from "@paperclipai/shared";
import { portfolioPrivateContentProjection } from "../services/agentos-portfolio-content.js";

const settings = vi.hoisted(() => ({ enabled: true }));
vi.mock("../services/instance-settings.js", () => ({ instanceSettingsService: () => ({ getExperimental: async () => ({ enableCases: settings.enabled }) }) }));
const id = (n: number) => `${n.toString().padStart(8, "0")}-0000-4000-8000-000000000000`;
const identity = { mandateId: id(1), revision: 2, targetCompanyId: id(3) };
const hash = "a".repeat(64), time = "2026-11-08T00:00:00.000Z";
function fixture(rows: unknown[][] = []) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const db = drizzle(async (text, params) => { calls.push({ text, params }); return { rows }; }) as unknown as Db;
  return { calls, projection: portfolioPrivateContentProjection(db, {
    type: "agent", source: "agent_jwt", companyId: id(4), agentId: id(5), onBehalfOfUserId: "owner", authorizingUserId: "external",
  }, identity.targetCompanyId) };
}
beforeEach(() => { settings.enabled = true; });

describe("portfolio case file access", () => {
  it("requires exactly one native file owner and keeps discovery selectors separate", () => {
    const query = { ...identity, attachmentId: id(6), sha256: hash };
    expect(portfolioAttachmentQuerySchema.safeParse({ ...query, caseId: id(7) }).success).toBe(true);
    expect(portfolioAttachmentQuerySchema.safeParse({ ...query, taskId: id(7) }).success).toBe(true);
    expect(portfolioAttachmentQuerySchema.safeParse(query).success).toBe(false);
    expect(portfolioAttachmentQuerySchema.safeParse({ ...query, taskId: id(7), caseId: id(8) }).success).toBe(false);
    for (const patch of [{ kind: "cases", caseId: id(7) }, { kind: "cases", taskId: id(7) }, { kind: "case_attachments" },
      { kind: "case_attachments", caseId: id(7), taskId: id(8) }, { kind: "attachments", taskId: id(7), caseId: id(8) },
      { kind: "executives", caseId: id(7) }, { kind: "cases", projectId: id(7) }]) {
      expect(portfolioRecordsQuerySchema.safeParse({ ...identity, ...patch }).success).toBe(false);
    }
  });
  it("paginates case identity after retained-source and current task/project rights", async () => {
    const f = fixture([[id(6), "Case one", time], [id(7), "Case two", time]]);
    const result = await f.projection.records(portfolioRecordsQuerySchema.parse({ ...identity, kind: "cases", limit: 1 }));
    expect(result).toEqual({ kind: "cases", taskId: null, records: [{ id: id(6), title: "Case one", updatedAt: time }], nextOffset: 1 });
    expect(f.calls).toHaveLength(1);
    const { text, params } = f.calls[0];
    for (const boundary of ["case_access_sources", 'retained.company_id <> "cases"."company_id"', "retained.source_kind = 'issue'",
      "retained.source_kind = 'project'", "privacy_ancestors", "project_access_members", '"cases"."work_issue_id"', '"issues"."hidden_at" is null',
      '"issues"."conversation_user_id"', '"cases"."project_id"']) expect(text).toContain(boundary);
    expect(params).toEqual(expect.arrayContaining([identity.targetCompanyId, "owner", "external", 2]));
    expect(text.split(" from ")[0]).not.toMatch(/fields|summary|body|object_key|work_issue_id/);
  });
  it("discovers case-owned versions without projecting storage paths or bodies", async () => {
    const f = fixture([[id(6), "Case report.pdf", time, "application/pdf", 25, hash]]);
    const result = await f.projection.records(portfolioRecordsQuerySchema.parse({ ...identity, kind: "case_attachments", caseId: id(7) }));
    expect(result).toMatchObject({ taskId: null, caseId: id(7), records: [{ id: id(6), title: "Case report.pdf",
      attachment: { contentType: "application/pdf", byteSize: 25, sha256: hash } }] });
    expect(f.calls[0].text.split(" from ")[0]).not.toContain("object_key");
    for (const boundary of ["case_access_sources", "runner_api_response_reservations", "split_part", '= "cases"."id"::text',
      '"assets"."company_id" = "case_attachments"."company_id"']) expect(f.calls[0].text).toContain(boundary);
    expect(f.calls[0].params).toEqual(expect.arrayContaining([id(7), "owner", "external", identity.targetCompanyId]));
  });
  it("binds case, attachment, target company and version before selecting storage identity", async () => {
    const f = fixture([[id(6), null, id(7), id(8), "local_disk", `${id(3)}/assets/cases/${id(7)}/file`, "application/pdf", 25, hash, "Case report.pdf"]]);
    const result = await f.projection.attachment(portfolioAttachmentQuerySchema.parse({ ...identity, caseId: id(7), attachmentId: id(6), sha256: hash }));
    expect(result).toMatchObject({ taskId: null, caseId: id(7), attachmentId: id(6), sha256: hash });
    expect(f.calls[0].params).toEqual(expect.arrayContaining([id(7), id(6), identity.targetCompanyId, hash, "owner", "external"]));
    expect(f.calls[0].text).toContain("case_access_sources");
  });
  it.each(["cases", "case_attachments"] as const)("denies %s without querying case data when Cases is disabled", async kind => {
    settings.enabled = false;
    const f = fixture();
    await expect(f.projection.records(portfolioRecordsQuerySchema.parse({ ...identity, kind, ...(kind === "case_attachments" ? { caseId: id(7) } : {}) })))
      .rejects.toMatchObject({ status: 403 });
    expect(f.calls).toHaveLength(0);
  });
  it("denies case file bytes when Cases is disabled and hides missing versus unreadable files", async () => {
    const f = fixture(), query = portfolioAttachmentQuerySchema.parse({ ...identity, caseId: id(7), attachmentId: id(6), sha256: hash });
    settings.enabled = false;
    await expect(f.projection.attachment(query)).rejects.toMatchObject({ status: 403 });
    expect(f.calls).toHaveLength(0);
    settings.enabled = true;
    await expect(f.projection.attachment(query)).rejects.toMatchObject({ status: 404 });
  });
});
