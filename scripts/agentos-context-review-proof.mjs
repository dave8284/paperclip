#!/usr/bin/env node
/**
 * Audit a deliberately prepared Codex context-marker probe from retained traces.
 * This reads local evidence only: no model, application API, credential or mutation.
 * It does not prove filesystem containment, memory isolation or review quality.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_TRACE_BYTES = 32 * 1024 * 1024;
class EvidenceError extends Error {}
const hash = (value) => createHash("sha256").update(value).digest("hex");
const messages = (events) => events.flatMap((event) => {
  const item = event.type === "response_item" ? event.payload : null;
  return item?.type === "message" && ["user", "developer", "system"].includes(item.role)
    ? item.content?.map((part) => part.text ?? "") ?? [] : [];
}).join("\n");
const nativeItem = (event) => event.type === "response_item" ? event.payload : null;

function json(value) {
  try { return typeof value === "string" ? JSON.parse(value) : value; }
  catch { return null; }
}

function parseTrace(bytes) {
  if (bytes.length > MAX_TRACE_BYTES) throw new EvidenceError("Trace exceeds the 32 MiB audit limit; export the exact probe session.");
  // Split only LF: Unicode separators can legitimately occur inside JSON strings.
  return bytes.toString("utf8").split("\n").filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new EvidenceError(`Invalid trace JSON at record ${index + 1}; no partial proof is accepted.`); }
  });
}

export function auditProbe({ parentEvents, childEvents, parentMarker, hostMarkers = [] }) {
  if (typeof parentMarker !== "string" || parentMarker.length < 24) {
    throw new EvidenceError("Use a unique synthetic parent marker of at least 24 characters, never a credential.");
  }
  if (!Array.isArray(hostMarkers) || hostMarkers.some((marker) => typeof marker !== "string" || marker.length < 24)) {
    throw new EvidenceError("Host markers must be unique synthetic strings of at least 24 characters.");
  }
  if (new Set([parentMarker, ...hostMarkers]).size !== hostMarkers.length + 1) {
    throw new EvidenceError("Each probe surface requires a distinct marker.");
  }
  const checks = [];
  const check = (name, status, detail) => checks.push({ name, status, detail });
  const childMetas = childEvents.filter((event) => event.type === "session_meta");
  const parentId = parentEvents.find((event) => event.type === "session_meta")?.payload?.id;
  const childId = childMetas[0]?.payload?.id;
  const outputs = new Map(parentEvents.map(nativeItem).filter((item) => item?.type === "function_call_output")
    .map((item) => [item.call_id, json(item.output)]));
  const launches = parentEvents.map(nativeItem).filter((item) => item?.type === "function_call"
    && /(?:^|__|\.)spawn_agent$/.test(item.name ?? "")
    && outputs.get(item.call_id)?.agent_id === childId);
  const launch = launches.length === 1 ? launches[0] : null;
  const launchArgs = json(launch?.arguments);
  const freshRequested = (launchArgs?.fork_turns === "none" || launchArgs?.fork_context === false)
    && (launchArgs.fork_turns === undefined || launchArgs.fork_turns === "none")
    && (launchArgs.fork_context === undefined || launchArgs.fork_context === false);
  check("native_child_binding", parentId && childId && parentId !== childId && childMetas.length === 1 && launch
    ? "passed" : "unverified", "Require distinct native session IDs and exactly one spawn/result binding to this child.");
  check("fresh_context_requested", launch && freshRequested ? "passed" : launch ? "failed" : "unverified",
    "A fresh-context flag is configuration evidence, not isolation proof.");
  const complete = childEvents.filter((event) => event.type === "event_msg" && event.payload?.type === "task_complete");
  const answer = complete[0]?.payload?.last_agent_message;
  check("single_completed_probe_turn", complete.length === 1 && typeof answer === "string" ? "passed" : "unverified",
    "Require the actual child's single completed turn; a parent summary is insufficient.");
  const childCalls = childEvents.map(nativeItem).filter((item) => ["function_call", "custom_tool_call"].includes(item?.type));
  const executions = childEvents.filter((event) => event.payload?.item?.type === "CommandExecution");
  check("no_probe_tools", childCalls.length === 0 && executions.length === 0 ? "passed" : "failed",
    "The marker-only probe must not retrieve context with tools.");
  check("probe_answer", answer?.trim() === "UNKNOWN" ? "passed" : typeof answer === "string" ? "failed" : "unverified",
    "Read the child's native final answer, not an author-written receipt.");
  const launchIndex = parentEvents.findIndex((event) => nativeItem(event) === launch);
  const parentInput = messages(launchIndex < 0 ? [] : parentEvents.slice(0, launchIndex));
  const childText = JSON.stringify(childEvents);
  const dispatchText = JSON.stringify(launchArgs ?? {});
  check("parent_turn_marker", !parentInput.includes(parentMarker) || !launch ? "unverified"
    : dispatchText.includes(parentMarker) || childText.includes(parentMarker) ? "failed" : "passed",
  "Parent marker must be visible in the parent, omitted from dispatch and absent from the entire retained child trace.");
  check("host_instruction_markers", hostMarkers.length === 0 ? "not_run"
    : hostMarkers.some((marker) => !parentInput.includes(marker)) || !launch ? "unverified"
      : hostMarkers.some((marker) => dispatchText.includes(marker) || childText.includes(marker)) ? "failed" : "passed",
  "Separately probe known host instruction files; parent-turn isolation cannot establish their exclusion.");
  const failed = checks.some((item) => item.status === "failed");
  const completeEvidence = checks.every((item) => item.status === "passed");
  return {
    schemaVersion: 1,
    scope: "codex-retained-trace-marker-probe",
    result: failed ? "failed" : completeEvidence ? "bounded_probe_passed" : "incomplete",
    parentSessionId: parentId ?? null,
    childSessionId: childId ?? null,
    checks,
    limits: [
      "This local export audit is not cryptographic authentication of the evidence producer.",
      "The operator must retain the original native traces and record how each host marker was injected.",
      "Passing proves only these markers on this runtime/configuration; it does not prove all context or memory is excluded.",
      "This does not qualify AgentOS task/run linkage, tool restrictions, source-read coverage, company access, or review quality.",
    ],
  };
}

export async function auditManifest(manifestPath) {
  const absolute = resolve(manifestPath);
  const manifest = JSON.parse(await readFile(absolute, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.traceFormat !== "codex-rollout-v1") {
    throw new EvidenceError("Unsupported evidence manifest; expected schemaVersion 1 and traceFormat codex-rollout-v1.");
  }
  if (typeof manifest.parentTrace !== "string" || typeof manifest.childTrace !== "string") {
    throw new EvidenceError("Provide explicit parentTrace and childTrace paths; discovery across unrelated sessions is not supported.");
  }
  const [parentBytes, childBytes] = await Promise.all([
    readFile(resolve(dirname(absolute), manifest.parentTrace)),
    readFile(resolve(dirname(absolute), manifest.childTrace)),
  ]);
  const result = auditProbe({
    parentEvents: parseTrace(parentBytes), childEvents: parseTrace(childBytes),
    parentMarker: manifest.parentMarker, hostMarkers: manifest.hostMarkers,
  });
  return { ...result, sourceDigests: { parentSha256: hash(parentBytes), childSha256: hash(childBytes) } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] === "--help") {
    process.stdout.write("Usage: node scripts/agentos-context-review-proof.mjs <private-probe-manifest.json>\nRead-only local trace audit; exit 0 = bounded probe passed, 1 = failed, 2 = incomplete/invalid.\n");
    process.exitCode = args[0] === "--help" ? 0 : 2;
  } else {
    try {
      const result = await auditManifest(args[0]);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result.result === "bounded_probe_passed" ? 0 : result.result === "failed" ? 1 : 2;
    } catch (error) {
      // Never print malformed input, marker values, transcripts, or file contents.
      const reason = error instanceof EvidenceError ? error.message : "Unreadable or invalid evidence input.";
      process.stderr.write(`Context-review audit could not complete: ${reason}\n`);
      process.exitCode = 2;
    }
  }
}
