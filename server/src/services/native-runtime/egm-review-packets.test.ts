import { createHash } from "node:crypto";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, it, vi } from "vitest";
import { prepareEgmPacketSchema } from "@paperclipai/shared";
import { egmReviewPacketService, egmBindingForReviewer, bindEgmPacketInteraction, retainEgmReviewPreparation } from "./egm-review-packets.js";
import { parseRetainedEgmPacket } from "./egm-packet-content.js";
import { egmCreatorAuthority, refreshEgmActor } from "./egm-packet-authority.js";

const boundary = vi.hoisted(() => ({ decide: vi.fn(), document: vi.fn(), invokable: vi.fn(), assignment: vi.fn(), activity: vi.fn(), publish: vi.fn(), responsible: vi.fn() }));
vi.mock("../authorization.js", () => ({ authorizationService: () => ({ decide: boundary.decide }) }));
vi.mock("../documents.js", () => ({ documentService: () => ({ getIssueDocumentRevision: boundary.document }) }));
vi.mock("../agent-invokability.js", () => ({ evaluateAgentInvokabilityFromDb: boundary.invokable }));
vi.mock("./native-review-participant.js", () => ({ getNativeReviewAssignment: boundary.assignment, readNativeReviewAssignmentContext: (value: unknown) => value }));
vi.mock("../activity-log.js", () => ({ persistActivity: boundary.activity, publishActivity: boundary.publish }));
vi.mock("../heartbeat/run-preparation.js", () => ({ createHeartbeatRunPreparation: () => ({
  resolveResponsibleUserIdForRunContext: boundary.responsible, getIssueExecutionContext: async () => ({ id: issueId }),
  getRoutineEnvForExecutionIssue: async () => ({}), resolveResponsibleUserIdForRunSeed: async () => "reviewer-responsible",
}) }));
vi.mock("../skills-catalog.js", () => {
  const body = "Packaged review criteria";
  const hash = createHash("sha256").update(body).digest("hex");
  const paths = ["references/upstream/agents/comprehension.md", "references/upstream/resources/document_standards/re-implementation-standard.md"];
  return { getCatalogPackageMetadata: () => ({ packageVersion: "fixture" }), getCatalogSkillOrThrow: () => ({ contentHash: `sha256:${hash}`, files: paths.map(path => ({ path, sizeBytes: Buffer.byteLength(body), sha256: hash })) }), readCatalogSkillFile: async (_key: string, path: string) => ({ path, content: body }) };
});

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1), issueId = id(2), sourceRunId = id(3), authorAgentId = id(4), reviewerAgentId = id(5), reviewRunId = id(6), interactionId = id(7), decisionId = id(8);
const actor = { type: "agent" as const, agentId: authorAgentId, runId: sourceRunId, companyId };
const request = prepareEgmPacketSchema.parse({ reviewerAgentId, packet: { documentId: id(10), revisionId: id(11) }, target: { documentId: id(12), revisionId: id(13) }, sources: [], persona: "comprehension", question: "Can this plan be explained without its author?" });
const scope = { issueId, sourceRunId };
const dialect = new PgDialect();
let state: ReturnType<typeof fixture>;
function fixture() {
  const source = { id: sourceRunId, companyId, agentId: authorAgentId, nativeIssueId: issueId, runtimeMode: "native", status: "running", runnerProfileJson: {} as Record<string, unknown>, resultJson: null };
  const reviewRun = { ...source, id: reviewRunId, agentId: reviewerAgentId, runnerProfileJson: {} as Record<string, unknown>, contextSnapshot: { nativeReviewInteractionId: interactionId, nativeReviewDecisionId: decisionId } };
  const issue = { id: issueId, companyId, assigneeAgentId: authorAgentId, executionRunId: sourceRunId };
  const locks: string[] = [], mutations: unknown[] = [];
  let submitted = false;
  const db: any = {
    transaction: async (work: (tx: unknown) => unknown) => work(db),
    select: () => ({ from: (table: any) => {
      const name = getTableName(table); let condition: SQL | undefined;
      const query: any = { where: (where: SQL) => { condition = where; return query; }, limit: () => query, for: () => { locks.push(name); return query; },
        then: (resolve: (rows: unknown[]) => unknown, reject: (e: unknown) => unknown) => {
          const params = condition ? dialect.sqlToQuery(condition).params : [];
          const rows = name === "issues" ? [issue] : name === "heartbeat_runs" ? [params.includes(reviewRunId) ? reviewRun : source]
            : name === "agents" ? [{ id: reviewerAgentId, companyId }] : name === "user" ? [{ approvalStatus: "approved" }] : name === "company_memberships" ? [{ status: "active" }] : name === "native_run_results" && submitted ? [{ id: id(20) }] : [];
          return Promise.resolve(rows).then(resolve, reject);
        } };
      return query;
    } }),
    update: (table: any) => ({ set: (values: any) => ({ where: async (where: SQL) => {
      mutations.push(values);
      const params = dialect.sqlToQuery(where).params;
      const run = params.includes(reviewRunId) ? reviewRun : source;
      const query = dialect.sqlToQuery(values.runnerProfileJson);
      if (query.sql.includes("- 'nativeEgmPacketPreparation'")) delete run.runnerProfileJson.nativeEgmPacketPreparation;
      for (const field of ["nativeEgmPacketPreparation", "nativeEgmPacketBinding", "nativeEgmPacketReceipt"]) {
        if (query.sql.includes(`'{${field}}'`)) run.runnerProfileJson[field] = JSON.parse(query.params[0] as string);
      }
    } }) }),
  };
  return { db, source, reviewRun, issue, locks, mutations, submit: () => { submitted = true; } };
}
const assignment = () => ({ interaction: { id: interactionId, companyId, issueId, addresseeAgentId: reviewerAgentId, sourceRunId, payload: { egmPacketPreparation: { schema: "agentos.egm-review-binding.v1", sourceRunId, requestSha256: (state.source.runnerProfileJson.nativeEgmPacketPreparation as any)?.requestSha256 } } }, sourceRun: state.source, sourceDecision: { id: decisionId } });
beforeEach(() => {
  vi.clearAllMocks(); state = fixture();
  boundary.decide.mockResolvedValue({ allowed: true }); boundary.invokable.mockResolvedValue({ invokable: true });
  boundary.responsible.mockResolvedValue("author-responsible");
  boundary.activity.mockResolvedValue({ publication: { type: "fixture" } });
  boundary.assignment.mockImplementation(async () => assignment());
  boundary.document.mockImplementation(async (ref: { documentId: string; revisionId: string }) => ({ ...ref, key: ref.documentId === id(10) ? "context-packet" : "plan", revisionNumber: 1, latestRevisionId: ref.revisionId, body: `Frozen ${ref.documentId}` }));
});
const service = () => egmReviewPacketService(state.db);

