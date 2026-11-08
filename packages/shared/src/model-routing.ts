import { z } from "zod";

export const modelRoutingLimitsSchema = z.object({
  canaryPercent: z.number().int().min(1).max(10), maximumPending: z.number().int().min(1).max(100),
  minimumObservations: z.number().int().min(5).max(100), observationTimeoutMs: z.number().int().min(60_000).max(604_800_000),
  qualityLowerBound: z.number().min(.7).max(1), maximumMedianIterations: z.number().int().min(1).max(2),
  minimumLatencyImprovement: z.number().min(.15).lt(1),
}).strict();
export const configureModelRoutingSchema = z.object({
  requestKey: z.string().uuid(), taskType: z.string().trim().min(1).max(300), expectedRevision: z.number().int().nonnegative(),
  mode: z.enum(["automatic", "off", "pinned"]), pinnedReleaseId: z.string().min(1).max(300).nullable(),
  limits: modelRoutingLimitsSchema, reason: z.string().trim().min(10).max(300),
}).strict();
export const rollbackModelRoutingSchema = z.object({
  requestKey: z.string().uuid(), releaseId: z.string().min(1).max(300), reason: z.string().trim().min(10).max(300),
}).strict();
export type ConfigureModelRouting = z.infer<typeof configureModelRoutingSchema>;
export type RollbackModelRouting = z.infer<typeof rollbackModelRoutingSchema>;
export type ModelRoutingLimits = z.infer<typeof modelRoutingLimitsSchema>;
export const DEFAULT_MODEL_ROUTING_LIMITS: ModelRoutingLimits = Object.freeze({ canaryPercent: 5, maximumPending: 2,
  minimumObservations: 10, observationTimeoutMs: 86_400_000, qualityLowerBound: .7, maximumMedianIterations: 2, minimumLatencyImprovement: .15 });
export interface ModelRoutingDiscovery {
  enabled: boolean;
  families: Array<{
    id: string; name: string;
    policy: { revision: number; mode: "automatic" | "off" | "pinned"; pinnedReleaseId: string | null; limits: ModelRoutingLimits; authorityCurrent: boolean } | null;
    releases: Array<{ id: string; version: number; state: "canary" | "adopted" | "rolled_back"; baselineModel: string; candidateModel: string; createdAt: string }>;
    events: Array<{ id: string; releaseId: string | null; action: string; reason: string; createdAt: string }>;
  }>;
}
