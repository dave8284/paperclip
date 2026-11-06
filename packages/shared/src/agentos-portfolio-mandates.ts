import { z } from "zod";

export const savePortfolioReadMandateSchema = z.object({
  id: z.uuid(), expectedRevision: z.number().int().min(0),
  sourceCompanyId: z.uuid(), sourceAgentId: z.uuid(),
  targetCompanyIds: z.array(z.uuid()).min(1).max(50).refine(ids => new Set(ids).size === ids.length, "Select each company only once"),
  action: z.literal("portfolio_work:read"),
  readScope: z.literal("company_shared_only"),
  expiresAt: z.iso.datetime().nullable(),
}).strict();
export const revokePortfolioReadMandateSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const portfolioWorkQuerySchema = z.object({
  mandateId: z.uuid(), revision: z.coerce.number().int().positive(), targetCompanyId: z.uuid(),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  projectOffset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type SavePortfolioReadMandate = z.infer<typeof savePortfolioReadMandateSchema>;
export type PortfolioWorkQuery = z.infer<typeof portfolioWorkQuerySchema>;
export interface PortfolioReadMandate {
  id: string; portfolioId: string; revision: number; sourceCompanyId: string; sourceAgentId: string;
  sourceAgentName?: string | null;
  targetCompanyIds: string[]; action: "portfolio_work:read"; readScope: "company_shared_only";
  expiresAt: string | null; revokedAt: string | null; updatedAt: string;
}
export interface PortfolioWorkSummary {
  mandateId: string; revision: number; sourceCompanyId: string; targetCompanyId: string;
  readScope: "company_shared_only"; observedAt: string;
  projects: Array<{ id: string; name: string; status: string }>;
  projectCount: number; nextProjectOffset: number | null;
  tasks: Array<{ id: string; identifier: string | null; title: string; status: string; priority: string; projectId: string | null; updatedAt: string | Date }>;
  counts: Record<string, number>; nextOffset: number | null;
}
