import { z } from "zod";
import type { ApplicationWork } from "./managed-applications.js";

export const fridayWorkQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  applicationId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  projectOffset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  status: z.enum(["active", "completed", "all"]).default("all"),
}).strict();
export type FridayWorkQuery = z.infer<typeof fridayWorkQuerySchema>;
export const fridayViewSchema = z.object({
  version: z.literal(1),
  panel: z.enum(["attention", "work", "workforce", "team", "chat", "activity", "routines", "artifacts"]),
  projectId: z.string().uuid().optional(),
  applicationId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  mode: z.enum(["graph", "kanban", "activity", "combined"]).optional(),
}).strict();
export type FridayView = z.infer<typeof fridayViewSchema>;
export type FridayTask = ApplicationWork["tasks"][number] & { parentId: string | null; createdByAgentId: string | null };
export interface FridayWork {
  observedAt: string;
  projects: Array<{ id: string; name: string; status: string; leadAgentId: string | null }>;
  projectCount: number;
  nextProjectOffset: number | null;
  applications: Array<{ id: string; name: string; kind: "application" | "platform"; projectIds: string[] }>;
  tasks: FridayTask[];
  counts: Record<string, number>;
  nextOffset: number | null;
  assignments: Array<{ agentId: string; projectId: string | null; status: string; count: number }>;
  assignmentsTruncated: boolean;
  evidence: Array<{ id: string; taskId: string; kind: "comment" | "artifact"; title: string; agentId: string | null; createdAt: Date }>;
  evidenceTruncated: boolean;
  handoffs: Array<{ id: string; taskId: string; fromAgentId: string | null; toAgentId: string | null; phase: string; state: string; createdAt: Date }>;
  handoffsTruncated: boolean;
}
