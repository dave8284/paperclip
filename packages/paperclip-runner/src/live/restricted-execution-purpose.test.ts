import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createCapabilityRunnerdCodexTransport, type CapabilityRunnerdCodexTransportOptions } from "./runnerd-codex-transport.js";
import { sameRestrictedExecutionPurpose } from "./restricted-execution-purpose.js";

const purpose = { kind: "skill_test" as const, testRunId: "00000000-0000-4000-8000-000000000001",
  skillId: "00000000-0000-4000-8000-000000000002", skillVersionId: "00000000-0000-4000-8000-000000000003",
  inputSha256: "a".repeat(64), skillSha256: "b".repeat(64) };

it("retains exact purpose authority independently of JSONB key order", () => {
  expect(sameRestrictedExecutionPurpose(purpose, Object.fromEntries(Object.entries(purpose).reverse()))).toBe(true);
  expect(sameRestrictedExecutionPurpose(purpose, { ...purpose, inputSha256: "c".repeat(64) })).toBe(false);
  expect(sameRestrictedExecutionPurpose(purpose, { ...purpose, extra: "authority" })).toBe(false);
  expect(sameRestrictedExecutionPurpose(purpose, undefined)).toBe(false);
});

it("rejects metered credentials and removes configured task secrets before provider preparation", async () => {
  expect(() => createCapabilityRunnerdCodexTransport({ executionPurpose: purpose,
    prepareLaunch: async () => { throw new Error("must not delegate credential preparation"); },
  })).toThrow("environment_owned_launch_unsupported");
  for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "PAPERCLIP_AI_PROVIDER_KEY"]) {
    expect(() => createCapabilityRunnerdCodexTransport({ executionPurpose: purpose,
      environment: { [key]: "synthetic-paid-key" } })).toThrow("subscription_auth_required");
  }
  const directory = await mkdtemp(join(tmpdir(), "skill-test-transport-"));
  const original = { PAPERCLIP_CONFIGURED_ENV_KEYS: '["COMPANY_SECRET"]', COMPANY_SECRET: "synthetic-private-data",
    PAPERCLIP_AGENT_PRIVATE_KEY: "synthetic-agent-key", PAPERCLIP_RUNNER_NETWORK_ACCESS: "enabled", CODEX_HOME: "/bound/subscription/home" };
  const options: CapabilityRunnerdCodexTransportOptions = { stateDirectory: directory, executionPurpose: purpose,
    expectedCodexIdentity: { cliVersion: "0.160.0", model: "selected-model" }, environment: original };
  const bundle = createCapabilityRunnerdCodexTransport(options);
  try {
    expect(options.environment).toEqual({ PAPERCLIP_CONFIGURED_ENV_KEYS: "[]", PAPERCLIP_RUNNER_NETWORK_ACCESS: "disabled", CODEX_HOME: "/bound/subscription/home" });
    expect(original.COMPANY_SECRET).toBe("synthetic-private-data");
  } finally {
    await bundle.transport.close();
    await rm(directory, { recursive: true, force: true });
  }
});
