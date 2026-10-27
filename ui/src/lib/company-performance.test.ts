import { describe, expect, it } from "vitest";
import type { CompanyPerformanceReport } from "@paperclipai/shared";
import { createPerformanceReportSchema } from "@paperclipai/shared";
import { latestPerformance, performanceSummary } from "./company-performance";
const report = (id: string, extras: Partial<CompanyPerformanceReport> = {}): CompanyPerformanceReport => ({ id, companyId: "company", projectId: id, period: "2026-10", revision: 1, currency: "USD", basis: "cash", sourceLabel: "Ledger", evidenceRef: "Verified export in the source artefact", createdAt: "2026-10-27", createdBy: "owner", revenueComplete: true, costsComplete: true, values: { revenueMinor: 10000, costMinor: 4000, views: 300, engagements: 10, publications: 2 }, ...extras });
describe("performance coverage", () => {
  it("keeps immutable revisions but totals only the latest per scope/month", () => {
    const rows = latestPerformance([report("project"), report("new", { projectId: "project", revision: 2, values: { ...report("x").values, revenueMinor: 12000 } })]);
    expect(rows).toHaveLength(1); expect(performanceSummary(rows, 1).profit).toBe(8000);
  });
  it("withholds totals for missing projects and profit for partial costs or mixed currencies", () => {
    expect(performanceSummary([report("one")], 2).profit).toBeNull();
    expect(performanceSummary([report("one", { costsComplete: false })], 1).profit).toBeNull();
    expect(performanceSummary([report("one"), report("two", { currency: "NZD" })], 2).revenue).toBeNull();
    expect(performanceSummary([report("one"), report("two", { basis: "accrual" })], 2).profit).toBeNull();
    expect(performanceSummary([report("one", { values: { ...report("one").values, views: null } })], 1).views).toBeNull();
  });
  it("requires sources and currency and distinguishes unreported from zero", () => {
    const { id: _, companyId: __, revision: ___, createdAt: ____, createdBy: _____, ...fields } = report("one", { projectId: null });
    const input = { ...fields, expectedReportId: null };
    expect(createPerformanceReportSchema.safeParse(input).success).toBe(true);
    expect(createPerformanceReportSchema.safeParse({ ...input, currency: null }).success).toBe(false);
    expect(createPerformanceReportSchema.safeParse({ ...input, costsComplete: true, values: { ...input.values, costMinor: null } }).success).toBe(false);
    expect(performanceSummary([report("zero", { values: { ...input.values, revenueMinor: 0, costMinor: 0 } })], 1).profit).toBe(0);
  });
});
