import { describe, expect, it } from "vitest";
import { planExposure, planInvocationPrompt, planInvocations } from "./plan-task-exposure.js";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { planHash } from "./plan-task-cases.js";

const digest = "a".repeat(64);
function fixture(enabled = true) {
  const skillInputs = enabled ? [{ type: "skill", name: "planning", path: `/private/runtime-context-assets/bundles/${digest}/SKILL.md` }] : [];
  return { runs: [{ id: "lead-run", agentId: "lead", nativeIssueId: "parent", startedAt: "2026-10-05T00:00:00Z" }],
    evidence: [{ runId: "lead-run", events: [
      { runId: "lead-run", eventType: "turn.submitted", payload: { prpEvent: { payload: { skillInputs } } } },
      { runId: "lead-run", eventType: "turn.accepted", payload: { prpEvent: { turnId: "turn", payload: { turnId: "turn" } } } },
      { runId: "lead-run", eventType: "turn.started", payload: { prpEvent: { turnId: "turn", payload: {} } } },
    ] }], leadId: "lead", parentId: "parent", invocations: enabled ? [{ name: "planning", assetDigest: digest }] : [] };
}

describe("planning native invocation evidence", () => {
  it.each([0o400, 0o404, 0o440, 0o444, 0o600, 0o644])("attests the exact native read-only projection of source mode %i", async mode => {
    const root = await mkdtemp(path.join(tmpdir(), "planning-snapshot-"));
    try {
      const bytes = "Exact planning instructions", file = path.join(root, "SKILL.md");
      await writeFile(file, bytes); await chmod(file, mode);
      const source = { originalKey: "planning", key: "planning", id: "skill", sourcePath: "fixture", sha256: planHash(bytes), bytes: Buffer.byteLength(bytes), words: 3, selected: true };
      const invocations = await planInvocations([source], { entries: [{ key: "planning", desired: true, runtimeName: "planning", sourcePath: root }] });
      const expected = planHash(JSON.stringify([{ path: "SKILL.md", sha256: source.sha256, mode: mode & 0o555, size: source.bytes }]));
      expect(invocations).toEqual([{ name: "planning", assetDigest: expected }]);
      const evidence = fixture(); evidence.invocations = invocations;
      evidence.evidence[0]!.events[0]!.payload.prpEvent.payload.skillInputs![0]!.path = `/private/runtime-context-assets/bundles/${expected}/SKILL.md`;
      expect(planExposure(evidence).passed).toBe(true);
      if ((mode & 0o555) !== 0o444) {
        const invented = planHash(JSON.stringify([{ path: "SKILL.md", sha256: source.sha256, mode: 0o444, size: source.bytes }]));
        evidence.evidence[0]!.events[0]!.payload.prpEvent.payload.skillInputs![0]!.path = `/private/runtime-context-assets/bundles/${invented}/SKILL.md`;
        expect(planExposure(evidence).passed).toBe(false);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.each(["unreadable", "executable", "bytes", "size", "symlink"])("rejects a %s source before provider execution", async problem => {
    const root = await mkdtemp(path.join(tmpdir(), "planning-snapshot-"));
    try {
      const bytes = "Exact planning instructions", file = path.join(root, "SKILL.md");
      const target = problem === "symlink" ? path.join(root, "other.md") : file;
      await writeFile(target, bytes); await chmod(target, problem === "unreadable" ? 0o000 : problem === "executable" ? 0o500 : 0o400);
      if (problem === "symlink") await symlink(target, file);
      const source = { originalKey: "planning", key: "planning", id: "skill", sourcePath: "fixture", sha256: problem === "bytes" ? planHash("Different instructions") : planHash(bytes),
        bytes: Buffer.byteLength(bytes) + (problem === "size" ? 1 : 0), words: 3, selected: true };
      await expect(planInvocations([source], { entries: [{ key: "planning", desired: true, runtimeName: "planning", sourcePath: root }] })).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.each([true, false])("accepts exact enabled=%s delivery and accepted-turn receipts", enabled => expect(planExposure(fixture(enabled)).passed).toBe(true));
  it.each(["missing", "wrong-run", "wrong-turn", "wrong-path", "wrong-digest", "wrong-name", "duplicate", "prose-only", "unaccepted"])("rejects %s delivery evidence", problem => {
    const value = fixture();
    const event = value.evidence[0]!.events[0]!;
    const skills = event.payload.prpEvent.payload.skillInputs!;
    if (problem === "missing") value.evidence = [];
    if (problem === "wrong-run") event.runId = "other-run";
    if (problem === "wrong-turn") value.evidence[0]!.events[1]!.payload.prpEvent.turnId = "other-turn";
    if (problem === "wrong-path") skills[0]!.path = `/unverified/${digest}/SKILL.md`;
    if (problem === "wrong-digest") skills[0]!.path = skills[0]!.path.replace(digest, "b".repeat(64));
    if (problem === "wrong-name") skills[0]!.name = "other";
    if (problem === "duplicate") skills.push({ ...skills[0]! });
    if (problem === "prose-only") event.eventType = "agentMessage";
    if (problem === "unaccepted") value.evidence[0]!.events.splice(1, 1);
    expect(planExposure(value).passed).toBe(false);
  });
  it("rejects a disabled control with an actual skill input", () => {
    const value = fixture(); value.invocations = [];
    expect(planExposure(value).passed).toBe(false);
  });
  it("keeps the business prompt intact and invokes only assigned guidance", () => {
    expect(planInvocationPrompt("Business task", [])).toBe("Business task");
    expect(planInvocationPrompt("Business task", [{ name: "planning", assetDigest: digest }]))
      .toBe("Business task\n\nUse the assigned planning guidance: /planning.");
  });
});
