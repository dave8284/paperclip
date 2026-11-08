import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalNativeRuntimeContextDigest, NATIVE_RUNTIME_ASSET_SCHEMA } from "../contracts/runtime-context.js";
import { createRunnerProviderLaunch, preparedRunnerLaunchWorkingDirectory, runnerLaunchRequirementsDigest, validatePreparedRunnerLaunch,
  type RunnerProviderLaunchEnvironment, type RunnerProviderLaunchRequirements } from "./runner-provider-launch.js";

const requirements: RunnerProviderLaunchRequirements = {
  schema: "paperclip.runner.launch-requirements.v1",
  identity: { runnerInstanceId: "runner", environmentLeaseId: "lease", runId: "run",
    normalizedSessionId: "session", turnId: "turn", itemId: "item" },
  provider: "codex", model: "selected-model", approvalPolicy: "on-request",
  instructions: "Follow the assigned instructions.", runtimeContext: null,
  readOnly: true, preparedConversation: false, includeCollaborationModeInstructions: false,
  settings: {},
};
const environment: RunnerProviderLaunchEnvironment = {
  options: { codexArgs: ["app-server"] }, root: "/execution/state", cwd: "/execution/workspace",
  codexHome: "/execution/home/.codex", providerNodeCommand: "/runtime/node",
  codexCommand: "/runtime/codex", opencodeProxyPath: "/runtime/opencode-proxy.cjs",
  acpxSidecarPath: "/runtime/acpx-sidecar.cjs",
};

