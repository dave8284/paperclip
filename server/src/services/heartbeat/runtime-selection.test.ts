import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agents, authUsers, companyMemberships, companies, completionContracts, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issues, issueThreadInteractions, nativeRunFinalizations, nativeRunResults, statusDecisions, workAssessments, type Db } from "@paperclipai/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { CHAT_CONTROL_RECOVERY_ADMISSION_KEY } from "../chat-control-recovery-stop.js";
import { buildNativeRuntimeContext } from "../native-runtime/runtime-context.js";
import { nativeRuntimeContextFixture } from "../native-runtime/runtime-context.test-fixture.js";
import { prepareNativeWorkspaceSync } from "../native-runtime/native-workspace-sync.js";
import { resolveHeartbeatNativeRuntimeMode } from "../native-runtime/runtime-mode.js";
import { canonicalNativeRuntimeContextDigest } from "../../vendor/paperclip-runner/index.js";
import { documentService } from "../documents.js";
import { prepareEgmPacketContent } from "../native-runtime/egm-packet-content.js";
import { egmCreatorAuthority } from "../native-runtime/egm-packet-authority.js";
import { assertEgmNativeExecution, egmPurposeForPacket, executeEgmReviewTool, hasEgmFindings } from "../native-runtime/egm-review-execution.js";
import { nativeCompletionFeedback } from "../native-runtime/native-completion-feedback.js";
import { PaperclipRunnerToolAuthority } from "../native-runtime/paperclip-runner-tool-authority.js";
import { selectHeartbeatRuntime, type HeartbeatRuntimeSelectionInput } from "./runtime-selection.js";

