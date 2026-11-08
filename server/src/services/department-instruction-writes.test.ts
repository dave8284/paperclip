import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getTableName } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentInstructionsService } from "./agent-instructions.js";
import { authorizeInstructionCommit } from "./agent-instruction-authorization.js";
import { agentInstructionsChangeTargetKey } from "./change-consent-gate.js";
import { recordInstructionChangeConsent, type InstructionChangeConsentReceipt } from "./agent-instruction-consent.js";

const policy = vi.hoisted(() => ({ department: vi.fn(), native: vi.fn() }));
vi.mock("./agent-hiring-authority.js", () => ({ resolveDepartmentConfigurationAuthority: policy.department }));
vi.mock("./authorization.js", () => ({ authorizationService: () => ({ decide: policy.native }), authorizationDeniedDetails: () => ({}) }));

const cleanup: string[] = [];
beforeEach(() => { policy.department.mockReset(); policy.department.mockResolvedValue({ departmentHead: true });
  policy.native.mockReset(); policy.native.mockResolvedValue({ allowed: true }); });
afterEach(async () => { await Promise.all(cleanup.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "department-instruction-writes-")); cleanup.push(root);
  await fs.writeFile(path.join(root, "AGENTS.md"), "original entry");
  await fs.writeFile(path.join(root, "NOTES.md"), "original notes");
  const companyId = randomUUID(), headId = randomUUID(), ownerId = randomUUID(), runId = randomUUID();
  const agent = { id: randomUUID(), companyId, role: "engineer", reportsTo: headId, name: "Staff",
    adapterConfig: { instructionsBundleMode: "external", instructionsRootPath: root, instructionsEntryFile: "AGENTS.md" } };
  const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId, agentId: headId, runId, onBehalfOfUserId: ownerId };
  const authority = { actor, departmentHead: true, requiresChangeGrant: true, consentedChange: true };
  let inTransaction = false;
  const consent = { id: randomUUID(), sourceRunId: randomUUID(),
    payload: { target: { type: "custom", key: agentInstructionsChangeTargetKey(agent.id) }, detailsMarkdown: "```diff\n-old\n+new\n```" },
    result: { outcome: "accepted" } as Record<string, unknown> };
  let consumed = 0;
  const locks: string[] = [];
  const db = {
    transaction: async (fn: (tx: Db) => Promise<unknown>) => {
      inTransaction = true; try { return await fn(db as unknown as Db); } finally { inTransaction = false; }
    },
    select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => {
      const name = getTableName(table);
      const rows = name === "agents" ? [agent] : name === "heartbeat_runs"
        ? [{ id: runId, companyId, responsibleUserId: ownerId, activeIdentityContextId: null }]
        : name === "company_memberships" ? [{ userId: ownerId }] : name === "issue_thread_interactions" ? [consent] : [];
      const query = { where: () => query, innerJoin: () => query, orderBy: () => query, limit: () => query,
        for: async (strength: string) => { locks.push(`${name}:${strength}`); return rows; },
        then: (resolve: (result: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
      return query;
    } }),
    update: () => ({ set: (patch: { result: Record<string, unknown> }) => ({ where: () => ({ returning: async () => {
      consent.result = patch.result; consumed += 1; return [{ id: consent.id }];
    } }) }) }),
  } as unknown as Db;
  return { db, root, agent, actor, authority, locks, inTransaction: () => inTransaction, consumed: () => consumed };
}

