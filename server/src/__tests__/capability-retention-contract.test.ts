import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Db } from "@paperclipai/db";
import { assertSkillCapabilityRetention, assertSkillTestCapabilityRetention } from "../services/company-skills.js";

describe("native skill deletion retains capability evidence", () => {
  function database(source: boolean, adopted: boolean) {
    const calls: Array<{ text: string; params: unknown[] }> = [];
    const db = drizzle(async (text, params) => { calls.push({ text, params }); return { rows: (text.includes('from "agentos_capability_releases"') ? source : adopted) ? [["receipt"]] : [] }; }) as unknown as Db;
    return { db, calls };
  }
  it("returns an explicit conflict for published source and adopted history, scoped to the native company and skill", async () => {
    for (const [source, adopted] of [[true, false], [false, true]]) {
      const { db, calls } = database(source, adopted);
      await expect(assertSkillCapabilityRetention(db, "company", "skill")).rejects.toMatchObject({ status: 409, details: { code: "capability_skill_history_retained" } });
      expect(calls.every(call => call.params.includes("company") && call.params.includes("skill"))).toBe(true);
    }
    await expect(assertSkillCapabilityRetention(database(false, false).db, "company", "skill")).resolves.toBeUndefined();
  });
  it("blocks soft deletion of the exact retained evaluation, leaving unrelated tests deletable", async () => {
    const { db, calls } = database(true, false);
    await expect(assertSkillTestCapabilityRetention(db, "company", "test")).rejects.toMatchObject({ status: 409, details: { code: "capability_test_evidence_retained" } });
    expect(calls[0].params).toEqual(expect.arrayContaining(["company", "test"]));
    expect(calls[0].text).toContain('"source_test_run_id"');
    await expect(assertSkillTestCapabilityRetention(database(false, false).db, "company", "other")).resolves.toBeUndefined();
  });
});
