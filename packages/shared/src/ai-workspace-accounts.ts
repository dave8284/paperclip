import { z } from "zod";
import type { AiProvider } from "./ai-connections.js";

export const enrollAiWorkspaceAccountSchema = z.object({
  id: z.string().uuid(),
  sourceCompanyId: z.string().uuid(),
  sourceConnectionId: z.string().uuid(),
  sourceGrantId: z.string().uuid(),
  autoInstall: z.boolean(),
}).strict();
export type EnrollAiWorkspaceAccount = z.infer<typeof enrollAiWorkspaceAccountSchema>;

export const installAiWorkspaceAccountSchema = z.object({
  expectedRevision: z.number().int().positive(),
  expectedLinkRevision: z.number().int().positive().nullable(),
}).strict();
export type InstallAiWorkspaceAccount = z.infer<typeof installAiWorkspaceAccountSchema>;

export const updateAiWorkspaceAccountSchema = z.object({
  expectedRevision: z.number().int().positive(),
  enabled: z.boolean().optional(),
  autoInstall: z.boolean().optional(),
}).strict().refine(value => value.enabled !== undefined || value.autoInstall !== undefined,
  "Choose an account setting to change");
export type UpdateAiWorkspaceAccount = z.infer<typeof updateAiWorkspaceAccountSchema>;

export interface AiWorkspaceAccountLinkSummary {
  id: string; companyId: string; connectionId: string; grantId: string;
  revision: number; enabled: boolean;
}
export interface AiWorkspaceAccountSummary {
  id: string; ownerUserId: string; revision: number; enabled: boolean; autoInstall: boolean;
  available: boolean;
  sourceCompanyId: string; sourceConnectionId: string; sourceGrantId: string;
  name: string; provider: AiProvider; method: "subscription"; accountLabel?: string | null;
  links: AiWorkspaceAccountLinkSummary[];
}
