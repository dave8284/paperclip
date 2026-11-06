import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import type { AuthorizationActor } from "../services/authorization.js";
const mocks = vi.hoisted(() => ({ decide: vi.fn(), evaluate: vi.fn(), resolveAgentPrincipal: vi.fn() }));
vi.mock("../services/access.js", () => ({ accessService: () => ({ decide: mocks.decide }) }));
vi.mock("../services/company-skill-policy.js", () => ({ companySkillPolicyService: () => ({ evaluate: mocks.evaluate, resolveAgentPrincipal: mocks.resolveAgentPrincipal }) }));
import { assertCompanySkillMutation } from "../services/skill-mutation-authorization.js";
describe("native skill mutation authorization", () => {
  const db = {} as Db;
  const actor: AuthorizationActor = { type: "board", userId: "owner", source: "session", companyIds: ["company"] };
  beforeEach(() => { vi.resetAllMocks(); mocks.decide.mockResolvedValue({ allowed: true }); mocks.evaluate.mockResolvedValue({ allowed: true }); });
  it("retains the native missing-grant exception while forwarding the exact action/resource to policy", async () => {
    mocks.decide.mockResolvedValue({ allowed: false, reason: "deny_missing_grant" });
    const resource = { skillId: "existing-skill", skillKey: "capability-key", sourceType: "generated" as const };
    await assertCompanySkillMutation(db, actor, "company", "skills.update", resource);
    expect(mocks.evaluate).toHaveBeenCalledWith({ companyId: "company", principal: { type: "board", id: "owner", role: "board" }, action: "skills.update", resource });
  });
  it("enforces platform containment before evaluating or resolving a skill resource", async () => {
    mocks.decide.mockResolvedValue({ allowed: false, reason: "deny_restricted_key", explanation: "Restricted actor" });
    const resource = vi.fn();
    await expect(assertCompanySkillMutation(db, actor, "company", "skills.create", resource)).rejects.toMatchObject({ status: 403 });
    expect(mocks.evaluate).not.toHaveBeenCalled(); expect(resource).not.toHaveBeenCalled();
  });
  it("does not let allowed create policy substitute for denied update/edit or reset", async () => {
    mocks.evaluate.mockImplementation(async ({ action }) => ({ allowed: action === "skills.create", reason: "explicit_rule" }));
    await expect(assertCompanySkillMutation(db, actor, "company", "skills.create")).resolves.toBeUndefined();
    for (const action of ["skills.update", "skills.edit", "skills.reset"] as const) {
      await expect(assertCompanySkillMutation(db, actor, "company", action, { skillId: "existing" })).rejects.toMatchObject({ status: 403 });
    }
  });
  it("denies anonymous and cross-company agents before policy can grant access", async () => {
    await expect(assertCompanySkillMutation(db, { type: "none" }, "company", "skills.create")).rejects.toMatchObject({ status: 401 });
    await expect(assertCompanySkillMutation(db, { type: "agent", agentId: "agent", companyId: "foreign" }, "company", "skills.create")).rejects.toMatchObject({ status: 403 });
    expect(mocks.decide).not.toHaveBeenCalled(); expect(mocks.evaluate).not.toHaveBeenCalled();
  });
});
