import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentosPortfolioMandates, type Db } from "@paperclipai/db";
import { portfolioAttachmentQuerySchema } from "@paperclipai/shared";
import { agentosPortfolioMandateService } from "../services/agentos-portfolio-mandates.js";
import { PORTFOLIO_READ_PERMISSION, portfolioMandateGrantScope } from "../services/portfolio-mandate-grants.js";

const dependencies = vi.hoisted(() => ({ audit: vi.fn(), publish: vi.fn(), casesEnabled: true }));
vi.mock("../services/instance-settings.js", () => ({ instanceSettingsService: () => ({ getExperimental: async () => ({ enableCases: dependencies.casesEnabled }) }) }));
vi.mock("../services/authorization.js", async importOriginal => ({
  ...await importOriginal<object>(), authorizationService: () => ({
    decidePrincipalGrant: async () => ({ allowed: true }), decideReads: async () => [{ allowed: true }],
  }),
}));
vi.mock("../services/agentos-workforce.js", () => ({ agentosWorkforceService: () => ({}) }));
vi.mock("../services/activity-log.js", () => ({ persistActivity: dependencies.audit }));
vi.mock("../services/accounting-transaction.js", () => ({ publishAccountingActivities: dependencies.publish }));

function fixture(kind: "task" | "case" = "task") {
  const sourceCompanyId = randomUUID(), targetCompanyId = randomUUID(), sourceAgentId = randomUUID(), ownerUserId = "owner";
  const mandate = { id: randomUUID(), portfolioId: randomUUID(), sourceCompanyId, sourceAgentId, ownerUserId, revision: 1,
    grantId: randomUUID(), targetCompanyIds: [targetCompanyId], action: "portfolio_work:read", readScope: "owner_accessible_private",
    expiresAt: null, revokedAt: null, createdAt: new Date(), updatedAt: new Date() } as typeof agentosPortfolioMandates.$inferSelect;
  const body = Buffer.from("private evidence"), sha256 = createHash("sha256").update(body).digest("hex");
  const source = { attachmentId: randomUUID(), taskId: kind === "task" ? randomUUID() : null,
    ...(kind === "case" ? { caseId: randomUUID() } : {}), assetId: randomUUID(), provider: "local_disk" as const,
    objectKey: `${targetCompanyId}/issues/private/evidence.pdf`, contentType: "application/pdf", byteSize: body.length, sha256, filename: "Evidence.pdf" };
  const grant = { id: mandate.grantId, companyId: sourceCompanyId, principalType: "agent", principalId: sourceAgentId,
    permissionKey: PORTFOLIO_READ_PERMISSION, grantedByUserId: ownerUserId, scope: portfolioMandateGrantScope(mandate) };
  const query = portfolioAttachmentQuerySchema.parse({ mandateId: mandate.id, revision: mandate.revision, targetCompanyId,
    attachmentId: source.attachmentId, ...(source.caseId ? { caseId: source.caseId } : { taskId: source.taskId }), sha256 });
  let active = 0, transactions = 0;
  const rows = (name: string) => {
    switch (name) {
      case "agentos_portfolio_mandates": return [{ ...mandate }];
      case "agentos_portfolios": return [{ id: mandate.portfolioId, ownerUserId, homeCompanyId: sourceCompanyId }];
      case "agentos_portfolio_companies": return [{ companyId: sourceCompanyId }, { companyId: targetCompanyId }];
      case "user": return [{ id: ownerUserId, approvalStatus: "approved" }];
      case "company_operating_profiles": return [{ fridayAgentId: sourceAgentId }];
      case "instance_user_roles": return [];
      case "company_memberships": return [{ status: "active", membershipRole: "owner" }];
      case "principal_permission_grants": return [grant];
      case "agents": return [{ id: sourceAgentId, status: "idle", lifecycleState: "ready" }];
      case "issue_attachments": return [{ ...source }];
      case "case_attachments": return [{ ...source }];
      default: throw new Error(`Unexpected authority dependency: ${name}`);
    }
  };
  // Controlled persistence exercises the service's two transaction boundaries.
  // Real privacy SQL is checked separately; PostgreSQL lock races remain open.
  const db = { select: () => {
    let table = "";
    const builder: any = new Proxy({}, { get: (_target, key) => key === "then"
      ? (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(() => rows(table)).then(resolve, reject)
      : (...args: any[]) => { if (key === "from") table = getTableName(args[0]); return builder; } });
    return builder;
  }, transaction: async (callback: (tx: Db) => Promise<unknown>) => {
    active++; transactions++;
    try { return await callback(db as unknown as Db); } finally { active--; }
  } } as unknown as Db;
  const storage = { provider: "local_disk" as const, getObject: vi.fn(async () => {
    expect(active).toBe(0); return { stream: Readable.from([body]), contentLength: body.length };
  }) };
  const read = () => agentosPortfolioMandateService(db, { storage }).attachment(
    { type: "agent", source: "agent_key", companyId: sourceCompanyId, agentId: sourceAgentId, onBehalfOfUserId: ownerUserId },
    { actorType: "agent", actorId: sourceAgentId, agentId: sourceAgentId }, sourceCompanyId, query);
  return { source, mandate, storage, read, body, transactions: () => transactions };
}
beforeEach(() => {
  dependencies.casesEnabled = true;
  vi.clearAllMocks(); dependencies.audit.mockResolvedValue({ publication: { action: "agentos.portfolio_attachment_read" } });
});
describe("portfolio attachment authority across storage", () => {
  it("releases authority locks during storage, reauthorizes and audits without bytes or storage paths", async () => {
    const f = fixture(), result = await f.read();
    expect(f.transactions()).toBe(2); expect(result.fullFileVerified).toBe(true);
    expect(Buffer.from(result.body, "base64")).toEqual(f.body);
    expect(result).not.toHaveProperty("objectKey"); expect(result).not.toHaveProperty("assetId");
    expect(dependencies.audit).toHaveBeenCalledOnce();
    const audit = JSON.stringify(dependencies.audit.mock.calls[0][1]);
    expect(audit).not.toContain(f.body.toString()); expect(audit).not.toContain(f.source.objectKey);
    expect(audit).not.toContain(f.source.filename); expect(dependencies.publish).toHaveBeenCalledOnce();
  });
  it("rejects already revoked authority before contacting storage", async () => {
    const f = fixture(); f.mandate.revokedAt = new Date();
    await expect(f.read()).rejects.toMatchObject({ status: 403 });
    expect(f.storage.getObject).not.toHaveBeenCalled(); expect(dependencies.audit).not.toHaveBeenCalled();
  });
  it("discards bytes when the mandate is revoked during storage", async () => {
    const f = fixture(); f.storage.getObject.mockImplementation(async () => {
      f.mandate.revokedAt = new Date(); return { stream: Readable.from([f.body]), contentLength: f.body.length };
    });
    await expect(f.read()).rejects.toMatchObject({ status: 403 });
    expect(f.transactions()).toBe(2); expect(dependencies.audit).not.toHaveBeenCalled();
  });
  it("rejects a relinked storage identity even when the stored hash has not changed", async () => {
    const f = fixture(); f.storage.getObject.mockImplementation(async () => {
      f.source.objectKey = "different-private-object"; return { stream: Readable.from([f.body]), contentLength: f.body.length };
    });
    await expect(f.read()).rejects.toMatchObject({ status: 409 }); expect(dependencies.audit).not.toHaveBeenCalled();
  });
  it("returns and audits the case owner after both authority transactions", async () => {
    const f = fixture("case"), result = await f.read();
    expect(f.transactions()).toBe(2);
    expect(result).toMatchObject({ taskId: null, caseId: f.source.caseId, fullFileVerified: true });
    expect(dependencies.audit.mock.calls[0][1].details).toMatchObject({ taskId: null, caseId: f.source.caseId });
    expect(result).not.toHaveProperty("objectKey");
  });
  it("discards case bytes if Cases is disabled during storage", async () => {
    const f = fixture("case");
    f.storage.getObject.mockImplementation(async () => {
      dependencies.casesEnabled = false;
      return { stream: Readable.from([f.body]), contentLength: f.body.length };
    });
    await expect(f.read()).rejects.toMatchObject({ status: 403 });
    expect(f.transactions()).toBe(2); expect(dependencies.audit).not.toHaveBeenCalled();
  });
  it("discards bytes if the case owner changes during storage", async () => {
    const f = fixture("case");
    f.storage.getObject.mockImplementation(async () => {
      f.source.caseId = randomUUID();
      return { stream: Readable.from([f.body]), contentLength: f.body.length };
    });
    await expect(f.read()).rejects.toMatchObject({ status: 409 });
    expect(dependencies.audit).not.toHaveBeenCalled();
  });
});