it("prepares before reviewer admission with real owner bindings and no execution claim", async () => {
  const response = await service().prepare(actor, scope, request);
  expect(state.locks.slice(0, 3)).toEqual(["native_run_finalizations", "issues", "heartbeat_runs"]);
  expect(response).toMatchObject({ stage: "server_prepared", execution: "pending_native_admission", providerDelivery: "not_observed", packet: { sourceRunId, authorAgentId, request: { reviewerAgentId } } });
  expect(parseRetainedEgmPacket(state.source.runnerProfileJson.nativeEgmPacketPreparation)).toEqual(response.packet);
  expect(JSON.stringify(boundary.activity.mock.calls)).not.toContain("Frozen");
  expect(boundary.publish).toHaveBeenCalledOnce();
});
it("retries the same frozen request after later document edits without substituting latest", async () => {
  const first = await service().prepare(actor, scope, request);
  boundary.document.mockImplementation(async (ref: { documentId: string; revisionId: string }) => ({ ...ref, key: ref.documentId === id(10) ? "context-packet" : "plan", revisionNumber: 1, latestRevisionId: id(99), body: `Frozen ${ref.documentId}` }));
  expect(await service().prepare(actor, scope, request)).toEqual(first);
  expect(state.mutations).toHaveLength(1);
  await expect(service().prepare(actor, scope, { ...request, question: "Different" })).rejects.toMatchObject({ status: 409 });
});
it("denies untrusted author identity and revoked source/reviewer reads before loading content", async () => {
  await expect(service().prepare({ ...actor, runId: id(100) }, scope, request)).rejects.toMatchObject({ status: 403 });
  expect(boundary.document).not.toHaveBeenCalled();
  boundary.decide.mockImplementation(async ({ actor: principal }) => ({ allowed: principal.agentId !== reviewerAgentId }));
  await expect(service().prepare(actor, scope, request)).rejects.toMatchObject({ status: 404 });
  expect(boundary.document).not.toHaveBeenCalled();
});
it("rejects preparation after result submission or stopped author before any packet write", async () => {
  state.submit(); await expect(service().prepare(actor, scope, request)).rejects.toMatchObject({ status: 409 });
  state = fixture(); state.source.status = "cancelled";
  await expect(service().prepare(actor, scope, request)).rejects.toMatchObject({ status: 409 });
  expect(state.mutations).toHaveLength(0);
});
it("rejects missing, stale and oversized source packets", async () => {
  boundary.document.mockResolvedValue(null);
  await expect(service().prepare(actor, scope, request)).rejects.toMatchObject({ status: 404 });
  boundary.document.mockImplementation(async (ref: any) => ({ ...ref, key: ref.documentId === id(10) ? "context-packet" : "plan", revisionNumber: 1, latestRevisionId: id(99), body: "old" }));
  await expect(service().prepare(actor, scope, request)).rejects.toMatchObject({ status: 409 });
  boundary.document.mockImplementation(async (ref: any) => ({ ...ref, key: ref.documentId === id(10) ? "context-packet" : "plan", revisionNumber: 1, latestRevisionId: ref.revisionId, body: "x".repeat(262_145) }));
  await expect(service().prepare(actor, scope, request)).rejects.toMatchObject({ status: 422 });
});
it("clears only an exact unbound receipt and rejects a stale clear", async () => {
  const prepared = await service().prepare(actor, scope, request);
  await expect(service().clear(actor, scope, "0".repeat(64))).rejects.toMatchObject({ status: 409 });
  expect(await service().clear(actor, scope, prepared.packet.requestSha256)).toMatchObject({ cleared: true });
  expect(state.source.runnerProfileJson.nativeEgmPacketPreparation).toBeUndefined();
});
it("allows explicit unbound opt-out after result admission while refusing new preparation", async () => {
  const prepared = await service().prepare(actor, scope, request);
  state.submit();
  await expect(service().prepare(actor, scope, request)).rejects.toMatchObject({ status: 409 });
  await expect(service().clear(actor, scope, "0".repeat(64))).rejects.toMatchObject({ status: 409 });
  expect(await service().clear(actor, scope, prepared.packet.requestSha256)).toMatchObject({ cleared: true });
  expect(state.source.runnerProfileJson.nativeEgmPacketPreparation).toBeUndefined();
  expect(boundary.activity.mock.calls.at(-1)?.[1]).toMatchObject({ action: "issue.egm_packet_cleared" });
});
it("binds only the named reviewer, preserves the packet and prevents clear/rebinding", async () => {
  const prepared = await service().prepare(actor, scope, request);
  await expect(egmBindingForReviewer(state.db, { companyId, issueId, sourceRunId, reviewerAgentId: id(99) })).rejects.toMatchObject({ status: 409 });
  const binding = await egmBindingForReviewer(state.db, { companyId, issueId, sourceRunId, reviewerAgentId });
  await bindEgmPacketInteraction(state.db, binding!, interactionId, decisionId);
  await expect(service().clear(actor, scope, prepared.packet.requestSha256)).rejects.toMatchObject({ status: 409 });
  await expect(bindEgmPacketInteraction(state.db, binding!, id(88), decisionId)).rejects.toMatchObject({ status: 409 });
  expect((await service().read({ ...actor, agentId: reviewerAgentId, runId: reviewRunId }, scope)).binding).toMatchObject({ interactionId, decisionId });
});
it("rechecks source and reviewer access on reads and binding instead of trusting retained bodies", async () => {
  await service().prepare(actor, scope, request);
  boundary.decide.mockImplementation(async ({ actor: principal }) => ({ allowed: principal.agentId !== reviewerAgentId }));
  await expect(service().read(actor, scope)).rejects.toMatchObject({ status: 404 });
  await expect(egmBindingForReviewer(state.db, { companyId, issueId, sourceRunId, reviewerAgentId })).rejects.toMatchObject({ status: 404 });
  boundary.decide.mockResolvedValue({ allowed: true }); boundary.document.mockResolvedValue(null);
  await expect(service().read(actor, scope)).rejects.toMatchObject({ status: 404 });
});
it("retains exact reviewer receipt, rejects stale generation and forged preparation", async () => {
  await service().prepare(actor, scope, request);
  const binding = await egmBindingForReviewer(state.db, { companyId, issueId, sourceRunId, reviewerAgentId });
  await bindEgmPacketInteraction(state.db, binding!, interactionId, decisionId);
  state.issue.executionRunId = reviewRunId;
  expect(await retainEgmReviewPreparation(state.db, reviewRunId, assignment() as never)).toBe(true);
  expect(state.reviewRun.runnerProfileJson.nativeEgmPacketReceipt).toMatchObject({ reviewerRunId: reviewRunId, interactionId, requestSha256: binding?.requestSha256, execution: "independent_review_unavailable", providerDelivery: "not_observed" });
  boundary.assignment.mockResolvedValue(null);
  await expect(retainEgmReviewPreparation(state.db, reviewRunId, assignment() as never)).rejects.toMatchObject({ status: 409 });
  const forged = structuredClone(state.source.runnerProfileJson.nativeEgmPacketPreparation) as any;
  forged.target.body = "Replacement";
  expect(() => parseRetainedEgmPacket(forged)).toThrow("digest does not match");
  expect(() => parseRetainedEgmPacket({ ...forged, isolated: true })).toThrow("invalid");
});
it("rechecks responsible-user ceilings and drops cached membership evidence after waiting", async () => {
  const original = { ...actor, onBehalfOfUserId: "author-responsible", onBehalfOfMemberships: [{ companyId, status: "active" }], __responsibleUserSnapshotMemo: new Map() };
  await service().prepare(original, scope, request);
  expect(boundary.decide.mock.calls.every(([arg]) => arg.actor.onBehalfOfMemberships === undefined && arg.actor.__responsibleUserSnapshotMemo === undefined)).toBe(true);
  boundary.decide.mockImplementation(async ({ actor: principal }) => ({ allowed: principal.onBehalfOfUserId !== "reviewer-responsible" }));
  await expect(service().read(original, scope)).rejects.toMatchObject({ status: 404 });
  boundary.decide.mockResolvedValue({ allowed: true }); boundary.responsible.mockResolvedValue("different-responsible");
  await expect(service().read(original, scope)).rejects.toMatchObject({ status: 403 });
});
it("does not discard an authorizer ceiling or accept a removed EGM binding", async () => {
  await expect(service().prepare({ ...actor, authorizingUserId: "original-authorizer" }, scope, request)).rejects.toThrow();
  expect(boundary.document).not.toHaveBeenCalled();
  await service().prepare(actor, scope, request);
  const review = assignment(); review.interaction.payload = {} as never;
  await expect(retainEgmReviewPreparation(state.db, reviewRunId, review as never)).rejects.toMatchObject({ status: 409 });
});
it("retains original board consent company ceilings, including an explicit empty scope", async () => {
  const limited = { type: "board" as const, source: "mcp_oauth" as const, userId: "operator", companyIds: [] };
  expect(egmCreatorAuthority(limited).companyIds).toEqual([]);
  expect(egmCreatorAuthority({ ...limited, companyIds: undefined })).not.toHaveProperty("companyIds");
  await expect(service().prepare(limited, scope, request)).rejects.toMatchObject({ status: 404 });
  expect(boundary.document).not.toHaveBeenCalled();
});
it("rejects a changed admitted run key scope instead of replaying broader creator scope", async () => {
  (state.source as any).contextSnapshot = { paperclipAgentJwtScope: { kind: "skill_test", issueId } };
  await expect(refreshEgmActor(state.db, { ...actor, keyScope: { kind: "standard" } })).rejects.toMatchObject({ status: 403 });
});
