import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { expect, it } from "vitest";
import { issues } from "@paperclipai/db";
import { issueRoutes } from "../routes/issues.js";
import { issueService } from "../services/issues.js";
import type { ImportIssueRow } from "../services/import-write-types.js";
import {
  describeEmbeddedPostgres,
  resetCompanyIssueFixtures,
  routeApp,
  seedCompanyWithBoardAccess,
  useEmbeddedPostgres,
} from "./helpers/route-test-harness.js";

describeEmbeddedPostgres("issue list parentIssueId query alias", () => {
  const ctx = useEmbeddedPostgres("paperclip-issues-parent-id-alias-", {
    resetEach: resetCompanyIssueFixtures,
  });

  async function seed() {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Parent alias");
    const companyId = company.companyId;
    const parentId = randomUUID();
    const otherParentId = randomUUID();
    const childId = randomUUID();
    const blockedChildId = randomUUID();

    await ctx.db.insert(issues).values([
      { id: parentId, companyId, title: "Parent", status: "todo", priority: "medium" },
      { id: otherParentId, companyId, title: "Other parent", status: "todo", priority: "medium" },
    ]);
    await ctx.db.insert(issues).values([
      { id: childId, companyId, title: "Child", status: "todo", priority: "medium", parentId },
      { id: blockedChildId, companyId, title: "Blocked child", status: "blocked", priority: "medium", parentId },
      {
        id: randomUUID(),
        companyId,
        title: "Other child",
        status: "todo",
        priority: "medium",
        parentId: otherParentId,
      },
      {
        id: randomUUID(),
        companyId,
        title: "Blocked other child",
        status: "blocked",
        priority: "medium",
        parentId: otherParentId,
      },
    ]);

    return { ...company, parentId, otherParentId, childId, blockedChildId };
  }

  type Seeded = Awaited<ReturnType<typeof seed>>;

  function appFor(seeded: Seeded) {
    return routeApp(ctx.db, seeded.actor, issueRoutes);
  }

  async function listIds(seeded: Seeded, query: Record<string, string>) {
    const res = await request(appFor(seeded))
      .get(`/api/companies/${seeded.companyId}/issues`)
      .query(query)
      .expect(200);
    return (res.body as { id: string }[]).map((issue) => issue.id).sort();
  }

  async function blockedCount(seeded: Seeded, query: Record<string, string>) {
    const res = await request(appFor(seeded))
      .get(`/api/companies/${seeded.companyId}/issues/count`)
      .query({ attention: "blocked", ...query })
      .expect(200);
    return res.body as { count: number };
  }

  function childrenOfParent(seeded: Seeded) {
    return [seeded.childId, seeded.blockedChildId].sort();
  }

  it("filters children by ?parentId=", async () => {
    const seeded = await seed();
    expect(await listIds(seeded, { parentId: seeded.parentId })).toEqual(childrenOfParent(seeded));
  });

  it("filters children by ?parentIssueId=", async () => {
    const seeded = await seed();
    expect(await listIds(seeded, { parentIssueId: seeded.parentId })).toEqual(childrenOfParent(seeded));
  });

  it("prefers ?parentId= when both spellings are present", async () => {
    const seeded = await seed();
    const ids = await listIds(seeded, {
      parentId: seeded.parentId,
      parentIssueId: seeded.otherParentId,
    });
    expect(ids).toEqual(childrenOfParent(seeded));
  });

  it("returns the whole company list when neither spelling is present", async () => {
    const seeded = await seed();
    expect(await listIds(seeded, {})).toHaveLength(6);
  });

  it("filters the blocked count by ?parentIssueId=", async () => {
    const seeded = await seed();
    expect(await blockedCount(seeded, { parentIssueId: seeded.parentId })).toEqual({ count: 1 });
  });

  it("returns the same blocked count for both spellings", async () => {
    const seeded = await seed();
    const byShortForm = await blockedCount(seeded, { parentId: seeded.parentId });
    const byAlias = await blockedCount(seeded, { parentIssueId: seeded.parentId });
    expect(byAlias).toEqual(byShortForm);
  });
});

describeEmbeddedPostgres("company-owned task parents", () => {
  const ctx = useEmbeddedPostgres("paperclip-issue-parent-company-", { resetEach: resetCompanyIssueFixtures });

  async function seedParents() {
    const local = await seedCompanyWithBoardAccess(ctx.db, "Local company");
    const foreign = await seedCompanyWithBoardAccess(ctx.db, "Other company");
    const [localParent, foreignParent] = await ctx.db.insert(issues).values([
      { companyId: local.companyId, title: "Local parent", status: "backlog" },
      { companyId: foreign.companyId, title: "Other company's parent", status: "backlog" },
    ]).returning();
    return { ...local, localParent: localParent!, foreignParent: foreignParent! };
  }

  function importRow(id: string, parentId: string | null): ImportIssueRow {
    return { id, ref: id, parentId, title: "Imported task", description: null, projectId: null,
      projectWorkspaceId: null, assigneeAgentId: null, status: "backlog", priority: "medium",
      billingCode: null, assigneeAdapterOverrides: null, executionWorkspaceSettings: null,
      labelIds: [], monitorNotes: null, monitorScheduledBy: null };
  }

  it("rejects another company's parent with inheritance disabled and leaves both trees unchanged", async () => {
    const { companyId, foreignParent } = await seedParents();
    const service = issueService(ctx.db);
    for (const parentId of [foreignParent.id, randomUUID()]) {
      await expect(service.create(companyId, { title: "Invalid child", parentId,
        skipExecutionWorkspaceInheritance: true })).rejects.toMatchObject({ status: 404 });
    }
    expect(await ctx.db.select().from(issues)).toHaveLength(2);
  });

  it("rejects a foreign parent update, accepts a local parent and permits detaching", async () => {
    const { companyId, localParent, foreignParent } = await seedParents();
    const service = issueService(ctx.db);
    const task = await service.create(companyId, { title: "Local child", parentId: localParent.id });
    await expect(service.update(task.id, { parentId: foreignParent.id, companyGuard: companyId }))
      .rejects.toMatchObject({ status: 404 });
    const [unchanged] = await ctx.db.select().from(issues).where(eq(issues.id, task.id));
    expect(unchanged?.parentId).toBe(localParent.id);
    expect((await service.update(task.id, { parentId: null, companyGuard: companyId }))?.parentId).toBeNull();
    expect((await service.update(task.id, { parentId: localParent.id, companyGuard: companyId }))?.parentId).toBe(localParent.id);
  });

  it("rejects a foreign parent during atomic batch import", async () => {
    const { companyId, foreignParent } = await seedParents();
    const validId = randomUUID();
    await expect(issueService(ctx.db).importIssues(companyId, [
      importRow(validId, null), importRow(randomUUID(), foreignParent.id),
    ])).rejects.toMatchObject({ status: 404 });
    expect(await ctx.db.select().from(issues).where(eq(issues.id, validId))).toEqual([]);
    expect(await ctx.db.select().from(issues)).toHaveLength(2);
  });

  it("retains parents created in the same company import batch", async () => {
    const { companyId, localParent } = await seedParents();
    const parentId = randomUUID();
    const childId = randomUUID();
    await issueService(ctx.db).importIssues(companyId, [
      importRow(parentId, localParent.id), importRow(childId, parentId),
    ]);
    const [child] = await ctx.db.select().from(issues).where(eq(issues.id, childId));
    expect(child).toMatchObject({ companyId, parentId });
    const [parent] = await ctx.db.select().from(issues).where(eq(issues.id, parentId));
    expect(parent).toMatchObject({ companyId, parentId: localParent.id });
  });
});
