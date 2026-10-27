import { z } from "zod";
export const performancePeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a reporting month (YYYY-MM).");
const measure = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().default(null);
export const performanceValuesSchema = z.object({ revenueMinor: measure, costMinor: measure, views: measure, engagements: measure, publications: measure }).strict();
export const createPerformanceReportSchema = z.object({
  projectId: z.string().uuid().nullable().default(null), period: performancePeriodSchema,
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().default(null),
  basis: z.enum(["cash", "accrual"]).default("cash"),
  values: performanceValuesSchema,
  revenueComplete: z.boolean().default(false), costsComplete: z.boolean().default(false),
  sourceLabel: z.string().trim().min(1).max(120), evidenceRef: z.string().trim().min(10).max(1000),
  expectedReportId: z.string().uuid().nullable(),
}).strict().superRefine((value, ctx) => {
  if (Object.values(value.values).every(item => item === null)) ctx.addIssue({ code: "custom", path: ["values"], message: "Record at least one measured value." });
  if ((value.values.revenueMinor !== null || value.values.costMinor !== null) && !value.currency) ctx.addIssue({ code: "custom", path: ["currency"], message: "Financial amounts require a currency." });
  if ((value.revenueComplete && value.values.revenueMinor === null) || (value.costsComplete && value.values.costMinor === null)) ctx.addIssue({ code: "custom", path: ["values"], message: "Complete coverage requires a recorded amount." });
});
export type PerformanceValues = z.infer<typeof performanceValuesSchema>;
export type CreatePerformanceReport = z.infer<typeof createPerformanceReportSchema>;
export interface CompanyPerformanceReport extends Omit<CreatePerformanceReport, "expectedReportId"> {
  id: string; companyId: string; revision: number; createdAt: string | Date; createdBy: string;
}
export interface CompanyPerformanceResponse { reports: CompanyPerformanceReport[]; truncated: boolean }
