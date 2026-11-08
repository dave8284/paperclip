import { describe, expect, it } from "vitest";
import { canEnrollAiWorkspaceCredential } from "./ai-workspace-accounts.js";

describe("reuse of a subscription requires its actual owner", () => {
  const common = { userId: "owner", membershipRole: "owner", grantKind: "organization", subjectUserId: null, audience: [] };
  it("allows a current company owner to enroll an organization credential regardless of historical creator", () => {
    expect(canEnrollAiWorkspaceCredential(common)).toBe(true);
  });
  it.each(["admin", "operator", "viewer", null])("rejects organization enrollment by role %s without company ownership", membershipRole => {
    expect(canEnrollAiWorkspaceCredential({ ...common, membershipRole })).toBe(false);
  });
  it("retains the human credential audience ceiling for the company owner", () => {
    expect(canEnrollAiWorkspaceCredential({ ...common, audience: [{ subjectType: "user", subjectId: "other" }] })).toBe(false);
    expect(canEnrollAiWorkspaceCredential({ ...common, audience: [{ subjectType: "agent", subjectId: "owner" }] })).toBe(false);
    expect(canEnrollAiWorkspaceCredential({ ...common, audience: [{ subjectType: "user", subjectId: "owner" }] })).toBe(true);
  });
  it("does not let a company owner or administrator enroll another person's private credential", () => {
    expect(canEnrollAiWorkspaceCredential({ ...common, grantKind: "user", subjectUserId: "other" })).toBe(false);
    expect(canEnrollAiWorkspaceCredential({ ...common, grantKind: "user", subjectUserId: "owner", membershipRole: "operator" })).toBe(true);
  });
  it("never promotes agent grants to owner accounts", () => {
    expect(canEnrollAiWorkspaceCredential({ ...common, grantKind: "agent", subjectUserId: "owner" })).toBe(false);
  });
});
