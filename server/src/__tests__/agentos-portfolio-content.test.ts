import { afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Db } from "@paperclipai/db";
import { portfolioContentQuerySchema, portfolioRecordsQuerySchema, portfolioAttachmentQuerySchema } from "@paperclipai/shared";
import { assertPortfolioContentScope } from "../services/agentos-portfolio-mandates.js";
import { portfolioPrivateContentProjection } from "../services/agentos-portfolio-content.js";
import type { AuthorizationActor } from "../services/authorization.js";

const id = (n: number) => `${n.toString().padStart(8, "0")}-0000-4000-8000-000000000000`;
const identity = { mandateId: id(1), revision: 2, targetCompanyId: id(3) };
const actor: AuthorizationActor = { type: "agent", source: "agent_jwt", companyId: id(4), agentId: id(5), onBehalfOfUserId: "owner", authorizingUserId: "external" };
const hash = "a".repeat(64);
const time = "2026-11-07T00:00:00.000Z";
function database(rows: unknown[][] = []) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const db = drizzle(async (text, params) => { calls.push({ text, params }); return { rows }; }) as unknown as Db;
  return { projection: portfolioPrivateContentProjection(db, actor, identity.targetCompanyId), calls };
}
afterEach(() => vi.unstubAllEnvs());

describe("portfolio private content contracts", () => {
  it("does not widen a shared-only grant", () => {
    expect(() => assertPortfolioContentScope({ readScope: "company_shared_only" })).toThrow("explicit owner-accessible private mandate");
    expect(() => assertPortfolioContentScope({ readScope: "owner_accessible_private" })).not.toThrow();
    expect(() => assertPortfolioContentScope({ readScope: "unknown" })).toThrow();
  });
  it("requires version binding for later content pages and bounds every read", () => {
    const base = { ...identity, kind: "document", resourceId: id(6) };
    expect(portfolioContentQuerySchema.parse(base)).toMatchObject({ offset: 0, limit: 12000 });
    for (const patch of [{ offset: 1 }, { limit: 20001 }, { offset: -1 }, { bodySha256: "guess" }, { kind: "run" }, { secretId: id(6) }]) {
      expect(portfolioContentQuerySchema.safeParse({ ...base, ...patch }).success).toBe(false);
    }
    expect(portfolioContentQuerySchema.safeParse({ ...base, offset: 4, bodySha256: hash }).success).toBe(true);
    expect(portfolioRecordsQuerySchema.safeParse({ ...identity, kind: "comments" }).success).toBe(false);
    expect(portfolioRecordsQuerySchema.safeParse({ ...identity, kind: "documents", taskId: id(6), limit: 51 }).success).toBe(false);
    expect(portfolioRecordsQuerySchema.safeParse({ ...identity, kind: "conversations", taskId: id(6) }).success).toBe(false);
    expect(portfolioRecordsQuerySchema.safeParse({ ...identity, kind: "executives", projectId: id(6) }).success).toBe(true);
    expect(portfolioRecordsQuerySchema.safeParse({ ...identity, kind: "executives", taskId: id(6) }).success).toBe(false);
    expect(portfolioRecordsQuerySchema.safeParse({ ...identity, kind: "comments", taskId: id(6), projectId: id(7) }).success).toBe(false);
  });
  it("discovers only bounded executive identity facts with project rights before pagination", async () => {
    const { projection, calls } = database([
      [id(6), "Company CEO", time, "ceo", "idle", "ready"],
      [id(7), "Department head", time, "department_head", "paused", "paused"],
    ]);
    const result = await projection.records(portfolioRecordsQuerySchema.parse({ ...identity, kind: "executives", projectId: id(8), limit: 1 }));
    expect(result).toEqual({ kind: "executives", taskId: null, projectId: id(8), records: [
      { id: id(6), title: "Company CEO", updatedAt: time, executive: { kind: "ceo", status: "idle", lifecycleState: "ready" } },
    ], nextOffset: 1 });
    expect(calls).toHaveLength(1);
    const query = calls[0]!;
    expect(query.text).toContain('"agentos_departments"."lead_agent_id"');
    expect(query.text).toContain('"agentos_department_projects"."project_id"');
    expect(query.text).toContain('friday_profile.friday_agent_id = "agents"."id"');
    expect(query.text).toContain('"project_access_members"');
    expect(query.text).not.toMatch(/adapter_config|runtime_config|instructions|api_key/);
    expect(query.params).toEqual(expect.arrayContaining([identity.targetCompanyId, id(8), "owner", "external", 2]));
  });
  it.each(["project", "task", "comment", "document"] as const)("applies current resource rights in the same %s body statement even with privacy rollout off", async kind => {
    vi.stubEnv("PAPERCLIP_ISSUE_PRIVACY_MODE", "off");
    const { projection, calls } = database([[id(6), "Title", time, "😀x", hash, 8, ...(kind === "comment" ? [id(9), null, time] : [])]]);
    const result = await projection.content(portfolioContentQuerySchema.parse({ ...identity, kind, resourceId: id(6), offset: 2, limit: 2, bodySha256: hash }));
    expect(result).toMatchObject({ body: "😀x", offset: 2, nextOffset: 4, bodyCharacters: 8, bodySha256: hash });
    if (kind === "comment") expect(result.comment).toEqual({ authorAgentId: id(9), authorUserId: null, createdAt: time });
    else expect(result).not.toHaveProperty("comment");
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.params).toEqual(expect.arrayContaining(["owner", "external", id(3), id(6), hash]));
    expect(call.params).not.toContain(actor.agentId);
    expect(call.text).toContain("instance_user_roles");
    expect(call.text).toContain("substring(coalesce(");
    expect(call.text).toContain("sha256(convert_to(");
    expect(call.text).toContain('"company_memberships"');
    expect(call.text).not.toMatch(/adapter_config|heartbeat_run|presentation|metadata|source_trust|execution_policy/);
    if (kind !== "project") {
      expect(call.text).toContain("privacy_ancestors");
      expect(call.text).toContain('"issues"."conversation_user_id"');
      expect(call.text).toContain('"issues"."hidden_at" is null');
      expect(call.text).toContain('"issues"."harness_kind" is null');
    }
    if (kind === "comment") expect(call.text).toContain('"issue_comments"."deleted_at" is null');
    if (kind === "document") {
      expect(call.text).toContain('"documents"."company_id" = "issue_documents"."company_id"');
      expect(call.params).toEqual(expect.arrayContaining(["continuation-summary", "pipeline-case-body"]));
    }
  });
  it("does not distinguish inaccessible, removed or changed content", async () => {
    const { projection } = database();
    await expect(projection.content(portfolioContentQuerySchema.parse({ ...identity, kind: "document", resourceId: id(6) })))
      .rejects.toMatchObject({ status: 404 });
  });
  it("requires exact attachment/task/version identities and rejects storage selectors", () => {
    const query = { ...identity, attachmentId: id(6), taskId: id(7), sha256: hash };
    expect(portfolioAttachmentQuerySchema.parse(query)).toMatchObject({ offset: 0, limit: 16384 });
    for (const patch of [{ sha256: undefined }, { taskId: undefined }, { limit: 65537 }, { offset: -1 }, { objectKey: "private/path" }, { assetId: id(8) }])
      expect(portfolioAttachmentQuerySchema.safeParse({ ...query, ...patch }).success).toBe(false);
    expect(portfolioRecordsQuerySchema.safeParse({ ...identity, kind: "attachments" }).success).toBe(false);
  });
  it("discovers attachment versions without storage keys, API captures, case files or deleted-comment content", async () => {
    const { projection, calls } = database([[id(6), "Report.pdf", time, "application/pdf", 900, hash]]);
    const result = await projection.records(portfolioRecordsQuerySchema.parse({ ...identity, kind: "attachments", taskId: id(7) }));
    expect(result.records).toEqual([{ id: id(6), title: "Report.pdf", updatedAt: time, attachment: { contentType: "application/pdf", byteSize: 900, sha256: hash } }]);
    const query = calls[0]!;
    expect(query.text.split(" from ")[0]).not.toContain("object_key");
    for (const text of ["privacy_ancestors", "runner_api_response_reservations", "case_attachments", "split_part", '"issue_comments"."deleted_at" is null'])
      expect(query.text).toContain(text);
    expect(query.params).toEqual(expect.arrayContaining(["owner", "external", identity.targetCompanyId, id(7)]));
    expect(query.text).not.toMatch(/run_log|stdout_excerpt|adapter_config/);
  });
  it("binds a file read to the exact authorized task, attachment and stored hash", async () => {
    const { projection, calls } = database();
    await expect(projection.attachment(portfolioAttachmentQuerySchema.parse({ ...identity, taskId: id(7), attachmentId: id(6), sha256: hash })))
      .rejects.toMatchObject({ status: 404 });
    expect(calls[0].params).toEqual(expect.arrayContaining([id(6), id(7), hash, "owner", "external"]));
    expect(calls[0].text).toContain('"assets"."company_id" = "issue_attachments"."company_id"');
    expect(calls[0].text).toContain('"project_access_members"');
  });
  it.each(["conversations", "comments", "documents"] as const)("paginates %s references after resource predicates without projecting bodies or hidden totals", async kind => {
    const { projection, calls } = database([[id(6), "One", time], [id(7), "Two", time]]);
    const result = await projection.records(portfolioRecordsQuerySchema.parse({ ...identity, kind, limit: 1, ...(kind === "conversations" ? {} : { taskId: id(8) }) }));
    expect(result.records).toEqual([{ id: id(6), title: "One", updatedAt: time }]);
    expect(result.nextOffset).toBe(1);
    expect(result).not.toHaveProperty("total");
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.text).toContain("privacy_ancestors");
    expect(call.params).toEqual(expect.arrayContaining(["owner", "external", id(3)]));
    expect(call.text).not.toMatch(/latest_body|"body"|count\(\*\)|metadata|presentation/);
    if (kind === "conversations") expect(call.text).toContain('"issues"."conversation_agent_id" is not null');
  });
});
