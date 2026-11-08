import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Db } from "@paperclipai/db";
import type { RoutingPolicy } from "@agentos/model-intelligence";
import { configureModelRoutingSchema, DEFAULT_MODEL_ROUTING_LIMITS } from "@paperclipai/shared";
import { nativeModelRoutingAuthority } from "../services/model-routing-authority.js";
import { modelProfileDigest } from "../services/model-profile-binding.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const policy: RoutingPolicy = { namespace: companyId, id: "10000000-0000-4000-8000-000000000002", taskType: "operations.support", expectedRevision: 0,
  revision: 1, mode: "automatic", pinnedReleaseId: null, limits: DEFAULT_MODEL_ROUTING_LIMITS, reason: "Enroll the company", createdAt: new Date().toISOString() };
describe("native routing authority boundary", () => {
  it.each(["matching", "missing audit", "changed policy"])("requires the exact committed native policy receipt: %s", async state => {
    const calls: Array<{ text: string; params: unknown[] }> = [];
    const db = drizzle(async (text, params) => { calls.push({ text, params }); return { rows: state === "missing audit" ? []
      : [[{ policyFingerprint: state === "matching" ? modelProfileDigest(policy) : "other" }]] }; }) as unknown as Db;
    expect(await nativeModelRoutingAuthority(db, companyId, policy)).toBe(state === "matching");
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual(expect.arrayContaining([companyId, policy.id, "approved", "active", "instance_admin", "user", "model_routing.policy_configured", "model_routing_policy", policy.taskType]));
    for (const table of ['"user"', '"instance_user_roles"', '"company_memberships"']) expect(calls[0].text).toContain(table);
  });
  it.each([{ namespace: "foreign" }, { id: "not-a-native-receipt" }])("rejects an unbound policy before any database access", async change => {
    const db = drizzle(async () => { throw new Error("Unexpected query"); }) as unknown as Db;
    expect(await nativeModelRoutingAuthority(db, companyId, { ...policy, ...change })).toBe(false);
  });
  it("validates bounded policy inputs and refuses caller-supplied outcomes", () => {
    const input = { requestKey: policy.id, taskType: policy.taskType, expectedRevision: 0, mode: "automatic", pinnedReleaseId: null,
      limits: DEFAULT_MODEL_ROUTING_LIMITS, reason: "Enroll this task family" };
    expect(configureModelRoutingSchema.parse(input)).toEqual(input);
    expect(configureModelRoutingSchema.safeParse({ ...input, observedVariant: {} }).success).toBe(false);
    expect(configureModelRoutingSchema.safeParse({ ...input, limits: { ...input.limits, maximumPending: 0 } }).success).toBe(false);
    expect(configureModelRoutingSchema.safeParse({ ...input, limits: { ...input.limits, qualityLowerBound: .1 } }).success).toBe(false);
  });
});
