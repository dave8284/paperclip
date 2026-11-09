import path from "node:path";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { PlanRow } from "./plan-task-scoring.js";
import type { PlanSkillSource } from "./plan-task-skills.js";

export type PlanInvocation = { name: string; assetDigest: string };

/** Predict one exact native read-only projection from the selected local
 * authoring copy. The completed run must later attest that exact bundle. */
export async function planInvocations(sources: PlanSkillSource[], snapshot: PlanRow): Promise<PlanInvocation[]> {
  return Promise.all(sources.filter(s => s.selected).map(async source => {
    const entries = snapshot.entries?.filter((e: PlanRow) => e.key === source.key && e.desired);
    const entry = entries?.length === 1 ? entries[0] : undefined;
    if (!entry || !/^[a-zA-Z0-9_-]+$/.test(entry.runtimeName)) throw new Error("Missing unique assigned planning runtime name");
    if (typeof entry.sourcePath !== "string" || !path.isAbsolute(entry.sourcePath)) throw new Error("Missing selected planning skill source");
    // Selection exposes the editable authoring source; native admission later
    // snapshots it and strips write bits. Measure the local read permissions
    // instead of inventing world readability under a restrictive server umask.
    const file = await open(path.join(entry.sourcePath, "SKILL.md"), constants.O_RDONLY | constants.O_NOFOLLOW);
    let manifest;
    try {
      const info = await file.stat();
      if (!info.isFile() || !(info.mode & 0o400) || (info.mode & 0o111)) throw new Error("Planning skill source must be owner-readable and non-executable");
      if (info.size !== source.bytes) throw new Error("Planning skill source size differs from its declared source");
      const bytes = await file.readFile();
      if (bytes.length !== source.bytes || createHash("sha256").update(bytes).digest("hex") !== source.sha256) throw new Error("Planning skill source bytes differ from its declared source");
      manifest = [{ path: "SKILL.md", sha256: source.sha256, mode: info.mode & 0o555, size: bytes.length }];
    } finally { await file.close(); }
    return { name: entry.runtimeName, assetDigest: createHash("sha256").update(JSON.stringify(manifest)).digest("hex") };
  }));
}

export function planInvocationPrompt(prompt: string, invocations: PlanInvocation[]) {
  return invocations.length ? `${prompt}\n\nUse the assigned planning guidance: ${invocations.map(s => `/${s.name}`).join(" and ")}.` : prompt;
}

/** Exact initial lead run identity; provider turn acceptance joins its actual turn ID.
 * turn.submitted is emitted before the provider assigns that ID, so its skill
 * receipt establishes submission within this run, not a provider call-ID join. */
export function planExposure(input: { runs: PlanRow[]; evidence: PlanRow[]; leadId: string; parentId: string; invocations: PlanInvocation[] }) {
  const initial = input.runs.filter(r => r.agentId === input.leadId && r.nativeIssueId === input.parentId)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))[0];
  const records = input.evidence.filter(r => r.runId === initial?.id);
  const events: PlanRow[] = records.length === 1 && Array.isArray(records[0].events) ? records[0].events : [];
  const submitted = events.filter(e => e.runId === initial?.id && e.eventType === "turn.submitted");
  const prp = submitted.length === 1 ? submitted[0].payload?.prpEvent : undefined;
  const actual = prp?.payload?.skillInputs ?? [];
  const accepts = events.filter(e => e.runId === initial?.id && e.eventType === "turn.accepted");
  const acceptedTurn = accepts.length === 1 ? accepts[0].payload?.prpEvent : undefined;
  const accepted = typeof acceptedTurn?.turnId === "string" && acceptedTurn.turnId.length > 0 &&
    acceptedTurn.payload?.turnId === acceptedTurn.turnId && events.some(e => e.runId === initial?.id && e.eventType === "turn.started" &&
      e.payload?.prpEvent?.turnId === acceptedTurn.turnId);
  const expected = input.invocations;
  const matched = Array.isArray(actual) && actual.length === expected.length && expected.every(wanted => actual.filter((s: PlanRow) =>
    s.type === "skill" && s.name === wanted.name && typeof s.path === "string" &&
    path.isAbsolute(s.path) && s.path.endsWith(`/runtime-context-assets/bundles/${wanted.assetDigest}/SKILL.md`)).length === 1);
  return { id: "assigned-guidance-delivered", passed: Boolean(initial && prp && accepted && matched),
    detail: `Initial lead run must submit exactly ${expected.length} native skill inputs tied to the verified immutable file digests, and have a provider-accepted turn. This verifies the submission contract, not model consumption.`,
    selectedCount: expected.length, observedInputCount: Array.isArray(actual) ? actual.length : null };
}
