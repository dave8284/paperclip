import { z } from "zod";

export const fridayDiagnosticsQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();
export type FridayDiagnosticsQuery = z.infer<typeof fridayDiagnosticsQuerySchema>;

export interface FridayDiagnosticRecord {
  id: string;
  title: string;
  status: string;
  sourcePath: string;
  errorCode?: string;
  kind?: "task" | "conversation";
}
export interface FridayDiagnosticCheck {
  id: "blocked_tasks" | "failed_runs" | "local_voice" | "local_triage" | "server_readiness" | "connections";
  status: "checked" | "unknown";
  result: "clear" | "attention" | "unknown";
  summary: string;
  nextStep: string;
  sourcePath: string;
  records?: FridayDiagnosticRecord[];
  nextOffset?: number | null;
  localTriageStatus?: "disabled" | "setup_required" | "cold" | "warming" | "ready" | "busy" | "unavailable";
}
export interface FridayDiagnostics {
  version: 1;
  companyId: string;
  projectId: string | null;
  observedAt: string;
  scope: "authorized_current_company";
  checks: FridayDiagnosticCheck[];
  limits: string[];
}
