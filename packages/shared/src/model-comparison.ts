import { z } from "zod";

export const prepareModelComparisonSchema = z.object({
  requestKey: z.string().uuid(),
  comparisonId: z.string().trim().min(1).max(300),
  caseId: z.string().trim().min(1).max(300),
  arm: z.enum(["baseline", "candidate"]),
  issueId: z.string().uuid(),
}).strict();
export type PrepareModelComparison = z.infer<typeof prepareModelComparisonSchema>;

/** Only current native-authorized record choices leave the host. Raw case
 * source references, private task/check bodies and evidence hashes stay local. */
export interface ModelComparisonDiscovery {
  enabled: boolean;
  comparisons: Array<{
    id: string;
    dimension: "model" | "prompt" | "context";
    datasetId: string;
    datasetVersion: string;
    taskFamily: string;
    baseline: { model: string; reasoningEffort: string };
    candidate: { model: string; reasoningEffort: string };
    cases: Array<{
      id: string;
      split: "training" | "holdout";
      label: string;
      tasks: Array<{
        issueId: string;
        identifier: string | null;
        title: string;
        agentId: string;
        agentName: string;
        arms: Array<"baseline" | "candidate">;
      }>;
    }>;
  }>;
}

export interface PreparedModelComparisonResult {
  created: boolean;
  companyId: string;
  task: { id: string; identifier: string | null; title: string; status: string };
  assignment: { documentId: string; revisionId: string };
}