describe("instruction writer department boundaries", () => {
  it.each(["bundle", "write", "delete"])("checks current authority inside the %s writer before changing files", async kind => {
    const f = await fixture();
    policy.department.mockImplementation(async (_db, current) => {
      expect(f.inTransaction()).toBe(true);
      expect(current).toMatchObject({ id: f.agent.id, reportsTo: f.agent.reportsTo });
      expect(f.locks).toContain("agents:update");
      throw Object.assign(new Error("Employee moved outside this department"), { status: 403 });
    });
    const stale = { ...f.agent, reportsTo: randomUUID() };
    const service = agentInstructionsService(f.db);
    const operation = kind === "bundle" ? service.updateBundle(stale, { entryFile: "NEW.md" }, f.authority)
      : kind === "write" ? service.writeFile(stale, "NOTES.md", "must not persist", { departmentAuthority: f.authority })
      : service.deleteFile(stale, "NOTES.md", f.authority);
    await expect(operation).rejects.toMatchObject({ status: 403 });
    expect(await fs.readdir(f.root)).toEqual(["AGENTS.md", "NOTES.md"]);
    expect(await fs.readFile(path.join(f.root, "NOTES.md"), "utf8")).toBe("original notes");
    expect(policy.department).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: f.agent.id }), f.actor, {}, {
      lock: true, requireDepartmentHead: true, configurationRequiresChangeGrant: true,
      configurationConsentedChange: true,
    });
  });

  it("refuses authenticated legacy writes without a database authority boundary", async () => {
    const f = await fixture();
    await expect(agentInstructionsService().writeFile(f.agent, "NOTES.md", "must not persist", { departmentAuthority: f.authority }))
      .rejects.toMatchObject({ status: 422 });
    expect(await fs.readFile(path.join(f.root, "NOTES.md"), "utf8")).toBe("original notes");
  });

  it("applies the same locked ceiling to the canonical managed instruction commit authorizer", async () => {
    const f = await fixture();
    policy.department.mockImplementation(async () => {
      expect(f.inTransaction()).toBe(true);
      expect(f.locks).toContain("agents:share");
      throw Object.assign(new Error("Other department"), { status: 403 });
    });
    await expect(f.db.transaction(tx => authorizeInstructionCommit(tx, f.actor, f.agent))).rejects.toMatchObject({ status: 403 });
    expect(policy.department).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: f.agent.id }),
      expect.objectContaining({ agentId: f.actor.agentId, onBehalfOfUserId: f.actor.onBehalfOfUserId }), {}, {
        lock: true, targetAction: "agent_instructions:update", configurationRequiresChangeGrant: true,
        configurationConsentedChange: false,
      });
    expect(policy.native).toHaveBeenCalledOnce();
  });

  it("retains native instruction denials after the department accepts the target", async () => {
    const f = await fixture(); policy.native.mockResolvedValue({ allowed: false, reason: "deny_no_grant", explanation: "Native instruction grant revoked" });
    await expect(f.db.transaction(tx => authorizeInstructionCommit(tx, f.actor, f.agent))).rejects.toThrow("Native instruction grant revoked");
    expect(policy.department).not.toHaveBeenCalled();
  });

  it("preserves board instruction authorization without adding an employee hierarchy requirement", async () => {
    const f = await fixture();
    const board = { type: "board" as const, source: "session" as const, userId: f.actor.onBehalfOfUserId };
    await expect(authorizeInstructionCommit(f.db, board, f.agent)).resolves.toMatchObject(board);
    expect(policy.department).not.toHaveBeenCalled();
    expect(policy.native).toHaveBeenCalledWith(expect.objectContaining({ action: "agent_instructions:update" }));
  });

  it("consumes native change consent once and carries its server result through the locked scope check", async () => {
    const f = await fixture();
    policy.native.mockImplementation(async input => ({ allowed: input.scope?.consentedChange === true,
      reason: "deny_missing_consent", explanation: "Native change consent is required" }));
    await expect(f.db.transaction(tx => authorizeInstructionCommit(tx, f.actor, f.agent))).resolves.toMatchObject({ agentId: f.actor.agentId });
    expect(f.consumed()).toBe(1);
    expect(policy.department).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), {},
      expect.objectContaining({ lock: true, configurationConsentedChange: true }));
    await expect(f.db.transaction(tx => authorizeInstructionCommit(tx, f.actor, f.agent))).rejects.toMatchObject({ status: 403 });
    expect(f.consumed()).toBe(1);
  });

  it.each(["serialized receipt", "other target", "other execution"])("rejects an internal consent handoff for %s", async kind => {
    const f = await fixture();
    const valid = recordInstructionChangeConsent(f.actor, f.agent);
    const receipt = kind === "serialized receipt" ? JSON.parse(JSON.stringify(valid)) as InstructionChangeConsentReceipt : valid;
    const target = kind === "other target" ? { ...f.agent, id: randomUUID() } : f.agent;
    const actor = kind === "other execution" ? { ...f.actor, runId: randomUUID() } : f.actor;
    await expect(f.db.transaction(tx => authorizeInstructionCommit(tx, actor, target, receipt))).rejects.toMatchObject({ status: 403 });
    expect(f.consumed()).toBe(0);
    expect(policy.native).not.toHaveBeenCalled();
  });
});