// Keep the real contract, session, and runtime-selection transactions. Replace only
// filesystem materialization and sandbox synchronization at their external boundaries.
vi.mock("../native-runtime/runtime-context.js", async (original) => ({
  ...await original<typeof import("../native-runtime/runtime-context.js")>(),
  buildNativeRuntimeContext: vi.fn(async () => nativeRuntimeContextFixture()),
}));
vi.mock("../native-runtime/native-workspace-sync.js", async (original) => ({
  ...await original<typeof import("../native-runtime/native-workspace-sync.js")>(),
  prepareNativeWorkspaceSync: vi.fn(async () => null),
}));

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("heartbeat runtime selection boundary", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let instructionRoot: string;
  const reviewWorkspaces: string[] = [];
  beforeAll(async () => {
    instructionRoot = await mkdtemp(join(tmpdir(), "paperclip-selection-instructions-"));
    await writeFile(join(instructionRoot, "AGENTS.md"), "Complete the assigned task.\n");
    database = await startEmbeddedPostgresTestDatabase("paperclip-runtime-selection");
    db = createDb(database.connectionString);
    await db.execute(sql`set client_min_messages = warning`);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); if (instructionRoot) await rm(instructionRoot, { recursive: true, force: true }); for (const cwd of reviewWorkspaces) await rm(cwd, { recursive: true, force: true }); });
  beforeEach(async () => {
    await db.execute(sql`truncate table companies restart identity cascade`);
    vi.clearAllMocks();
    vi.mocked(prepareNativeWorkspaceSync).mockResolvedValue(null);
    vi.mocked(buildNativeRuntimeContext).mockImplementation(async () => {
      const context = nativeRuntimeContextFixture();
      context.instructions.bundle.rootPath = instructionRoot;
      return { ...context, aggregateDigest: canonicalNativeRuntimeContextDigest(context) };
    });
  });

  async function fixture(adapterType = "paperclip_runner") {
    const [company] = await db.insert(companies).values({ name: "Runtime selection", issuePrefix: "SEL" }).returning();
    const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Selecting agent", status: "running", adapterType, adapterConfig: { provider: "codex", model: "gpt-5.6-luna" } }).returning();
    const [issue] = await db.insert(issues).values({ companyId: company.id, title: "Complete this task", description: "Preserve the requested work", assigneeAgentId: agent.id }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: company.id, agentId: agent.id, issueId: issue.id, scopeKind: "issue", status: "running" }).returning();
    const now = new Date();
    const input: HeartbeatRuntimeSelectionInput = {
      run, agent,
      nativeRuntimeResolution: resolveHeartbeatNativeRuntimeMode({ persisted: run, enabled: true, runtimeConfig: {}, adapterConfig: agent.adapterConfig, agent, issue, target: null, workspaceId: null }),
      task: { issueRef: issue, issueContext: null, context: { paperclipTaskMarkdown: "Complete this task" }, executionContinuation: null, safeWakeComments: [], safeWakeCommentContext: null, paperclipWakePayload: null, acceptedPlanContinuationWake: false },
      session: { persistedNativeExecutionInput: null, persistedRunnerProfile: {}, taskSessionCredentialCompatible: true, taskSessionDecodedParams: null, taskSessionForRun: null, isFailedChatRunRetry: false, getFreshSessionHandoff: vi.fn(async () => "Earlier context") },
      workspace: { persistedExecutionWorkspace: null, executionWorkspace: { cwd: "/tmp/paperclip-runtime-selection", repoUrl: null, repoRef: null, branchName: null }, executionTarget: null, isDotRun: false, projectRepositoryPaths: [],
        activeEnvironmentLease: { lease: { id: randomUUID(), companyId: company.id, environmentId: null, executionWorkspaceId: null, issueId: issue.id, heartbeatRunId: run.id, status: "active", leasePolicy: "ephemeral", provider: null, providerLeaseId: null, acquiredAt: now, lastUsedAt: now, expiresAt: null, releasedAt: null, failureReason: null, cleanupStatus: null, metadata: null, createdAt: now, updatedAt: now } },
      },
      config: { runtimeConfig: {}, runtimeSkillEntries: [], runScopedMentionedSkillKeys: [], instructionCopy: null, agentIdentity: undefined, issueAssigneeOverrides: null, resolvedConfig: {}, managedAiRuntime: undefined },
      recovery: {}, trace: { providerTraceRequested: false, providerTraceCapture: null },
      issuesSvc: { addComment: vi.fn() }, runtimeEnv: {}, onAdapterEvent: vi.fn(async () => {}),
      onNativeLifecycleSelected: vi.fn(), onProviderResourceDisposition: vi.fn(), onNativeOwnershipHeld: vi.fn(), stopControllerLease: vi.fn(),
    };
    return { input, issue, run, agent };
  }
  const read = (id: string) => db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, id)).then(rows => rows[0]!);
  const coordinators = (id: string) => db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, id));
  const sandbox = { kind: "remote" as const, transport: "sandbox" as const, remoteCwd: "/workspace", reusableLeaseConfigured: false };

  async function reviewFixture() {
    const base = await fixture();
    const { input, issue, agent, run } = base;
    const companyId = agent.companyId, issueId = issue.id;
    const [worker] = await db.insert(agents).values({ companyId, name: "Source worker", status: "idle", adapterType: "paperclip_runner" }).returning();
    const [contract] = await db.insert(completionContracts).values({ companyId, issueId, revision: 1,
      schemaVersion: "paperclip.completion-contract.v1", policyVersion: "fixture", risk: "standard", completionAuthority: "server_arbiter", incompleteCriteriaPolicy: "preserve_non_terminal",
      contractJson: { revision: "fixture", objective: "Submit work for review", criteria: [{ id: "objective", requirement: "Submit work for review" }] }, canonicalSha256: "0".repeat(64), createdByActorType: "system", createdByActorId: "fixture",
    }).returning();
    const [sourceRun] = await db.insert(heartbeatRuns).values({ companyId, agentId: worker.id, nativeIssueId: issueId, runtimeMode: "native", status: "succeeded", completionContractId: contract.id, completionContractSha256: contract.canonicalSha256 }).returning();
    const [result] = await db.insert(nativeRunResults).values({ companyId, issueId, runId: sourceRun.id, completionContractId: contract.id, serverFingerprint: randomUUID(), schemaStatus: "accepted", resultJson: {}, canonicalSha256: "0".repeat(64) }).returning();
    const [assessment] = await db.insert(workAssessments).values({ companyId, issueId, runId: sourceRun.id, contractId: contract.id, resultId: result.id, triggerKind: "native_result", triggerActorCompanyId: companyId, priorIssueStatus: "in_progress", priorStatusVersion: 0, policyVersion: "fixture", assessmentJson: {}, inputDigest: randomUUID() }).returning();
    const [reviewIssue] = await db.update(issues).set({ status: "in_review", assigneeAgentId: worker.id }).where(eq(issues.id, issueId)).returning();
    const [decision] = await db.insert(statusDecisions).values({ companyId, issueId, runId: sourceRun.id, assessmentId: assessment.id, decisionVersion: 1, policyVersion: "fixture", fromStatus: "in_progress", toStatus: "in_review", reasonCode: "explicit_review", decisionJson: { projectedStatusVersion: reviewIssue.statusVersion }, decisionDigest: randomUUID(), applicationState: "applied" }).returning();
    await db.update(issues).set({ lastStatusDecisionId: decision.id }).where(eq(issues.id, issueId));
    const [interaction] = await db.insert(issueThreadInteractions).values({ companyId, issueId, kind: "request_confirmation", sourceRunId: sourceRun.id, addresseeAgentId: agent.id, createdByAgentId: worker.id,
      payload: { version: 1, prompt: "Review the submitted work.", target: { type: "custom", key: "native_completion_review", revisionId: decision.id } },
    }).returning();
    const context = { issueId, nativeReviewInteractionId: interaction.id, nativeReviewDecisionId: decision.id, forceFreshSession: true, nativeReviewContextReceipt: { forged: true } };
    await db.update(heartbeatRuns).set({ contextSnapshot: context }).where(eq(heartbeatRuns.id, run.id));
    input.run = await read(run.id);
    input.task.issueRef = reviewIssue;
    input.task.context = { ...input.task.context, ...context };
    if (input.nativeRuntimeResolution.kind === "native") Object.assign(input.nativeRuntimeResolution.profile, { nativeReviewContextReceipt: { forged: true } });
    return { ...base, sourceRun, interaction, decision };
  }

  it("persists a server-derived review context receipt and native outcome references with the admitted input", async () => {
    const { input, run, interaction, sourceRun, decision } = await reviewFixture();
    const selected = await selectHeartbeatRuntime(db, input);
    if (!selected.selected || !selected.nativeExecution) throw new Error("Expected review selection");
    const saved = await read(run.id);
    const receipt = saved.runnerProfileJson?.nativeReviewContextReceipt;
    expect(receipt).toMatchObject({
      schema: "agentos.native-review-context-receipt.v1", stage: "server_prepared", reviewerRunId: run.id,
      references: { sourceRunId: sourceRun.id, sourceDecisionId: decision.id, reviewInteractionId: interaction.id, findingsRunId: run.id, resolutionInteractionId: interaction.id },
      preparedInput: { taskPromptSha256: createHash("sha256").update(selected.nativeExecution.task.prompt).digest("hex"), normalizedSessionId: selected.nativeExecution.session.normalizedSessionId },
      qualification: { providerDelivery: "not_observed", parentConversationIsolation: "unverified", hostInstructionAndMemoryIsolation: "unverified", sourceReadCoverage: "unverified", readOnlyEnforcement: "unverified" },
    });
    expect(receipt).not.toHaveProperty("forged");
    expect(JSON.stringify(receipt)).not.toContain("Review the submitted work.");
    expect(selected.getNativeFreshSessionHandoff).toBeUndefined();
    input.run = saved;
    input.session.persistedNativeExecutionInput = selected.nativeExecution;
    input.session.persistedRunnerProfile = saved.runnerProfileJson ?? {};
    input.task.context.paperclipTaskMarkdown = "A later author summary must not replace prepared evidence";
    expect((await selectHeartbeatRuntime(db, input)).selected).toBe(true);
    expect((await read(run.id)).runnerProfileJson?.nativeReviewContextReceipt).toEqual(receipt);
  });

  it("does not persist a review receipt when cancellation wins preparation", async () => {
    const { input, run } = await reviewFixture();
    input.beforeNativeRuntimeSelection = async () => {
      await db.update(heartbeatRuns).set({ status: "cancelled" }).where(eq(heartbeatRuns.id, run.id));
    };
    expect(await selectHeartbeatRuntime(db, input)).toEqual({ selected: false });
    expect((await read(run.id)).runnerProfileJson).toBeNull();
    expect(await coordinators(run.id)).toHaveLength(0);
  });

  it.each(["absent", "drifted-under-lock"])("retains the admitted historical review receipt when current context is %s", async (scenario) => {
    const { input, run } = await reviewFixture();
    const selected = await selectHeartbeatRuntime(db, input);
    if (!selected.selected || !selected.nativeExecution) throw new Error("Expected review selection");
    const saved = await read(run.id);
    const receipt = saved.runnerProfileJson?.nativeReviewContextReceipt;
    expect(receipt).not.toBeNull();
    input.run = saved;
    input.session.persistedNativeExecutionInput = selected.nativeExecution;
    input.session.persistedRunnerProfile = saved.runnerProfileJson ?? {};
    if (scenario === "absent") {
      await db.update(heartbeatRuns).set({ contextSnapshot: {} }).where(eq(heartbeatRuns.id, run.id));
      input.run = await read(run.id);
      input.task.context = {};
    } else {
      input.beforeNativeRuntimeSelection = async () => {
        await db.update(heartbeatRuns).set({ contextSnapshot: { nativeReviewInteractionId: randomUUID(), nativeReviewDecisionId: randomUUID() } }).where(eq(heartbeatRuns.id, run.id));
      };
    }
    expect((await selectHeartbeatRuntime(db, input)).selected).toBe(true);
    const recovered = await read(run.id);
    expect(recovered.runnerProfileJson?.nativeExecutionInput).toEqual(saved.runnerProfileJson?.nativeExecutionInput);
    expect(recovered.runnerProfileJson?.nativeReviewContextReceipt).toEqual(receipt);
  });

  it("does not retain corrupted receipt metadata on recovery without current review context", async () => {
    const { input, run } = await reviewFixture();
    const selected = await selectHeartbeatRuntime(db, input);
    if (!selected.selected || !selected.nativeExecution) throw new Error("Expected review selection");
    const saved = await read(run.id);
    const receipt = saved.runnerProfileJson?.nativeReviewContextReceipt as Record<string, unknown>;
    await db.update(heartbeatRuns).set({ contextSnapshot: {}, runnerProfileJson: {
      ...saved.runnerProfileJson, nativeReviewContextReceipt: { ...receipt, qualification: { hostInstructionAndMemoryIsolation: "passed" } },
    } }).where(eq(heartbeatRuns.id, run.id));
    input.run = await read(run.id);
    input.task.context = {};
    input.session.persistedNativeExecutionInput = selected.nativeExecution;
    input.session.persistedRunnerProfile = input.run.runnerProfileJson ?? {};
    expect((await selectHeartbeatRuntime(db, input)).selected).toBe(true);
    expect((await read(run.id)).runnerProfileJson?.nativeReviewContextReceipt).toBeNull();
  });

  it("admits a frozen-only native review and persists exact source coverage/findings without resolving the owner's review", async () => {
    const { input, run, issue, agent, sourceRun, interaction, decision } = await reviewFixture();
    const userId = randomUUID(), companyId = agent.companyId;
    await db.insert(authUsers).values({ id: userId, name: "Packet owner", email: `${userId}@example.test`, approvalStatus: "approved", createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" });
    await db.update(issues).set({ responsibleUserId: userId, executionRunId: run.id }).where(eq(issues.id, issue.id));
    await db.update(heartbeatRuns).set({ responsibleUserId: userId, contextSnapshot: { issueId: issue.id } }).where(eq(heartbeatRuns.id, sourceRun.id));
    await db.update(heartbeatRuns).set({ responsibleUserId: userId, runtimeMode: "native", nativeIssueId: issue.id }).where(eq(heartbeatRuns.id, run.id));
    const documents = documentService(db);
    const packetDoc = await documents.upsertIssueDocument({ issueId: issue.id, key: "context-packet", format: "markdown", body: "Review only the frozen target against the selected standard.", createdByUserId: userId });
    const target = await documents.upsertIssueDocument({ issueId: issue.id, key: "plan", format: "markdown", body: "The plan omits a rollback decision.", createdByUserId: userId });
    const packet = await prepareEgmPacketContent(db, { companyId, issueId: issue.id, sourceRunId: sourceRun.id, authorAgentId: sourceRun.agentId,
      preparedBy: { type: "user", id: userId }, creatorAuthority: egmCreatorAuthority({ type: "board", userId, source: "local_implicit" }),
      request: { reviewerAgentId: agent.id, packet: { documentId: packetDoc.document.id, revisionId: packetDoc.document.latestRevisionId! },
        target: { documentId: target.document.id, revisionId: target.document.latestRevisionId! }, sources: [], persona: "comprehension", question: "Can the plan be implemented without its author?" },
    });
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeEgmPacketPreparation: packet, nativeEgmPacketBinding: {
      interactionId: interaction.id, decisionId: decision.id, requestSha256: packet.requestSha256,
    } } }).where(eq(heartbeatRuns.id, sourceRun.id));
    await db.update(issueThreadInteractions).set({ payload: { ...interaction.payload, egmPacketPreparation: {
      schema: "agentos.egm-review-binding.v1", sourceRunId: sourceRun.id, requestSha256: packet.requestSha256,
    } } }).where(eq(issueThreadInteractions.id, interaction.id));
    input.run = await read(run.id);
    input.task.context = { ...input.task.context, paperclipWake: { privateHistory: "EXCLUDED_PARENT_MARKER" }, paperclipCase: { privateMemory: "EXCLUDED_MEMORY_MARKER" } };
    input.config.runtimeConfig = { paperclipConnectionInstructions: { text: "EXCLUDED_CONNECTION_MARKER", digest: "0".repeat(64) } };
    input.config.managedAiRuntime = { attribution: { method: "subscription", provider: "openai" } } as never;
    input.workspace.projectRepositoryPaths = ["EXCLUDED_REPOSITORY_MARKER"];
    const selected = await selectHeartbeatRuntime(db, input);
    if (!selected.selected || !selected.nativeExecution) throw new Error("Expected packet execution selection");
    const execution = selected.nativeExecution;
    reviewWorkspaces.push(execution.workspace.cwd!);
    expect(execution.workspace.cwd).not.toBe(input.workspace.executionWorkspace.cwd);
    expect(execution).toMatchObject({ schema: "paperclip.native-execution-input.v9", executionPurpose: egmPurposeForPacket(packet),
      homeMode: "isolated", session: { lifecyclePolicy: { mode: "per_turn" } },
      runtimeContext: { skills: [], mcp: { bindingId: null } } });
    expect(JSON.stringify(execution)).not.toContain("EXCLUDED_");
    expect(selected.getNativeFreshSessionHandoff).toBeUndefined();
    expect(await assertEgmNativeExecution(db, execution)).toEqual(packet);
    input.run = await read(run.id);
    input.session.persistedNativeExecutionInput = execution;
    input.session.persistedRunnerProfile = input.run.runnerProfileJson ?? {};
    input.task.context.paperclipTaskMarkdown = "EXCLUDED_RECOVERY_MARKER";
    const recovered = await selectHeartbeatRuntime(db, input);
    expect(recovered.selected && recovered.nativeExecution).toEqual(execution);
    const purpose = egmPurposeForPacket(packet);
    const toolAuthority = new PaperclipRunnerToolAuthority(db, { ...execution.binding, egmPurpose: purpose,
      nativeReview: { nativeReviewInteractionId: interaction.id, nativeReviewDecisionId: decision.id } });
    const execute = (tool: string, args: unknown) => toolAuthority.execute({ tool, callId: randomUUID(), arguments: args });
    expect(toolAuthority.definitions().map(tool => tool.name)).toEqual(["read_egm_source", "submit_egm_findings"]);
    for (const source of purpose.sourceDigests) await execute("read_egm_source", { sourceId: source.id });
    await expect(execute("get_task_history", {})).rejects.toMatchObject({ status: 403 });
    await execute("submit_egm_findings", {
      packetSha256: packet.requestSha256, targetRevisionId: packet.target.revisionId, summary: "Rollback is not decided", uncertainties: [],
      findings: [{ id: "rollback", severity: "major", sourceId: "target", sourceQuote: "omits a rollback decision", explanation: "Rollback cannot be implemented", recommendation: "Specify the rollback decision" }],
    });
    expect(hasEgmFindings(await read(run.id))).toBe(true);
    const finished = { schema: "paperclip.run_result.v1" as const, reportedWorkDisposition: "done" as const, summary: "Findings recorded",
      completionClaim: { contractRevision: execution.completionContract.contract.revision, objectiveSatisfied: true, criteria: [], remainingWork: [] },
      evidence: [], verification: [], attentionRequests: [], artifacts: [] };
    await expect(nativeCompletionFeedback(db, run.id, finished)).resolves.toContain("task remains in review");
    expect((await documents.getIssueDocumentByKey(issue.id, `egm-review-${run.id}`))?.body).toContain("Rollback is not decided");
    expect((await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, interaction.id)))[0].status).toBe("pending");
    // Frozen exact revisions remain readable after an owner edits the current plan.
    await documents.upsertIssueDocument({ issueId: issue.id, key: "plan", format: "markdown", body: "A newer plan", baseRevisionId: target.document.latestRevisionId, createdByUserId: userId });
    expect(await executeEgmReviewTool(db, execution.binding, purpose, "read_egm_source", { sourceId: "target" })).toMatchObject({ body: packet.target.body, revisionId: packet.target.revisionId });
    await db.update(authUsers).set({ approvalStatus: "suspended" }).where(eq(authUsers.id, userId));
    await expect(executeEgmReviewTool(db, execution.binding, purpose, "read_egm_source", { sourceId: "target" })).rejects.toMatchObject({ status: 403 });
    await expect(nativeCompletionFeedback(db, run.id, finished)).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ approvalStatus: "approved" }).where(eq(authUsers.id, userId));
    await db.update(heartbeatRuns).set({ status: "cancelled" }).where(eq(heartbeatRuns.id, run.id));
    await expect(executeEgmReviewTool(db, execution.binding, purpose, "read_egm_source", { sourceId: "target" })).rejects.toMatchObject({ status: 403 });
    await expect(nativeCompletionFeedback(db, run.id, finished)).rejects.toMatchObject({ status: 403 });
  });

  it("persists the native input, completion contract, and coordinator before transferring cleanup ownership", async () => {
    const { input, run } = await fixture();
    input.task.context.nativeReviewContextReceipt = { forged: true };
    if (input.nativeRuntimeResolution.kind === "native") Object.assign(input.nativeRuntimeResolution.profile, { nativeReviewContextReceipt: { forged: true } });
    input.workspace.onCheckpoint = vi.fn(async () => {});
    input.workspace.onPhase = async (_name, work) => work();
    vi.mocked(prepareNativeWorkspaceSync).mockImplementationOnce(async args => {
      expect(await read(run.id)).toMatchObject({ runtimeMode: "native", nativeIssueId: input.task.issueRef!.id });
      expect(await coordinators(run.id)).toHaveLength(1);
      expect(input.stopControllerLease).toHaveBeenCalledOnce();
      expect(args).toMatchObject({ runId: run.id, workspaceId: run.id, workspaceLocalDir: input.workspace.executionWorkspace.cwd });
      expect(args.onCheckpoint).toBe(input.workspace.onCheckpoint);
      expect(args.onPhase).toBe(input.workspace.onPhase);
      return null;
    });
    const selected = await selectHeartbeatRuntime(db, input);
    expect(selected.selected).toBe(true);
    if (!selected.selected) throw new Error("Expected selection");
    const saved = await read(run.id);
    expect(saved).toMatchObject({ runtimeMode: "native", driverKind: "codex_app_server", nativePhase: "observed", nativeSessionId: expect.any(String), runnerInstanceId: selected.nativeRunnerInstanceId,
      runnerProfileJson: { nativeExecutionInput: selected.nativeExecution, recoveryEventInventoryVersion: 1, nativePreparationFencingVersion: 1, nativeReviewContextReceipt: null } });
    expect(await db.select().from(completionContracts)).toHaveLength(1);
    expect(selected.getNativeFreshSessionHandoff).toBe(input.session.getFreshSessionHandoff);
    expect(input.onNativeOwnershipHeld).not.toHaveBeenCalled();
  });

  it("persists the Copilot task model without accepting task provider or permission changes", async () => {
    const { input, run, issue } = await fixture();
    const adapterConfig = { provider: "acpx", acpxAgent: "copilot", model: "gpt-5.6-luna", acpxPermissionMode: "approve-reads" };
    input.agent = { ...input.agent, adapterConfig };
    await db.update(agents).set({ adapterConfig }).where(eq(agents.id, input.agent.id));
    input.nativeRuntimeResolution = resolveHeartbeatNativeRuntimeMode({
      persisted: input.run, enabled: true, runtimeConfig: {}, adapterConfig,
      agent: input.agent, issue, target: null, workspaceId: null,
    });
    input.config.issueAssigneeOverrides = { adapterConfig: {
      model: "gpt-6-luna", provider: "codex", acpxAgent: "pi", acpxPermissionMode: "approve-all",
    } };
    const selected = await selectHeartbeatRuntime(db, input);
    if (!selected.selected || !selected.nativeExecution) throw new Error("Expected native Copilot selection");
    const expected = { kind: "acpx", agent: "copilot", model: "gpt-6-luna", permissionMode: "approve-reads" };
    expect(selected.nativeExecution.provider).toMatchObject(expected);
    expect((await read(run.id)).runnerProfileJson).toMatchObject({ nativeExecutionInput: { provider: expected } });
  });

  it("persists configured GitHub instruction skills without admitting provider-mentioned skills", async () => {
    const { input, issue, run } = await fixture();
    input.config.runScopedMentionedSkillKeys = ["company/test/configured"];
    input.task.context.paperclipWake = {
      reason: "External chat message received", externalChatProvider: "github", checkedOutByHarness: true,
      issue: { id: issue.id, workMode: "standard" },
      comments: [{ id: "review-comment", body: "Please use /provider-mentioned" }],
      commentIds: ["review-comment"], latestCommentId: "review-comment",
      commentWindow: { requestedCount: 1, includedCount: 1, missingCount: 0 }, fallbackFetchNeeded: false,
    };
    vi.mocked(buildNativeRuntimeContext).mockImplementationOnce(async () => {
      const context = nativeRuntimeContextFixture();
      context.instructions.bundle.rootPath = instructionRoot;
      context.skills = ["configured", "provider-mentioned"].map(name => ({
        key: `company/test/${name}`, runtimeName: name, versionId: null,
        bundle: { ...context.instructions.bundle },
      }));
      return { ...context, aggregateDigest: canonicalNativeRuntimeContextDigest(context) };
    });
    expect(await selectHeartbeatRuntime(db, input)).toMatchObject({
      selected: true, nativeExecution: { task: { description: "Configured GitHub instruction skills:\n/configured" } },
    });
    expect((await read(run.id)).runnerProfileJson).toMatchObject({
      nativeExecutionInput: { task: { description: "Configured GitHub instruction skills:\n/configured" } },
    });
  });

  it("does not upgrade an older preparation from supplied runtime profile data", async () => {
    const { input, run } = await fixture();
    const selected = await selectHeartbeatRuntime(db, input);
    if (!selected.selected || !selected.nativeExecution || input.nativeRuntimeResolution.kind !== "native") {
      throw new Error("Expected native selection");
    }
    const saved = await read(run.id);
    const olderProfile = { ...saved.runnerProfileJson };
    delete olderProfile.nativePreparationFencingVersion;
    await db.update(heartbeatRuns).set({ runnerProfileJson: olderProfile }).where(eq(heartbeatRuns.id, run.id));
    input.run = await read(run.id);
    input.session.persistedNativeExecutionInput = selected.nativeExecution;
    input.session.persistedRunnerProfile = { ...olderProfile, nativePreparationFencingVersion: 1 };
    Object.assign(input.nativeRuntimeResolution.profile, { nativePreparationFencingVersion: 1 });
    expect((await selectHeartbeatRuntime(db, input)).selected).toBe(true);
    expect((await read(run.id)).runnerProfileJson).not.toHaveProperty("nativePreparationFencingVersion");
  });

  it("restores the immutable admitted input and saved checkpoint when newer context arrives", async () => {
    const { input, run } = await fixture();
    const selected = await selectHeartbeatRuntime(db, input);
    if (!selected.selected || !selected.nativeExecution) throw new Error("Expected native selection");
    const saved = await read(run.id);
    const profile = { ...saved.runnerProfileJson, sessionCheckpoint: { retained: "checkpoint" } };
    await db.update(heartbeatRuns).set({ runnerProfileJson: profile }).where(eq(heartbeatRuns.id, run.id));
    input.run = await read(run.id);
    input.session.persistedRunnerProfile = profile;
    input.session.persistedNativeExecutionInput = selected.nativeExecution;
    input.task.context.paperclipTaskMarkdown = "A newer unrelated request";
    input.task.safeWakeComments = [{ id: randomUUID(), body: "New direction belongs to a separate wake" }];
    vi.mocked(buildNativeRuntimeContext).mockClear();
    const resumed = await selectHeartbeatRuntime(db, input);
    expect(resumed).toMatchObject({ selected: true, nativeExecution: selected.nativeExecution, nativeRunnerInstanceId: selected.nativeRunnerInstanceId });
    expect((await read(run.id)).runnerProfileJson).toMatchObject(profile);
    expect(await db.select().from(completionContracts)).toHaveLength(1);
    expect(await coordinators(run.id)).toHaveLength(1);
    expect(buildNativeRuntimeContext).not.toHaveBeenCalled();
  });

  it("rejects an admitted input bound to another run without replacing the saved runtime", async () => {
    const { input, run } = await fixture();
    const selected = await selectHeartbeatRuntime(db, input);
    if (!selected.selected || !selected.nativeExecution) throw new Error("Expected native selection");
    const saved = await read(run.id);
    input.run = saved;
    input.session.persistedNativeExecutionInput = { ...selected.nativeExecution, binding: { ...selected.nativeExecution.binding, runId: randomUUID() } };
    await expect(selectHeartbeatRuntime(db, input)).rejects.toThrow("native_execution_input_persisted_binding_mismatch");
    expect((await read(run.id)).runnerProfileJson).toEqual(saved.runnerProfileJson);
  });

  it("rejects resume after skill access revocation without rewriting the admitted revision", async () => {
    const { input, run } = await fixture();
    const key = "company/test/private-skill", versionId = randomUUID();
    await db.update(heartbeatRuns).set({ contextSnapshot: { skillVersions: { [key]: versionId } } }).where(eq(heartbeatRuns.id, run.id));
    input.run = await read(run.id);
    vi.mocked(buildNativeRuntimeContext).mockImplementationOnce(async () => {
      const context = nativeRuntimeContextFixture();
      context.instructions.bundle.rootPath = instructionRoot;
      context.skills = [{ key, runtimeName: "private-skill", versionId, bundle: { ...context.instructions.bundle } }];
      return { ...context, aggregateDigest: canonicalNativeRuntimeContextDigest(context) };
    });
    const selected = await selectHeartbeatRuntime(db, input);
    if (!selected.selected || !selected.nativeExecution) throw new Error("Expected native selection");
    const saved = await read(run.id);
    input.run = saved;
    input.session.persistedNativeExecutionInput = selected.nativeExecution;
    input.config.runtimeSkillEntries = [];
    await expect(selectHeartbeatRuntime(db, input)).rejects.toThrow("Project skill access changed");
    expect((await read(run.id)).runnerProfileJson).toEqual(saved.runnerProfileJson);
    expect((await read(run.id)).contextSnapshot?.skillVersions).toEqual({ [key]: versionId });
  });

  it.each(["cancelled", "startup_cancellation"])("does not create a native coordinator when %s wins preparation", async winner => {
    const { input, run } = await fixture();
    input.beforeNativeRuntimeSelection = async () => {
      await db.update(heartbeatRuns).set(winner === "cancelled" ? { status: "cancelled" } : { resultJson: { startupCancellation: { beforeNativeSelection: true } } }).where(eq(heartbeatRuns.id, run.id));
    };
    expect(await selectHeartbeatRuntime(db, input)).toEqual({ selected: false });
    expect(await read(run.id)).toMatchObject({ runtimeMode: "legacy", nativeSessionId: null, completionContractId: null });
    expect(await coordinators(run.id)).toHaveLength(0);
    expect(input.stopControllerLease).not.toHaveBeenCalled();
    expect(prepareNativeWorkspaceSync).not.toHaveBeenCalled();
  });

  it("reports a lost controller lease before returning without native selection", async () => {
    const { input, run } = await fixture();
    await db.update(heartbeatRuns).set({ controllerBootId: randomUUID(), controllerLeaseExpiresAt: new Date(Date.now() + 60_000) }).where(eq(heartbeatRuns.id, run.id));
    expect(await selectHeartbeatRuntime(db, input)).toEqual({ selected: false });
    expect(input.onNativeOwnershipHeld).toHaveBeenCalledOnce();
    expect(input.stopControllerLease).not.toHaveBeenCalled();
    expect(await coordinators(run.id)).toHaveLength(0);
  });

  it("rejects a competing persisted legacy selection atomically", async () => {
    const { input, run } = await fixture();
    input.beforeNativeRuntimeSelection = async () => {
      await db.update(heartbeatRuns).set({ runtimeModeResolvedAt: new Date(), runtimeMode: "legacy" }).where(eq(heartbeatRuns.id, run.id));
    };
    await expect(selectHeartbeatRuntime(db, input)).rejects.toThrow("native_runtime_mode_conflict");
    expect((await read(run.id)).runtimeMode).toBe("legacy");
    expect(await coordinators(run.id)).toHaveLength(0);
    expect(input.stopControllerLease).not.toHaveBeenCalled();
  });

  it("reports sandbox teardown policy even when a later preparation step throws", async () => {
    const { input, run } = await fixture();
    input.workspace.executionTarget = sandbox;
    input.beforeNativeRuntimeSelection = async () => { throw new Error("selection interrupted"); };
    await expect(selectHeartbeatRuntime(db, input)).rejects.toThrow("selection interrupted");
    expect(input.onNativeLifecycleSelected).toHaveBeenCalledWith({ provider: "codex", harness: "codex_app_server", lifecycleMode: "per_turn", sandboxResource: "destroy_after_turn" });
    expect(input.onProviderResourceDisposition).toHaveBeenCalledWith("destroy");
    expect(input.stopControllerLease).not.toHaveBeenCalled();
    expect(await coordinators(run.id)).toHaveLength(0);
  });

  it("retains native admission and teardown state if workspace sync preparation fails", async () => {
    const { input, run } = await fixture();
    input.workspace.executionTarget = sandbox;
    vi.mocked(prepareNativeWorkspaceSync).mockRejectedValueOnce(new Error("sync preparation failed"));
    await expect(selectHeartbeatRuntime(db, input)).rejects.toThrow("sync preparation failed");
    expect(input.onProviderResourceDisposition).toHaveBeenCalledWith("destroy");
    expect(input.stopControllerLease).toHaveBeenCalledOnce();
    expect((await read(run.id)).runtimeMode).toBe("native");
    expect(await coordinators(run.id)).toHaveLength(1);
  });

  it("rejects a warm native sandbox that cannot reuse its lease", async () => {
    const { input, run } = await fixture();
    input.workspace.executionTarget = { ...sandbox, runnerLifecyclePolicy: { mode: "warm", idleTimeoutMs: 300_000 } };
    await expect(selectHeartbeatRuntime(db, input)).rejects.toThrow("runner_warm_environment_requires_reusable_lease");
    expect(input.onNativeLifecycleSelected).not.toHaveBeenCalled();
    expect(await coordinators(run.id)).toHaveLength(0);
  });

  it.each([
    { provider: "github" as const, method: "api_key" as const, expected: "warm" },
    { provider: "github" as const, method: "subscription" as const, expected: "per_turn" },
    { provider: "openai" as const, method: "api_key" as const, expected: "per_turn" },
  ])("persists $expected Copilot lifecycle for a managed $provider/$method account", async ({ provider, method, expected }) => {
    const { input, run, issue } = await fixture();
    const adapterConfig = { provider: "acpx", acpxAgent: "copilot", model: "gpt-5.6-luna", lifecycleMode: "warm", idleTimeoutMs: 300_000 };
    input.agent = { ...input.agent, adapterConfig };
    await db.update(agents).set({ adapterConfig }).where(eq(agents.id, input.agent.id));
    input.nativeRuntimeResolution = resolveHeartbeatNativeRuntimeMode({
      persisted: input.run, enabled: true, runtimeConfig: {}, adapterConfig,
      agent: input.agent, issue, target: null, workspaceId: null,
    });
    const attribution = { connectionId: randomUUID(), grantId: randomUUID(), provider, method, mode: "responsible_user" as const, responsibleUserId: "task-owner" };
    input.config.managedAiRuntime = {
      sessionIdentity: "fixture-grant:task-owner:epoch-1",
      assertCurrent: async () => {},
      config: { env: {}, managedAiConnection: { ...attribution, identity: "fixture-grant:task-owner:generation-1", sessionIdentity: "fixture-grant:task-owner:epoch-1" } },
      attribution,
      accountName: "Saved account",
      accountOwnerUserId: "task-owner",
      identity: "fixture-grant:task-owner:generation-1",
      home: instructionRoot,
      cleanup: async () => {},
    };
    const selected = await selectHeartbeatRuntime(db, input);
    if (!selected.selected || !selected.nativeExecution) throw new Error("Expected native Copilot selection");
    expect(selected.nativeExecution.session.lifecyclePolicy.mode).toBe(expected);
    expect((await read(run.id)).runnerProfileJson).toMatchObject({
      nativeExecutionInput: { session: { lifecyclePolicy: { mode: expected } } },
    });
    expect(await coordinators(run.id)).toHaveLength(1);
  });

  it("preserves only server-owned admission and dispatch evidence when recording legacy selection", async () => {
    const { input, run } = await fixture("process");
    const admission = { version: 1, kind: "fixture" }, dispatch = { entered: true };
    await db.update(heartbeatRuns).set({ runnerProfileJson: { [CHAT_CONTROL_RECOVERY_ADMISSION_KEY]: admission, adapterDispatch: dispatch, unrelated: "drop" } }).where(eq(heartbeatRuns.id, run.id));
    input.trace = { providerTraceRequested: true, providerTraceCapture: { metadata: { id: "trace-id" } } };
    expect(await selectHeartbeatRuntime(db, input)).toMatchObject({ selected: true, nativeExecution: null, nativeWorkspaceSync: null });
    expect((await read(run.id)).runnerProfileJson).toEqual({ [CHAT_CONTROL_RECOVERY_ADMISSION_KEY]: admission, adapterDispatch: dispatch, providerTrace: { mode: "raw", traceId: "trace-id", maxBytes: 64 * 1024 * 1024 } });
    expect(await coordinators(run.id)).toHaveLength(0);
    expect(input.stopControllerLease).not.toHaveBeenCalled();
    expect(buildNativeRuntimeContext).not.toHaveBeenCalled();
  });
});
