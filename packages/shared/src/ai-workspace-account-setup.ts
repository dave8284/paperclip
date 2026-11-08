import { z } from "zod";
import type { Company } from "./types/company.js";

export const finishAiWorkspaceAccountSetupSchema = z.object({
  companyId: z.string().uuid(),
  connectionId: z.string().uuid(),
  grantId: z.string().uuid(),
}).strict();
export type FinishAiWorkspaceAccountSetup = z.infer<typeof finishAiWorkspaceAccountSetupSchema>;
export type AiWorkspaceAccountSetupRetry =
  | ({ kind: "connection" } & FinishAiWorkspaceAccountSetup)
  | { kind: "account"; accountId: string }
  | { kind: "company"; companyId: string };
export interface AiWorkspaceAccountSetupResult {
  status: "ready" | "pending" | "not_applicable";
  accountId: string | null;
  installedCompanyIds: string[];
  pending: Array<{
    companyId: string | null;
    reason: "busy" | "access_changed" | "unavailable" | "setup_failed";
    message: string;
  }>;
  retry: AiWorkspaceAccountSetupRetry | null;
}
export interface SavedAiConnection {
  connectionId: string;
  grantId: string;
  aiAccountSetup?: AiWorkspaceAccountSetupResult;
}
export type CreatedCompany = Company & { aiAccountSetup?: AiWorkspaceAccountSetupResult };
