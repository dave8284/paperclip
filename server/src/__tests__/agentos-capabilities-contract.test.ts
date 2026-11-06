import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AGENTOS_CAPABILITY_SKILL_PREFIX, publishAgentosCapabilitySchema, decideAgentosCapabilitySchema } from "@paperclipai/shared";
import { writePaperclipSkillSyncPreference } from "@paperclipai/adapter-utils/server-utils";
import { skillVersionSelectionMap } from "../services/runtime-skill-selections.js";

// These tests qualify content/privacy and native selection contracts, not SQL
// authorization, transaction isolation, or an actual agent execution.
vi.mock("../services/agentos-workforce.js", () => ({ agentosWorkforceService: vi.fn() }));
vi.mock("../services/company-skills.js", () => ({ companySkillService: vi.fn() }));
vi.mock("../services/agent-configuration-transaction.js", () => ({ updateAgentConfigurationInTransaction: vi.fn() }));
import { capabilitySelectionHash, capabilitySkillPolicyActions, reviewedCapabilityMarkdown, publicCapabilityRelease } from "../services/agentos-capabilities.js";

describe("reviewed capability contracts", () => {
  it("requires native mutation actions for existing-release updates and pin rollback", () => {
    expect(capabilitySkillPolicyActions("adopt", false, false)).toEqual(["skills.import", "skills.create", "skills.install"]);
    expect(capabilitySkillPolicyActions("adopt", true, false)).toEqual(["skills.update", "skills.edit", "skills.create", "skills.install"]);
    expect(capabilitySkillPolicyActions("adopt", true, true)).toEqual(["skills.install"]);
    expect(capabilitySkillPolicyActions("rollback", true, true)).toEqual(["skills.reset"]);
  });
  it("keeps an adopted native version pin when experimental version UI is disabled", () => {
    const version = randomUUID(), key = `${AGENTOS_CAPABILITY_SKILL_PREFIX}${randomUUID()}:release-review`;
    const selected = skillVersionSelectionMap([{ key, versionId: version }, { key: "company/ordinary", versionId: "ordinary-version" }], { versionPinsEnabled: false });
    expect(selected.get(key)).toBe(version);
    expect(selected.get("company/ordinary")).toBeNull();
  });
  it("preserves exact reviewed Markdown bytes and rejects bundled executable or remote files", () => {
    const file = { path: "SKILL.md", kind: "skill", content: "---\nname: Review\n---\n\nExact text\n" };
    expect(reviewedCapabilityMarkdown({ fileInventory: [file] })).toBe(file.content);
    for (const version of [
      { fileInventory: [file, { ...file, path: "scripts/run.sh" }] },
      { fileInventory: [{ ...file, executable: true }] },
      { fileInventory: [{ ...file, encoding: "base64" }] },
      { fileInventory: [file], repositorySnapshotId: randomUUID() },
      { fileInventory: [{ ...file, content: "x".repeat(65537) }] },
      { fileInventory: [{ ...file, content: "\0secret" }] },
    ]) expect(() => reviewedCapabilityMarkdown(version)).toThrow();
  });
  it("fingerprints actual selections without exposing private adapter configuration", () => {
    const entries = [{ key: "second", versionId: null }, { key: "first", versionId: randomUUID() }];
    const first = writePaperclipSkillSyncPreference({ secret: "private-one" }, entries);
    const second = writePaperclipSkillSyncPreference({ secret: "private-two" }, [...entries].reverse());
    expect(capabilitySelectionHash(first)).toBe(capabilitySelectionHash(second));
    expect(capabilitySelectionHash(first)).not.toBe(capabilitySelectionHash(writePaperclipSkillSyncPreference({}, [{ key: "first", versionId: randomUUID() }])));
  });
  it("excludes originating company, native evidence and reviewer identity from published views", () => {
    const row = { id: randomUUID(), portfolioId: randomUUID(), employeeId: randomUUID(), capabilityKey: "review", revision: 1,
      name: "Review", markdown: "Reviewed method", contentHash: "hash", evaluationSummary: "Human accepted with stated limits",
      sourceCompanyId: "private-company", sourceSkillId: "private-skill", sourceVersionId: "private-version", sourceTestRunId: "private-test",
      reviewedByUserId: "private-owner", createdAt: new Date() };
    expect(publicCapabilityRelease(row)).toEqual({ id: row.id, employeeId: row.employeeId, capabilityKey: row.capabilityKey, revision: 1,
      name: row.name, markdown: row.markdown, contentHash: row.contentHash, evaluationSummary: row.evaluationSummary, createdAt: row.createdAt.toISOString() });
    expect(JSON.stringify(publicCapabilityRelease(row))).not.toContain("private-");
  });
  it("requires explicit reviewed acceptance and native source/test/version references", () => {
    const input = { id: randomUUID(), employeeId: randomUUID(), capabilityKey: "review", name: "Review", expectedLatestRevision: 0,
      sourceCompanyId: randomUUID(), sourceSkillId: randomUUID(), sourceVersionId: randomUUID(), sourceTestRunId: randomUUID(),
      evaluationSummary: "Accepted against the test with known limits", reviewedAndSanitized: true };
    expect(publishAgentosCapabilitySchema.safeParse(input).success).toBe(true);
    expect(publishAgentosCapabilitySchema.safeParse({ ...input, reviewedAndSanitized: false }).success).toBe(false);
    expect(publishAgentosCapabilitySchema.safeParse({ ...input, arbitrarySourceUrl: "https://example.test/private" }).success).toBe(false);
    expect(publishAgentosCapabilitySchema.safeParse({ ...input, sourceTestRunId: undefined }).success).toBe(false);
  });
  it("requires an explicit revision-bound company decision and rejects identity overrides", () => {
    const input = { id: randomUUID(), releaseId: randomUUID(), action: "rollback", reason: "The new version missed a requirement",
      expectedAssignmentRevision: 2, expectedSelectionHash: "a".repeat(64) };
    expect(decideAgentosCapabilitySchema.safeParse(input).success).toBe(true);
    for (const patch of [{ actorUserId: "other-owner" }, { expectedSelectionHash: "unknown" }, { expectedAssignmentRevision: 0 }, { reason: " " }]) {
      expect(decideAgentosCapabilitySchema.safeParse({ ...input, ...patch }).success).toBe(false);
    }
  });
});
