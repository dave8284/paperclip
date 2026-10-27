import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, companies, projects, activityLog, companyMemberships } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "@paperclipai/db/test-embedded-postgres";
import { createPerformanceReportSchema } from "@paperclipai/shared";
import { companyPerformanceService } from "../services/company-performance.js";
let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
const companyId = randomUUID(), otherId = randomUUID(), projectId = randomUUID();
const actor = { type: "board" as const, userId: "local-board", source: "local_implicit" as const, isInstanceAdmin: true };
const who = { actorType: "user" as const, actorId: "local-board", agentId: null, runId: null };
const input = createPerformanceReportSchema.parse({ period: "2026-10", currency: "USD", basis: "cash", values: { revenueMinor: 10000, costMinor: 3000, views: 200 }, revenueComplete: true, costsComplete: false, sourceLabel: "Source export", evidenceRef: "Artefact: recorded October source export", expectedReportId: null });
beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("company-performance-"); db = createDb(database.connectionString); await db.insert(companies).values([{ id: companyId, name: "Company", issuePrefix: "CPR" }, { id: otherId, name: "Other", issuePrefix: "CPO" }]); await db.insert(projects).values({ id: projectId, companyId, name: "Private", visibility: "private", privacyOwnerUserId: "owner" }); }, 90000);
afterAll(async () => database?.cleanup());
describe("company performance ledger", () => {
  it("records immutable audited revisions and rejects stale updates", async () => {
    const service = companyPerformanceService(db);
    const first = await service.record(companyId, input, actor, who);
    const second = await service.record(companyId, { ...input, costsComplete: true, expectedReportId: first.id }, actor, who);
    expect(second.revision).toBe(2);
    await expect(service.record(companyId, { ...input, expectedReportId: first.id }, actor, who)).rejects.toThrow("changed");
    const history = await service.list(companyId, "2026-10", actor);
    expect(history.reports).toHaveLength(2); expect(history.reports.find(row => row.id === first.id)?.costsComplete).toBe(false);
    expect((await db.select().from(activityLog).where(eq(activityLog.companyId, companyId))).filter(row => row.action === "company.performance_recorded")).toHaveLength(2);
    expect((await service.list(otherId, "2026-10", actor)).reports).toEqual([]);
  });
  it("rejects cross-company reports and filters private project reports before returning history", async () => {
    const service = companyPerformanceService(db);
    await expect(service.record(otherId, { ...input, projectId }, actor, who)).rejects.toThrow("Project not found");
    await service.record(companyId, { ...input, projectId }, actor, who);
    await db.insert(companyMemberships).values({ companyId, principalId: "viewer", principalType: "user", membershipRole: "member", status: "active" });
    const viewer = { type: "board" as const, source: "session" as const, userId: "viewer", companyIds: [companyId] };
    expect((await service.list(companyId, "2026-10", viewer)).reports.every(row => !row.projectId)).toBe(true);
    await expect(service.record(companyId, { ...input, projectId }, viewer, { ...who, actorId: "viewer" })).rejects.toThrow();
  });
});
