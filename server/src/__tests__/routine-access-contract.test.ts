import type { Request, Response, NextFunction } from "express";
import { beforeEach, expect, it, vi } from "vitest";
import { routineRoutes } from "../routes/routines.js";
import { routineAccessService } from "../services/routine-access.js";
import { drizzle } from "drizzle-orm/pg-proxy";

const native = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), getDetail: vi.fn(), getTrigger: vi.fn(), update: vi.fn(), create: vi.fn(), listRuns: vi.fn(), listRevisions: vi.fn(), getRevision: vi.fn(), restoreRevision: vi.fn(), updateTrigger: vi.fn(), decideReads: vi.fn() }));
const annotations = vi.hoisted(() => ({ listThreadsForRoutineDocument: vi.fn(), getThreadForRoutineDocument: vi.fn(), createRoutineThread: vi.fn(), addRoutineComment: vi.fn(), updateRoutineThread: vi.fn() }));
vi.mock("../services/index.js", () => ({ routineService: () => native, accessService: () => ({ canUser: async () => true }), documentAnnotationService: () => annotations, logActivity: vi.fn() }));
vi.mock("../services/authorization.js", async original => ({ ...await original<typeof import("../services/authorization.js")>(), authorizationService: () => ({ decideReads: native.decideReads }) }));
const companyId = "11111111-1111-4111-8111-111111111111", routineId = "22222222-2222-4222-8222-222222222222", projectId = "33333333-3333-4333-8333-333333333333", hiddenIssueId = "44444444-4444-4444-8444-444444444444", revisionId = "55555555-5555-4555-8555-555555555555";
const routine = { id: routineId, companyId, projectId, parentIssueId: null, assigneeAgentId: null, title: "Feedback", activeIssue: null, lastRun: null, triggers: [] };
const actor = { type: "board", userId: "owner", source: "session", companyIds: [companyId], isInstanceAdmin: true } as const;
async function call(path: string, method = "get", body = {}, params = {}, db: unknown = {}) {
  const route = routineRoutes(db as never).stack.find(layer => layer.route?.path === path && layer.route.methods[method])!.route;
  const req = { method: method.toUpperCase(), actor, params: { companyId, id: routineId, revisionId, ...params }, query: {}, body } as unknown as Request;
  const res = { json: vi.fn(), status: vi.fn(), statusCode: 200 };
  res.status.mockImplementation(code => { res.statusCode = code; return res; });
  for (const layer of route.stack) {
    let advance = false;
    await (layer.handle as (req: Request, res: Response, next: NextFunction) => Promise<void>)(req, res as unknown as Response, () => { advance = true; });
    if (!advance) break;
  }
  return res;
}
beforeEach(() => {
  vi.clearAllMocks();
  native.get.mockResolvedValue(routine); native.list.mockResolvedValue([routine]);
  native.getTrigger.mockResolvedValue({ id: "trigger", companyId, routineId });
  native.decideReads.mockImplementation(async (_actor, resources) => resources.map(() => ({ allowed: true })));
});
it("deduplicates scope references and filters private routine list rows", async () => {
  native.list.mockResolvedValue([routine, { ...routine, id: "second" }, { ...routine, id: "open", projectId: null }]);
  native.decideReads.mockImplementation(async (_actor, resources) => resources.map((resource: { type: string }) => ({ allowed: resource.type !== "project" })));
  const res = await call("/companies/:companyId/routines");
  expect(res.json.mock.calls[0][0].map((row: { id: string }) => row.id)).toEqual(["open"]);
  expect(native.decideReads).toHaveBeenCalledExactlyOnceWith(actor, [{ type: "company", companyId }, { type: "project", companyId, projectId }]);
});
it("checks native resource access before loading detail or historical cycles", async () => {
  native.decideReads.mockResolvedValue([{ allowed: true }, { allowed: false }]);
  for (const path of ["/routines/:id", "/routines/:id/runs"]) await expect(call(path)).rejects.toMatchObject({ status: 404 });
  expect(native.getDetail).not.toHaveBeenCalled(); expect(native.listRuns).not.toHaveBeenCalled();
});
it("uses the same guard for definition and trigger mutations", async () => {
  native.decideReads.mockResolvedValue([{ allowed: true }, { allowed: false }]);
  expect((await call("/routines/:id", "patch", { title: "Changed" })).statusCode).toBe(404);
  expect((await call("/routine-triggers/:id", "patch", { enabled: true })).statusCode).toBe(404);
  expect(native.update).not.toHaveBeenCalled(); expect(native.updateTrigger).not.toHaveBeenCalled();
});
it("revalidates proposed relationship references before creating or editing", async () => {
  native.decideReads.mockImplementation(async (_actor, resources) => resources.map((resource: { issueId?: string }) => ({ allowed: resource.issueId !== hiddenIssueId })));
  await expect(call("/companies/:companyId/routines", "post", { title: "New loop", parentIssueId: hiddenIssueId })).rejects.toMatchObject({ status: 404 });
  await expect(call("/routines/:id", "patch", { parentIssueId: hiddenIssueId })).rejects.toMatchObject({ status: 404 });
  expect(native.create).not.toHaveBeenCalled(); expect(native.update).not.toHaveBeenCalled();
});
it("hides inaccessible past task metadata and refuses restoring its private definition", async () => {
  native.decideReads.mockImplementation(async (_actor, resources) => resources.map((resource: { issueId?: string }) => ({ allowed: resource.issueId !== hiddenIssueId })));
  native.listRuns.mockResolvedValue([{ id: "secret", companyId, linkedIssueId: hiddenIssueId, linkedIssue: { title: "Secret" } }, { id: "visible", companyId, linkedIssueId: null }]);
  expect((await call("/routines/:id/runs")).json.mock.calls[0][0].map((row: { id: string }) => row.id)).toEqual(["visible"]);
  native.listRevisions.mockResolvedValue([{ id: revisionId, snapshot: { routine: { ...routine, parentIssueId: hiddenIssueId } } }]);
  native.getRevision.mockResolvedValue({ id: revisionId, snapshot: { routine: { ...routine, parentIssueId: hiddenIssueId } } });
  expect((await call("/routines/:id/revisions")).json).toHaveBeenCalledWith([]);
  await expect(call("/routines/:id/revisions/:revisionId/restore", "post")).rejects.toMatchObject({ status: 404 });
  expect(native.restoreRevision).not.toHaveBeenCalled();
});
it("retains readable detail while suppressing inaccessible active and previous tasks", async () => {
  native.decideReads.mockImplementation(async (_actor, resources) => resources.map((resource: { issueId?: string }) => ({ allowed: resource.issueId !== hiddenIssueId })));
  native.getDetail.mockResolvedValue({ ...routine, lastTriggeredAt: "2026-11-06T00:00:00Z", lastEnqueuedAt: "2026-11-06T00:00:00Z", activeIssue: { id: hiddenIssueId, title: "Secret" }, recentRuns: [{ id: "secret", companyId, linkedIssueId: hiddenIssueId }] });
  const res = await call("/routines/:id");
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ title: "Feedback", activeIssue: null, recentRuns: [], lastTriggeredAt: null, lastEnqueuedAt: null }));
});
it("checks a historical cycle's own definition even when it never created a task", async () => {
  native.decideReads.mockImplementation(async (_actor, resources) => resources.map((resource: { projectId?: string }) => ({ allowed: resource.projectId !== projectId })));
  const statements: string[] = [];
  const db = drizzle(async text => { statements.push(text); return { rows: [[revisionId, companyId, routineId, projectId, null]] }; });
  const rows = [{ id: "skipped-private", companyId, routineId, routineRevisionId: revisionId, linkedIssueId: null, triggerPayload: { sensitive: "private project feedback" } }];
  expect(await routineAccessService(db as never).filterRuns(actor, rows as never)).toEqual([]);
  expect(statements).toHaveLength(1);
  expect(statements[0]).toContain("->'routine'->>'projectId'");
  expect(statements[0]).not.toContain("env");
});
it("keeps original private annotation content protected after the routine moves into a readable scope", async () => {
  native.get.mockResolvedValue({ ...routine, projectId: null, latestRevisionId: revisionId, latestRevisionNumber: 2 });
  native.decideReads.mockImplementation(async (_actor, resources) => resources.map((resource: { projectId?: string }) => ({ allowed: resource.projectId !== projectId })));
  const db = drizzle(async () => ({ rows: [[companyId, routineId, projectId, null, 1, 1, 1, null, true], [companyId, routineId, null, null, 1, 2, 2, revisionId, true]] }));
  for (const [path, method, body] of [
    ["/routines/:id/description/annotations", "get", {}],
    ["/routines/:id/description/annotations/:threadId", "get", {}],
    ["/routines/:id/description/annotations/:threadId/comments", "post", { body: "Reply" }],
    ["/routines/:id/description/annotations/:threadId", "patch", { status: "open" }],
  ] as const) {
    const res = await call(path, method, body, { threadId: hiddenIssueId }, db);
    expect(res.statusCode).toBe(404); expect(res.json).toHaveBeenCalledWith({ error: "Routine not found" });
  }
  for (const operation of Object.values(annotations)) expect(operation).not.toHaveBeenCalled();
});
it("permits complete readable annotation history and refuses missing provenance without timestamp guesses", async () => {
  const scopes = [[companyId, routineId, projectId, null, 1, 1, 1, null, true], [companyId, routineId, null, null, 1, 2, 2, revisionId, true]];
  const db = drizzle(async () => ({ rows: scopes }));
  const access = routineAccessService(db as never);
  const row = { ...routine, latestRevisionId: revisionId, latestRevisionNumber: 2 };
  expect(await access.canReadAnnotationHistory(actor, row)).toBe(true);
  expect(await access.canReadAnnotationHistory(actor, { ...row, latestRevisionNumber: 3 })).toBe(false);
  expect(await access.canReadAnnotationHistory(actor, { ...row, latestRevisionId: null })).toBe(false);
});
it("does not leak a trigger marker from private history outside the recent cycle page", async () => {
  const current = { ...routine, projectId: null, latestRevisionId: revisionId, latestRevisionNumber: 2 };
  native.get.mockResolvedValue(current);
  native.getDetail.mockResolvedValue({ ...current, recentRuns: [], lastTriggeredAt: "2026-11-01T00:00:00Z", lastEnqueuedAt: null,
    triggers: [{ id: "old-trigger", lastFiredAt: "2026-11-01T00:00:00Z", lastResult: "private failure", lastWebhookDelivery: { receivedAt: "2026-11-01T00:00:00Z" } }] });
  native.decideReads.mockImplementation(async (_actor, resources) => resources.map((resource: { projectId?: string }) => ({ allowed: resource.projectId !== projectId })));
  const db = drizzle(async () => ({ rows: [[companyId, routineId, projectId, null, 1, 1, 1, null, true], [companyId, routineId, null, null, 1, 2, 2, revisionId, true]] }));
  const res = await call("/routines/:id", "get", {}, {}, db);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ title: "Feedback", lastTriggeredAt: null,
    triggers: [{ id: "old-trigger", lastFiredAt: null, lastResult: null, lastWebhookDelivery: null }] }));
});
