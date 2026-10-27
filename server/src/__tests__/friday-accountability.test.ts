import { randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { expect, it, vi } from "vitest";
import { fridayAccountability } from "../services/friday-accountability.js";

const checks = vi.hoisted(() => ({ active: 0, peak: 0, total: 0 }));
vi.mock("../services/access.js", () => ({ accessService: () => ({
  decide: async () => {
    checks.active++; checks.total++; checks.peak = Math.max(checks.peak, checks.active);
    await new Promise(resolve => setTimeout(resolve, 0));
    checks.active--;
    return { allowed: true };
  },
}) }));

it("bounds authorization concurrency and explicitly reports a clipped large accountability page", async () => {
  const companyId = randomUUID();
  const people = Array.from({ length: 512 }, (_, index) => ({ id: randomUUID(), name: `Employee ${index}`, role: "general", title: null, status: "idle", reportsTo: null }));
  const query = { from: () => query, where: () => query, orderBy: async () => people };
  const db = { select: () => query } as unknown as Db;
  const result = await fridayAccountability(db, companyId, { type: "board", source: "local_implicit", isInstanceAdmin: true }, [], [...people.map(person => person.id), randomUUID()]);
  expect(result.people).toHaveLength(512);
  expect(result.reportingChainTruncated).toBe(true);
  expect(checks.total).toBe(512);
  expect(checks.peak).toBeLessThanOrEqual(16);
  expect(checks.peak).toBeGreaterThan(1);
  expect(checks.active).toBe(0);
});
