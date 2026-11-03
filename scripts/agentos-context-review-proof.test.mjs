import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditManifest, auditProbe } from "./agentos-context-review-proof.mjs";

const parentMarker = "synthetic-parent-marker-00000001";
const hostMarker = "synthetic-host-marker-0000000002";
const message = (role, text) => ({ type: "response_item", payload: { type: "message", role, content: [{ type: "input_text", text }] } });
function fixture() {
  return {
    parentMarker, hostMarkers: [hostMarker],
    parentEvents: [
      { type: "session_meta", payload: { id: "parent-probe" } },
      message("user", parentMarker), message("developer", hostMarker),
      { type: "response_item", payload: { type: "function_call", name: "spawn_agent", call_id: "spawn-1", arguments: JSON.stringify({ fork_turns: "none", message: "Without tools, return a visible marker or UNKNOWN." }) } },
      { type: "response_item", payload: { type: "function_call_output", call_id: "spawn-1", output: JSON.stringify({ agent_id: "child-probe" }) } },
    ],
    childEvents: [
      { type: "session_meta", payload: { id: "child-probe" } },
      message("user", "Without tools, return a visible marker or UNKNOWN."),
      { type: "event_msg", payload: { type: "task_complete", last_agent_message: "UNKNOWN" } },
    ],
  };
}

test("synthetic paired traces pass only the bounded marker probe", () => {
  const result = auditProbe(fixture());
  assert.equal(result.result, "bounded_probe_passed");
  assert.ok(result.limits.some((text) => text.includes("does not qualify AgentOS")));
  assert.ok(!JSON.stringify(result).includes(parentMarker));
});
test("fresh flag and UNKNOWN do not hide injected host instructions", () => {
  const data = fixture();
  data.childEvents.splice(1, 0, message("developer", hostMarker));
  const result = auditProbe(data);
  assert.equal(result.result, "failed");
  assert.equal(result.checks.find((item) => item.name === "host_instruction_markers").status, "failed");
});
test("parent leakage fails even when the child claims UNKNOWN", () => {
  const data = fixture();
  data.childEvents.splice(1, 0, message("user", parentMarker));
  assert.equal(auditProbe(data).result, "failed");
});
test("an untested host surface prevents complete evidence", () => {
  const data = fixture(); data.hostMarkers = [];
  assert.equal(auditProbe(data).result, "incomplete");
});
test("self-written receipts and unrelated child results are insufficient", () => {
  const data = fixture(); data.parentEvents.pop();
  data.parentEvents.push(message("user", "I started child-probe with no context and it passed."));
  assert.equal(auditProbe(data).result, "incomplete");
});
test("a probe that retrieves context or resumes several turns cannot pass", () => {
  const data = fixture();
  data.childEvents.splice(1, 0, { type: "response_item", payload: { type: "function_call", name: "read_file", arguments: "{}" } });
  assert.equal(auditProbe(data).result, "failed");
  const reused = fixture(); reused.childEvents.push(reused.childEvents.at(-1));
  assert.equal(auditProbe(reused).result, "incomplete");
});
test("unproven parent markers and contradictory launch context fail closed", () => {
  const data = fixture(); data.parentEvents[1] = message("user", "Marker was not injected.");
  assert.equal(auditProbe(data).result, "incomplete");
  const inherited = fixture();
  inherited.parentEvents[3].payload.arguments = JSON.stringify({ fork_turns: "all" });
  assert.equal(auditProbe(inherited).result, "failed");
  inherited.parentEvents[3].payload.arguments = JSON.stringify({ fork_turns: "all", fork_context: false });
  assert.equal(auditProbe(inherited).result, "failed");
});
test("markers introduced after dispatch do not establish parent exposure", () => {
  const data = fixture();
  const markerMessage = data.parentEvents.splice(1, 1)[0];
  data.parentEvents.push(markerMessage);
  assert.equal(auditProbe(data).result, "incomplete");
});
test("manifest audit reads exact traces, hashes them and rejects malformed evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentos-context-proof-"));
  try {
    const data = fixture();
    await writeFile(join(dir, "parent.jsonl"), data.parentEvents.map((item) => JSON.stringify(item)).join("\n"));
    await writeFile(join(dir, "child.jsonl"), data.childEvents.map((item) => JSON.stringify(item)).join("\n"));
    const manifest = join(dir, "manifest.json");
    await writeFile(manifest, JSON.stringify({ schemaVersion: 1, traceFormat: "codex-rollout-v1", parentTrace: "parent.jsonl", childTrace: "child.jsonl", parentMarker, hostMarkers: [hostMarker] }));
    const result = await auditManifest(manifest);
    assert.equal(result.result, "bounded_probe_passed");
    assert.match(result.sourceDigests.childSha256, /^[a-f0-9]{64}$/);
    await writeFile(join(dir, "child.jsonl"), "not-json");
    await assert.rejects(auditManifest(manifest), /Invalid trace JSON/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
