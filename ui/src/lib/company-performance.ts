import type { CompanyPerformanceReport, CompanyPerformanceResponse, PerformanceValues } from "@paperclipai/shared";

/** Do not render partial/older responses as authoritative reporting coverage. */
export function readPerformanceResponse(value: unknown): CompanyPerformanceResponse {
  const response = value as Partial<CompanyPerformanceResponse> | null;
  if (!response || !Array.isArray(response.reports) || !Array.isArray(response.scopeProjectIds)
    || typeof response.truncated !== "boolean"
    || response.scopeProjectIds.some(id => id !== null && typeof id !== "string")
    || response.reports.some(row => !row || !row.values
      || typeof row.id !== "string" || typeof row.period !== "string"
      || !Number.isInteger(row.revision) || row.revision < 1
      || !response.scopeProjectIds!.includes(row.projectId)
      || typeof row.sourceLabel !== "string" || typeof row.evidenceRef !== "string"
      || (row.currency !== null && typeof row.currency !== "string")
      || !["cash", "accrual"].includes(row.basis)
      || typeof row.revenueComplete !== "boolean" || typeof row.costsComplete !== "boolean"
      || ["revenueMinor", "costMinor", "views", "engagements", "publications"].some(key => {
        const measure = row.values[key as keyof PerformanceValues];
        return measure !== null && (!Number.isSafeInteger(measure) || measure < 0);
      }))) {
    throw new Error("Performance reports could not be read. Retry after the server has finished updating.");
  }
  return response as CompanyPerformanceResponse;
}
export function latestPerformance(reports: CompanyPerformanceReport[]) {
  const current = new Map<string, CompanyPerformanceReport>();
  for (const report of reports) {
    const key = `${report.projectId ?? "company"}:${report.period}`;
    if ((current.get(key)?.revision ?? 0) < report.revision) current.set(key, report);
  }
  return [...current.values()];
}
export function performanceSummary(reports: CompanyPerformanceReport[], expectedReports: number) {
  const completeScope = expectedReports > 0 && reports.length === expectedReports;
  const comparable = completeScope && new Set(reports.map(row => `${row.period}:${row.currency}:${row.basis}`)).size === 1;
  const sum = (key: keyof PerformanceValues, comparableRequired = false) => {
    if (!completeScope || (comparableRequired && !comparable) || reports.some(row => row.values[key] === null)) return null;
    const total = reports.reduce((value, row) => value + row.values[key]!, 0);
    return Number.isSafeInteger(total) ? total : null;
  };
  const revenue = sum("revenueMinor", true), costs = sum("costMinor", true);
  const profit = revenue !== null && costs !== null && reports.every(row => row.revenueComplete && row.costsComplete) ? revenue - costs : null;
  return { revenue, costs, profit, currency: comparable ? reports[0]?.currency : null, views: sum("views"), engagements: sum("engagements"), publications: sum("publications"), completeScope };
}
export function currencyScale(currency: string) { try { return 10 ** new Intl.NumberFormat(undefined, { style: "currency", currency }).resolvedOptions().maximumFractionDigits!; } catch { return 100; } }
export function formatPerformanceMoney(value: number | null, currency: string | null) {
  if (value === null || !currency) return "Not reported";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value / currencyScale(currency)); } catch { return `${value} minor units · ${currency}`; }
}