describe("built-in provider launch preparation", () => {
  it("keeps a skill test distinct from a review and pins its receipt through prepared recovery", () => {
    const purpose = { kind: "skill_test" as const, testRunId: "00000000-0000-4000-8000-000000000001",
      skillId: "00000000-0000-4000-8000-000000000002", skillVersionId: "00000000-0000-4000-8000-000000000003",
      inputSha256: "a".repeat(64), skillSha256: "b".repeat(64) };
    const asset = { schema: NATIVE_RUNTIME_ASSET_SCHEMA, rootPath: "/test/bundle", digest: "a".repeat(64),
      manifestDigest: "b".repeat(64), fileCount: 1, totalBytes: 20 };
    const context = { prompt: { revision: "test", text: "Only this test", digest: createHash("sha256").update("Only this test").digest("hex") },
      instructions: { entryPath: "AGENTS.md", bundle: asset },
      skills: [{ key: "tested", runtimeName: "tested-skill", versionId: purpose.skillVersionId, bundle: asset }],
      mcp: { assignmentSetId: "none", digest: "0".repeat(64), bindingId: null } };
    const selected = { ...requirements, approvalPolicy: "never" as const, executionPurpose: purpose,
      expectedCodexIdentity: { cliVersion: "0.160.0", model: requirements.model! },
      runtimeContext: { ...context, aggregateDigest: canonicalNativeRuntimeContextDigest(context) } };
    const provider = createRunnerProviderLaunch(selected, environment);
    const prepared = { configurationId: "test", requirementsDigest: runnerLaunchRequirementsDigest(selected), provider };
    expect(provider).toMatchObject({ executionPurpose: purpose, expectedCodexIdentity: selected.expectedCodexIdentity, conversationMode: "skill_test", readOnly: true,
      includeSkillInstructions: false, collaborationMode: "default", approvalPolicy: "never" });
    expect(() => validatePreparedRunnerLaunch(selected, prepared)).not.toThrow();
    expect(() => validatePreparedRunnerLaunch(selected, { ...prepared, provider: { ...provider,
      executionPurpose: Object.fromEntries(Object.entries(purpose).reverse()),
    } })).not.toThrow();
    for (const executionPurpose of [undefined, { ...purpose, inputSha256: "c".repeat(64) }, { ...purpose, skillVersionId: purpose.skillId }]) {
      expect(() => validatePreparedRunnerLaunch(selected, { ...prepared, provider: { ...provider, executionPurpose } })).toThrow("requirements_mismatch");
    }
    expect(() => createRunnerProviderLaunch(selected, { ...environment, options: { externallySandboxed: true } })).toThrow();
    for (const runtimeContext of [null, { ...selected.runtimeContext, skills: [] },
      { ...selected.runtimeContext, skills: [...context.skills, ...context.skills] },
      { ...selected.runtimeContext, mcp: { ...context.mcp, bindingId: "foreign" } },
      { ...selected.runtimeContext, connectionInstructions: { text: "private", digest: "0".repeat(64) } }]) {
      expect(() => createRunnerProviderLaunch({ ...selected, runtimeContext }, environment)).toThrow("restricted_execution_context_invalid");
    }
  });
  it("pins frozen review scope through preparation and rejects changed source authority", () => {
    const purpose = { kind: "egm_packet_review" as const, packetSha256: "a".repeat(64),
      sourceDigests: ["packet", "target", "persona", "standard"].map(id => ({ id, sha256: "b".repeat(64) })) };
    const selected = { ...requirements, approvalPolicy: "never" as const, executionPurpose: purpose };
    const provider = createRunnerProviderLaunch(selected, environment);
    const prepared = { configurationId: "review", requirementsDigest: runnerLaunchRequirementsDigest(selected), provider };
    expect(provider).toMatchObject({ executionPurpose: purpose, readOnly: true, includeSkillInstructions: false, collaborationMode: "default", conversationMode: "egm_packet_review" });
    expect(() => validatePreparedRunnerLaunch(selected, prepared)).not.toThrow();
    const changed = { ...purpose, packetSha256: "c".repeat(64) };
    expect(runnerLaunchRequirementsDigest({ ...selected, executionPurpose: changed })).not.toBe(prepared.requirementsDigest);
    for (const executionPurpose of [undefined, changed]) {
      expect(() => validatePreparedRunnerLaunch(selected, { ...prepared, provider: { ...provider, executionPurpose } })).toThrow("requirements_mismatch");
    }
    expect(() => createRunnerProviderLaunch({ ...selected, readOnly: false }, environment)).toThrow();
    expect(() => createRunnerProviderLaunch({ ...selected, approvalPolicy: "on-request" }, environment)).toThrow();
    expect(() => createRunnerProviderLaunch(selected, { ...environment, options: { homeMode: "preconfigured" } })).toThrow();
  });
  it("keeps Core's selection and policy when the execution environment changes", () => {
    const before = structuredClone(requirements);
    const local = createRunnerProviderLaunch(requirements, environment);
    const remote = createRunnerProviderLaunch(requirements, { ...environment,
      cwd: "/guest/project", codexCommand: "/guest/bin/codex" });
    expect(local).toMatchObject({ model: "selected-model", approvalPolicy: "on-request",
      readOnly: true, collaborationMode: "plan", instructions: requirements.instructions });
    expect(remote).toEqual({ ...local, cwd: "/guest/project", command: "/guest/bin/codex" });
    expect(requirements).toEqual(before);
  });

  it("preserves the ACPX profile, run identity, and permission policy", () => {
    const launch = createRunnerProviderLaunch({ ...requirements, provider: "acpx",
      model: "claude-selected", settings: { acpxAgent: "claude", acpxPermissionMode: "deny-all" } }, environment);
    expect(launch).toMatchObject({ kind: "acpx", agent: "claude", model: "claude-selected",
      sidecarCommand: "/runtime/node", sidecarArgs: ["/runtime/acpx-sidecar.cjs"],
      runId: "run", normalizedSessionId: "session", permissionMode: "deny-all",
      permissionModePinned: true, providerPolicy: { readOnly: true },
      instructions: requirements.instructions });
    expect(launch.commandDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("keeps the OpenCode facade shape and prepared conversation mode", () => {
    expect(createRunnerProviderLaunch({ ...requirements, provider: "opencode", preparedConversation: true }, environment))
      .toMatchObject({ kind: "opencode", driver: "opencode_server", command: "/runtime/node",
        args: ["/runtime/opencode-proxy.cjs"], conversationMode: "prepared", collaborationMode: "plan" });
    expect(createRunnerProviderLaunch({ ...requirements, provider: "opencode" }, environment))
      .not.toHaveProperty("readOnly");
  });

  it("uses the existing permission builder when the environment supplies no argument override", () => {
    const launch = createRunnerProviderLaunch(requirements, { ...environment,
      options: { environment: { HOME: "/execution/home" } } });
    expect(launch.args).toEqual(expect.arrayContaining(["app-server"]));
    expect(JSON.stringify(launch.args)).toContain("paperclip-runner-workspace-read-only");
  });

  it("rejects missing managed profiles before provider launch", () => {
    expect(() => createRunnerProviderLaunch({ ...requirements, provider: "claude_managed" }, environment))
      .toThrow("requires a qualified managed profile");
    expect(() => createRunnerProviderLaunch({ ...requirements, provider: "aws_agentcore" }, environment))
      .toThrow("requires a qualified AgentCore profile");
  });

  it.each(["codex", "opencode", "acpx"] as const)("accepts only a normalized absolute %s prepared cwd", provider => {
    const selected = provider === "acpx"
      ? { ...requirements, provider, model: "claude-selected", settings: { acpxAgent: "claude" as const } }
      : { ...requirements, provider };
    const prepared = (cwd: unknown) => ({ configurationId: "prepared", requirementsDigest: runnerLaunchRequirementsDigest(selected),
      provider: { ...createRunnerProviderLaunch(selected, environment), cwd } });
    for (const cwd of ["/home/agent", "/projects/repository/worktrees/workspace"]) {
      expect(() => validatePreparedRunnerLaunch(selected, prepared(cwd))).not.toThrow();
      expect(preparedRunnerLaunchWorkingDirectory(prepared(cwd))).toBe(cwd);
    }
    for (const cwd of [undefined, "", "home/agent", "/", "/home/agent/../root", "/home/\0agent"]) {
      expect(() => validatePreparedRunnerLaunch(selected, prepared(cwd)))
        .toThrow("runner_prepared_launch_working_directory_invalid");
    }
  });
});

it("binds qualified Codex identity to preparation and rejects provider or model substitutions", () => {
  const expectedCodexIdentity = { cliVersion: "0.160.0", model: "selected-model" };
  const selected = { ...requirements, readOnly: false, expectedCodexIdentity };
  const provider = createRunnerProviderLaunch(selected, environment);
  const prepared = { configurationId: "qualified", requirementsDigest: runnerLaunchRequirementsDigest(selected), provider };
  expect(provider).toMatchObject({ expectedCodexIdentity, conversationMode: "qualified_codex" });
  expect(() => validatePreparedRunnerLaunch(selected, prepared)).not.toThrow();
  for (const changed of [undefined, { ...expectedCodexIdentity, cliVersion: "0.161.0" }, { ...expectedCodexIdentity, model: "other" }]) {
    expect(() => validatePreparedRunnerLaunch(selected, { ...prepared, provider: { ...provider, expectedCodexIdentity: changed } })).toThrow("requirements_mismatch");
    expect(runnerLaunchRequirementsDigest({ ...selected, expectedCodexIdentity: changed })).not.toBe(prepared.requirementsDigest);
  }
  expect(() => validatePreparedRunnerLaunch(selected, { ...prepared, provider: { ...provider, conversationMode: "prepared" } })).toThrow("requirements_mismatch");
  expect(() => createRunnerProviderLaunch({ ...selected, model: "other" }, environment)).toThrow();
  expect(() => createRunnerProviderLaunch(selected, { ...environment, options: { homeMode: "preconfigured" } })).toThrow();
});
