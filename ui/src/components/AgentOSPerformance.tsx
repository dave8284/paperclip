import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CompanyPerformanceReport, CompanyPerformanceResponse, CreatePerformanceReport } from "@paperclipai/shared";
import { createPerformanceReportSchema } from "@paperclipai/shared";
import { api } from "@/api/client";
import { projectsApi } from "@/api/projects";
import { departmentsApi, departmentKey } from "@/api/departments";
import { queryKeys } from "@/lib/queryKeys";
import { latestPerformance, performanceSummary, formatPerformanceMoney, currencyScale } from "@/lib/company-performance";
import { Button } from "./ui/button";

export function AgentOSPerformance({ companyId, projectId, departmentId, onAsk }: { companyId: string; projectId?: string; departmentId?: string; onAsk: (message: string) => void }) {
  const [period, setPeriod] = useState(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; });
  const [department, setDepartment] = useState(departmentId ?? "");
  const [project, setProject] = useState(projectId ?? "");
  const [editing, setEditing] = useState(false);
  const reports = useQuery({ queryKey: ["company-performance", companyId, period], queryFn: () => api.get<CompanyPerformanceResponse>(`/companies/${companyId}/friday/performance?period=${period}`) });
  const projects = useQuery({ queryKey: queryKeys.projects.list(companyId), queryFn: () => projectsApi.list(companyId) });
  const departments = useQuery({ queryKey: departmentKey(companyId), queryFn: () => departmentsApi.list(companyId) });
  const selectedDepartment = departments.data?.find(row => row.id === department);
  const filteredProjects = (projects.data ?? []).filter(row => !department || selectedDepartment?.projectIds.includes(row.id));
  const scopeIds: Array<string | null> = project ? [project] : department ? filteredProjects.map(row => row.id) : [null];
  const latest = latestPerformance(reports.data?.reports ?? []);
  const scoped = latest.filter(row => scopeIds.includes(row.projectId));
  const selectedReport = project || !department ? scoped[0] : undefined;
  const summary = performanceSummary(reports.isError || reports.data?.truncated ? [] : scoped, scopeIds.length);
  const number = (value: number | null) => value === null ? "Not reported" : new Intl.NumberFormat().format(value);
  const metrics = [["Revenue", formatPerformanceMoney(summary.revenue, summary.currency)], ["Costs", formatPerformanceMoney(summary.costs, summary.currency)], ["Profit / loss", formatPerformanceMoney(summary.profit, summary.currency)], ["Views", number(summary.views)], ["Engagements", number(summary.engagements)], ["Published items", number(summary.publications)]];
  return <div className="space-y-6"><div className="flex flex-wrap items-end gap-4"><label className="text-sm">Period<input type="month" className="mt-2 block rounded-lg border bg-background p-3" value={period} onChange={event => { if (event.target.value) { setPeriod(event.target.value); setEditing(false); } }} /></label>
    {!projectId && <><label className="text-sm">Department<select className="mt-2 block rounded-lg border bg-background p-3" value={department} onChange={event => { setDepartment(event.target.value); setProject(""); setEditing(false); }}><option value="">Company totals</option>{departments.data?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="text-sm">Project<select className="mt-2 block rounded-lg border bg-background p-3" value={project} onChange={event => { setProject(event.target.value); setEditing(false); }}><option value="">{department ? "All projects in department" : "Company-wide report"}</option>{filteredProjects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label></>}
    <Button variant="outline" disabled={!!department && !project || !reports.isSuccess || reports.data.truncated} onClick={() => setEditing(value => !value)}>{selectedReport ? "Record new revision" : "Record results"}</Button>
    <Button variant="ghost" onClick={() => onAsk(`Review performance for company ${companyId}, period ${period}${project ? `, project ${project}` : department ? `, department ${department}` : ""}. Read the recorded reports and sources. Explain missing coverage, results and the next actions. Do not invent metrics.`)}>Discuss with Friday</Button></div>
    {[reports.error, projects.error, departments.error].filter(Boolean).map((error, index) => <p key={index} role="alert" className="text-destructive">{error!.message}</p>)}
    {reports.isPending && <p role="status">Reading performance reports…</p>}
    <p className="text-sm text-muted-foreground">{department && !project ? "Totals from this department’s accessible projects. Every project must report before totals are shown." : project ? "Results attributed to this project." : "Company-wide figures, recorded separately from project attribution to avoid double counting."} Reports retain their original source and every revision.</p>
    <div className="agentos-performance-metrics">{metrics.map(([label, value]) => <section key={label}><span>{label}</span><strong>{value}</strong></section>)}</div>
    {summary.profit === null && <p className="text-sm text-muted-foreground">Profit needs complete revenue and cost coverage for this month, using the same currency and accounting basis. Unreported values are not zero.</p>}
    {reports.data?.truncated && <p role="alert" className="text-destructive">This month has more than 500 report revisions. Totals are withheld until the full history is available.</p>}
    {editing && <PerformanceReportForm key={`${companyId}:${period}:${project}:${selectedReport?.id}`} companyId={companyId} period={period} projectId={project || null} previous={selectedReport} onClose={() => setEditing(false)} />}
    <div className="overflow-x-auto"><table className="agentos-data-table"><caption className="text-left text-sm font-semibold">Sources and reporting coverage</caption><thead><tr><th>Scope</th><th>Source</th><th>Coverage</th><th>Recorded</th><th>Evidence</th></tr></thead><tbody>{scoped.map(row => <tr key={row.id}><td>{row.projectId ? projects.data?.find(project => project.id === row.projectId)?.name ?? "Project" : "Company"}</td><td>{row.sourceLabel}<small className="block">Revision {row.revision} · {row.currency ?? "No currency"} · {row.basis}</small></td><td>{row.revenueComplete ? "Revenue complete" : "Revenue partial / unreported"}<br />{row.costsComplete ? "Costs complete" : "Costs partial / unreported"}</td><td>{new Date(row.createdAt).toLocaleString()}</td><td className="max-w-xs break-words">{row.evidenceRef}</td></tr>)}</tbody></table></div>
    {!scoped.length && reports.isSuccess && <p className="agentos-empty">No results reported in this scope yet. Record a source-backed report, or ask Friday to collect one from the company’s connected tools.</p>}
    <details><summary className="cursor-pointer text-sm">Report history</summary><div className="overflow-x-auto"><table className="agentos-data-table"><thead><tr><th>Revision</th><th>Source</th><th>Revenue</th><th>Costs</th><th>Recorded</th></tr></thead><tbody>{reports.data?.reports.filter(row => scopeIds.includes(row.projectId)).map(row => <tr key={row.id}><td>{row.revision}</td><td>{row.sourceLabel}</td><td>{formatPerformanceMoney(row.values.revenueMinor, row.currency)}</td><td>{formatPerformanceMoney(row.values.costMinor, row.currency)}</td><td>{new Date(row.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div></details>
  </div>;
}

function PerformanceReportForm({ companyId, period, projectId, previous, onClose }: { companyId: string; period: string; projectId: string | null; previous?: CompanyPerformanceReport; onClose: () => void }) {
  const client = useQueryClient();
  const [currency, setCurrency] = useState(previous?.currency ?? "USD");
  const [basis, setBasis] = useState<"cash" | "accrual">(previous?.basis ?? "cash");
  const [source, setSource] = useState(previous?.sourceLabel ?? ""), [evidence, setEvidence] = useState(previous?.evidenceRef ?? "");
  const [revenueComplete, setRevenueComplete] = useState(false), [costsComplete, setCostsComplete] = useState(false);
  const fields = ["revenueMinor", "costMinor", "views", "engagements", "publications"] as const;
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(key => [key, previous?.values[key] == null ? "" : String(previous.values[key]! / (key.endsWith("Minor") ? currencyScale(currency) : 1))])));
  const save = useMutation({ mutationFn: () => {
    const measures = Object.fromEntries(fields.map(key => { const text = values[key].trim(); const amount = text ? Number(text) : null; return [key, amount !== null && key.endsWith("Minor") ? Math.round(amount * currencyScale(currency)) : amount]; }));
    const input = createPerformanceReportSchema.parse({ projectId, period, currency, basis, values: measures, sourceLabel: source, evidenceRef: evidence, revenueComplete, costsComplete, expectedReportId: previous?.id ?? null }) as CreatePerformanceReport;
    return api.post(`/companies/${companyId}/friday/performance`, input);
  }, onSuccess: async () => { await client.invalidateQueries({ queryKey: ["company-performance", companyId, period] }); onClose(); } });
  return <form className="space-y-4 rounded-xl border p-5" onSubmit={event => { event.preventDefault(); save.mutate(); }}><h3 className="font-semibold">Record results · {period}</h3><p className="text-sm text-muted-foreground">Leave unknown values empty. Report the entire month-to-date total, not an increment. A new revision preserves the previous report.</p>
    <div className="grid gap-4 sm:grid-cols-3"><label className="text-sm">Currency<input className="mt-2 w-full rounded-lg border bg-background p-3" required maxLength={3} value={currency} onChange={event => setCurrency(event.target.value.toUpperCase())} /></label><label className="text-sm">Accounting basis<select className="mt-2 w-full rounded-lg border bg-background p-3" value={basis} onChange={event => setBasis(event.target.value as "cash" | "accrual")}><option value="cash">Cash</option><option value="accrual">Accrual</option></select></label>{fields.map(key => <label className="text-sm" key={key}>{({ revenueMinor: "Revenue", costMinor: "Costs", views: "Views", engagements: "Engagements", publications: "Published items" })[key]}<input type="number" min="0" step={key.endsWith("Minor") ? 1 / currencyScale(currency) : 1} className="mt-2 w-full rounded-lg border bg-background p-3" value={values[key]} onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
    <div className="flex flex-wrap gap-5"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={revenueComplete} onChange={event => setRevenueComplete(event.target.checked)} />All revenue for this period is included</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={costsComplete} onChange={event => setCostsComplete(event.target.checked)} />All costs for this period are included</label></div>
    <label className="block text-sm">Source name<input required maxLength={120} className="mt-2 w-full rounded-lg border bg-background p-3" value={source} onChange={event => setSource(event.target.value)} placeholder="e.g. October Stripe export + expense ledger" /></label><label className="block text-sm">Evidence and coverage<textarea required minLength={10} maxLength={1000} className="mt-2 w-full rounded-lg border bg-background p-3" value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="Reference the source artefact, collection date, attribution and any missing data." /></label>
    {save.error && <p role="alert" className="text-destructive">{save.error.message}</p>}<div className="flex justify-between"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={save.isPending}>Save report revision</Button></div>
  </form>;
}
