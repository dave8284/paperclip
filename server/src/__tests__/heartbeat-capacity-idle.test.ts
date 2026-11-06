import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Db } from "@paperclipai/db";
import { heartbeatService } from "../services/heartbeat.js";

describe("capacity work stays out of the periodic idle queue sweep", () => {
  it("adds no capacity queries to repeated idle resumeQueuedRuns calls", async () => {
    const queries: string[] = [];
    const db = drizzle(async query => { queries.push(query); return { rows: [] }; }) as unknown as Db;
    const heartbeat = heartbeatService(db);
    await heartbeat.resumeQueuedRuns();
    await heartbeat.resumeQueuedRuns();
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.filter(query => query.includes("ai_execution_capacity"))).toEqual([]);
    await heartbeat.reconcileAiExecutionCapacity();
    expect(queries.filter(query => query.includes("ai_execution_capacity_claims"))).toHaveLength(1);
  });
});
