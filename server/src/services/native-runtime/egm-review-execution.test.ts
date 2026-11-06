import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { EGM_REVIEW_TOOLS, assertEgmNativeExecution, buildEgmReviewRequest, egmPurposeForPacket, executeEgmReviewTool, hasEgmFindings } from "./egm-review-execution.js";
import { nativeRuntimeContextFixture } from "./runtime-context.test-fixture.js";
import type { EgmPacketPreparation } from "./egm-packet-content.js";

const boundary = vi.hoisted(() => ({ load: vi.fn(), write: vi.fn(), activity: vi.fn(), publish: vi.fn() }));
vi.mock("./egm-review-packets.js", () => ({ loadEgmReviewPacket: boundary.load }));
vi.mock("./runtime-context.js", () => ({ buildEgmRuntimeContext: async () => nativeRuntimeContextFixture() }));
vi.mock("../documents.js", () => ({ documentService: () => ({ upsertIssueDocument: boundary.write }) }));
vi.mock("../activity-log.js", () => ({ persistActivity: boundary.activity, publishActivity: boundary.publish }));
vi.mock("../isolated-task-directory.js", () => ({ materializeEgmReviewWorkspace: async () => "/private/egm-review" }));
const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const binding = { companyId: id(1), issueId: id(2), runId: id(3), agentId: id(4) };
const doc = (n: number) => ({ documentId: id(n), revisionId: id(n + 1), body: `Frozen source ${n}`, sha256: String(n).padStart(64, "0") });
const packet = { requestSha256: "f".repeat(64), request: { question: "Does the target satisfy the standard?" },
  packet: doc(10), target: doc(20), sources: [doc(30)], persona: { path: "persona.md", body: "Persona", sha256: "a".repeat(64) },
  standard: { path: "standard.md", body: "Standard", sha256: "b".repeat(64) },
} as unknown as EgmPacketPreparation;
const purpose = egmPurposeForPacket(packet);
const dialect = new PgDialect();
let profile: Record<string, unknown>, db: any;
const report = () => ({ packetSha256: packet.requestSha256, targetRevisionId: packet.target.revisionId,
  summary: "A required decision is missing", uncertainties: [], findings: [{ id: "missing-decision", severity: "major",
    sourceId: "target", sourceQuote: "Frozen source 20", explanation: "No decision is specified", recommendation: "Add a decision" }] });
beforeEach(() => {
  vi.clearAllMocks(); profile = { nativeExecutionInput: { executionPurpose: purpose } };
  db = { transaction: async (work: any) => work(db), select: () => ({ from: () => ({ where: () => ({ for: async () => [] }) }) }),
    update: () => ({ set: (values: any) => ({ where: async () => {
      const query = dialect.sqlToQuery(values.runnerProfileJson);
      const key = query.sql.includes("nativeEgmSourceReads") ? "nativeEgmSourceReads" : "nativeEgmFindings";
      profile[key] = JSON.parse(query.params[0] as string);
    } }) }),
  };
  boundary.load.mockImplementation(async () => ({ packet, run: { id: binding.runId, runnerProfileJson: profile } }));
  boundary.write.mockResolvedValue({ document: { id: id(80), latestRevisionId: id(81), key: `egm-review-${binding.runId}` } });
  boundary.activity.mockResolvedValue({ publication: { action: "issue.egm_findings_submitted" } });
});
const tool = (name: string, args: unknown) => executeEgmReviewTool(db, binding, purpose, name, args);

it("offers only frozen-source reads and findings, denying history, writes and review approval", async () => {
  expect(EGM_REVIEW_TOOLS.map(entry => entry.name)).toEqual(["read_egm_source", "submit_egm_findings"]);
  for (const name of ["get_task_history", "get_task_context", "read_document", "write_document", "resolve_review", "shell"]) {
    await expect(tool(name, {})).rejects.toMatchObject({ status: 403 });
  }
  await expect(tool("read_egm_source", { sourceId: "current-plan" })).rejects.toMatchObject({ status: 403 });
  await expect(tool("read_egm_source", { sourceId: "target", revisionId: id(90) })).rejects.toThrow();
  expect(await tool("read_egm_source", { sourceId: "target" })).toMatchObject({ body: packet.target.body, revisionId: packet.target.revisionId });
  boundary.load.mockRejectedValueOnce(new Error("Current review authority revoked"));
  await expect(tool("read_egm_source", { sourceId: "packet" })).rejects.toThrow("revoked");
  expect(boundary.write).not.toHaveBeenCalled();
});

it("requires complete source coverage and exact evidence, persists one report, and leaves approval to the owner", async () => {
  await expect(tool("submit_egm_findings", report())).rejects.toThrow("Read every");
  for (const source of purpose.sourceDigests) await tool("read_egm_source", { sourceId: source.id });
  await expect(tool("submit_egm_findings", { ...report(), targetRevisionId: id(99) })).rejects.toThrow("exact frozen target");
  await expect(tool("submit_egm_findings", { ...report(), findings: [{ ...report().findings[0], sourceQuote: "invented quote" }] })).rejects.toThrow("exact quote");
  expect(await tool("submit_egm_findings", report())).toMatchObject({ recorded: true, ownerResolutionRequired: true });
  expect(hasEgmFindings({ runnerProfileJson: profile })).toBe(true);
  expect(boundary.write).toHaveBeenCalledWith(expect.objectContaining({ key: `egm-review-${binding.runId}`, createdByRunId: binding.runId }));
  expect(boundary.publish).toHaveBeenCalledOnce();
  await tool("submit_egm_findings", report());
  expect(boundary.write).toHaveBeenCalledOnce();
  await expect(tool("submit_egm_findings", { ...report(), summary: "different report" })).rejects.toThrow("different findings");
  profile.nativeExecutionInput = { executionPurpose: { ...purpose, packetSha256: "0".repeat(64) } };
  expect(hasEgmFindings({ runnerProfileJson: profile })).toBe(false);
  await expect(tool("read_egm_source", { sourceId: "packet" })).rejects.toMatchObject({ status: 403 });
});

it("rejects ordinary or contaminated execution and accepts only exact frozen prompt/context/binding", async () => {
  const execution = { schema: "paperclip.native-execution-input.v9", executionPurpose: purpose, binding,
    workspace: { cwd: "/private/egm-review" },
    provider: { kind: "codex" }, homeMode: "isolated", session: { lifecyclePolicy: { mode: "per_turn" } },
    runtimeContext: nativeRuntimeContextFixture(), planningContext: null, interactionResponses: [], credentialBindings: [],
    task: { prompt: buildEgmReviewRequest(packet), description: buildEgmReviewRequest(packet) } };
  expect(await assertEgmNativeExecution(db, execution as never)).toBe(packet);
  for (const override of [{ homeMode: "preconfigured" }, { provider: { kind: "acpx" } }, { executionPurpose: undefined },
    { workspace: { cwd: "/employee/repository" } },
    { initialCommunicationGuidance: "private history" }, { planningContext: { body: "prior plan annotations" } },
    { runtimeContext: { ...execution.runtimeContext, aggregateDigest: "0".repeat(64) } }, { task: { ...execution.task, prompt: "caller text" } }]) {
    await expect(assertEgmNativeExecution(db, { ...execution, ...override } as never)).rejects.toMatchObject({ status: 403 });
  }
  await expect(assertEgmNativeExecution(db, { ...execution, executionPurpose: { ...purpose, packetSha256: "0".repeat(64) } } as never)).rejects.toMatchObject({ status: 409 });
});
