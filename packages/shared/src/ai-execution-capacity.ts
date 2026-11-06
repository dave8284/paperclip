import { z } from "zod";
import { AI_PROVIDERS } from "./ai-connections.js";

export const aiExecutionCapacityPolicySchema = z.object({
  name: z.string().trim().min(1).max(120),
  provider: z.enum(AI_PROVIDERS),
  maxConcurrent: z.number().int().min(1).max(32),
  interactiveReserved: z.number().int().min(0).max(31),
  interactivePriority: z.boolean(),
  waitWarningMs: z.number().int().min(1_000).max(86_400_000),
}).strict().refine(value => value.interactiveReserved < value.maxConcurrent, {
  message: "Keep at least one slot available for background work", path: ["interactiveReserved"],
});
export type AiExecutionCapacityPolicy = z.infer<typeof aiExecutionCapacityPolicySchema>;
export const aiExecutionCapacityBindingSchema = z.object({
  companyId: z.string().uuid(), connectionId: z.string().uuid(), grantId: z.string().uuid(),
}).strict();
export const saveAiExecutionCapacitySchema = z.object({
  id: z.string().uuid().optional(), expectedRevision: z.number().int().positive().optional(),
  policy: aiExecutionCapacityPolicySchema,
  bindings: z.array(aiExecutionCapacityBindingSchema).max(100),
}).strict().refine(value => Boolean(value.id) === Boolean(value.expectedRevision), {
  message: "An existing group requires its current revision", path: ["expectedRevision"],
});
export type SaveAiExecutionCapacity = z.infer<typeof saveAiExecutionCapacitySchema>;
export interface AiExecutionCapacityGroup extends AiExecutionCapacityPolicy {
  id: string; revision: number;
  bindings: Array<z.infer<typeof aiExecutionCapacityBindingSchema>>;
  active: number; waiting: number; overdue: number;
}
export interface AiExecutionCapacityOverview {
  groups: AiExecutionCapacityGroup[];
  connections: Array<z.infer<typeof aiExecutionCapacityBindingSchema> & {
    companyName: string; connectionName: string; provider: string; groupId: string | null;
  }>;
}
