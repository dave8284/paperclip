import type { CompanyPerformanceReport, PerformanceValues } from "@paperclipai/shared";
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
