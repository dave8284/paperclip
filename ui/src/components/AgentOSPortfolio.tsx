import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus } from "lucide-react";
import type { Agent, Company, FridayWork as WorkData } from "@paperclipai/shared";
import { agentsApi } from "@/api/agents";
import { attentionApi } from "@/api/attention";
import { fridayApi, fridayKey } from "@/api/friday";
import { heartbeatsApi } from "@/api/heartbeats";
import { queryKeys } from "@/lib/queryKeys";
import type { FridayNavigation } from "@/lib/friday-navigation";
import { useFridayUpdates } from "@/hooks/useFridayUpdates";
import { AgentOSCompanyScope } from "./AgentOSCompanyScope";
import { FridayAttention } from "./FridayAttention";
import { FridayOperations } from "./FridayOperations";
import { FridayWorkGraph } from "./FridayWorkGraph";
import { AgentOSDelete } from "./AgentOSDelete";
import { Button } from "./ui/button";

type Navigation = (view: FridayNavigation) => void;
export function AgentOSCompanyUpdates({ companyId }: { companyId: string }) { useFridayUpdates(companyId); return null; }

export function AgentOSCompanies({ companies, navigate, onCreate }: { companies: Company[]; navigate: Navigation; onCreate: () => void }) {
  return <div className="agentos-page"><div className="agentos-page-heading"><div><p className="agentos-eyebrow">Your portfolio</p><h1>Good things are taking shape.</h1><p>Independent companies, one place to keep perspective.</p></div><Button variant="outline" onClick={onCreate}><Plus />New company</Button></div>
    <div className="agentos-company-grid">{companies.map(company => <CompanyCard key={company.id} company={company} navigate={navigate} />)}</div>
    {!companies.length && <p className="agentos-empty">Your companies will appear here. Tell Friday what you would like to create.</p>}
  </div>;
}

function CompanyCard({ company, navigate }: { company: Company; navigate: Navigation }) {
  const work = useQuery({ queryKey: [...fridayKey(company.id), "summary"], queryFn: () => fridayApi.work(company.id, { limit: 1 }) });
  const attention = useQuery({ queryKey: [...queryKeys.attention(company.id), "summary"], queryFn: () => attentionApi.list(company.id, { limit: 1, sort: "decide" }) });
  return <div className="agentos-card-shell"><button type="button" className="agentos-company-card" onClick={() => navigate({ panel: "work", companyId: company.id, mode: "combined" })}>
    <div className="flex items-center justify-between gap-3"><span className="agentos-company-mark">{company.name[0]}</span><span className="agentos-pill">{company.status.replaceAll("_", " ")}</span></div>
    <h2>{company.name}</h2><p>{company.description || "A workspace for your team, projects and decisions."}</p>
    <div className="agentos-card-metrics"><span><strong>{work.isSuccess ? work.data.projectCount : "—"}</strong>projects</span><span><strong>{work.isSuccess ? work.data.counts.in_progress ?? 0 : "—"}</strong>in motion</span><span><strong>{attention.isSuccess ? attention.data.totalCount : "—"}</strong>decisions & blockers</span></div>
    {(work.error || attention.error) && <p className="text-destructive">Some information could not be refreshed.</p>}
    <div className="agentos-card-footer">Open company<ArrowRight /></div>
  </button><AgentOSDelete compact kind="company" id={company.id} companyId={company.id} name={company.name} /></div>;
}

export function AgentOSDecisionPeek({ companies, navigate }: { companies: Company[]; navigate: Navigation }) {
  const feeds = useQueries({ queries: companies.map(company => ({ queryKey: [...queryKeys.attention(company.id), "preview"], queryFn: () => attentionApi.list(company.id, { limit: 3, sort: "decide" }) })) });
  const items = feeds.flatMap((feed, index) => feed.isSuccess ? feed.data.items.map(item => ({ item, company: companies[index] })) : []).slice(0, 3);
  return <section className="agentos-home-decisions" aria-label="Decisions and blockers"><div className="agentos-section-heading"><h2>A few things to move forward</h2><button type="button" onClick={() => navigate({ panel: "attention" })}>Review all <ArrowRight /></button></div>
    <div className="agentos-decision-cards">{items.map(({ item, company }) => <button type="button" key={`${company.id}:${item.id}`} onClick={() => navigate({ panel: "attention", companyId: company.id, projectId: item.project?.id ?? undefined })}><span className="agentos-eyebrow">{company.name}{item.project ? ` / ${item.project.name}` : ""}</span><strong>{item.subject.title ?? item.whyNow}</strong><span>{item.whyNow}<ArrowRight /></span></button>)}</div>
    {feeds.some(feed => feed.isPending) && <p className="text-sm text-muted-foreground">Checking what needs you…</p>}
    {feeds.some(feed => feed.isError) && <p role="alert" className="text-sm text-destructive">Some companies could not be checked. Open Decisions to retry.</p>}
    {!items.length && feeds.every(feed => feed.isSuccess) && <p className="agentos-empty">A little room to breathe. No decisions or blockers currently need you.</p>}
  </section>;
}

export function AgentOSScopedRecords({ company, view, navigate, onAsk }: { company: Company; view: FridayNavigation; navigate: Navigation; onAsk: (message: string) => void }) {
  const agents = useQuery({ queryKey: queryKeys.agents.list(company.id), queryFn: () => agentsApi.list(company.id) });
  const scoped = (next: FridayNavigation) => navigate({ ...next, companyId: company.id });
  return <AgentOSCompanyScope company={company}><section className="agentos-company-records"><div className="agentos-section-heading"><h2>{company.name}</h2><button type="button" onClick={() => scoped({ panel: "work", mode: "combined" })}>Open company <ArrowRight /></button></div>
    {agents.error && <p role="alert" className="text-sm text-destructive">{agents.error.message}</p>}
    {view.panel === "attention" ? <FridayAttention companyId={company.id} projectId={view.projectId} agents={agents.isSuccess ? agents.data : []} onProject={projectId => scoped({ panel: "work", projectId, mode: "combined" })} onAsk={onAsk} /> : <FridayOperations companyId={company.id} agents={agents.isSuccess ? agents.data : []} view={view} onAsk={onAsk} />}
  </section></AgentOSCompanyScope>;
}

export function AgentOSWorkforceTable({ companies, navigate }: { companies: Company[]; navigate: Navigation }) {
  const roster = useQueries({ queries: companies.map(company => ({ queryKey: queryKeys.agents.list(company.id), queryFn: () => agentsApi.list(company.id) })) });
  return <div className="agentos-employee-table-wrap"><table className="agentos-employee-table"><caption className="sr-only">Employees, company assignments and execution profiles</caption><thead><tr><th>Employee</th><th>Company</th><th>Status</th><th>Capabilities</th><th>Harness / model</th><th><span className="sr-only">Open profile</span></th></tr></thead><tbody>{roster.flatMap((query, index) => query.isSuccess ? query.data.filter(agent => agent.status !== "terminated").map(agent => <tr key={agent.id}>
    <td><button className="agentos-employee-name" type="button" onClick={() => navigate({ panel: "team", companyId: companies[index].id, agentId: agent.id })}><span className="agentos-avatar">{agent.name[0]}</span><span><strong>{agent.name}</strong><small>{agent.title ?? agent.role}</small></span></button></td><td>{companies[index].name}</td><td><span className="agentos-pill" data-status={agent.status}>{agent.status.replaceAll("_", " ")}</span></td><td><span className="agentos-capability-summary">{agent.capabilities || "Open profile for skills and instructions"}</span></td><td>{agent.adapterType}<small>{typeof agent.adapterConfig?.model === "string" ? agent.adapterConfig.model : "Harness default"}</small></td><td><Button size="icon-sm" variant="ghost" aria-label={`Open ${agent.name} profile`} onClick={() => navigate({ panel: "team", companyId: companies[index].id, agentId: agent.id })}><ArrowRight /></Button></td>
  </tr>) : [])}</tbody></table>{roster.some(query => query.isPending) && <p className="p-5 text-sm text-muted-foreground">Loading your workforce…</p>}{roster.filter(query => query.error).map((query, index) => <p key={index} role="alert" className="p-4 text-sm text-destructive">{query.error?.message}</p>)}{roster.every(query => query.isSuccess && !query.data.length) && <p className="agentos-empty">No employees in this scope yet.</p>}</div>;
}

export function AgentOSPortfolioMap({ companies, navigate }: { companies: Company[]; navigate: Navigation }) {
  const work = useQueries({ queries: companies.map(company => ({ queryKey: [...fridayKey(company.id), "map"], queryFn: () => fridayApi.work(company.id, { limit: 200 }) })) });
  const rosters = useQueries({ queries: companies.map(company => ({ queryKey: queryKeys.agents.list(company.id), queryFn: () => agentsApi.list(company.id) })) });
  const live = useQueries({ queries: companies.map(company => ({ queryKey: queryKeys.liveRuns(company.id), queryFn: () => heartbeatsApi.liveRunsForCompany(company.id) })) });
  const data = work.flatMap(query => query.isSuccess ? [query.data] : []);
  const merged: WorkData = {
    observedAt: data[0]?.observedAt ?? new Date().toISOString(), projects: data.flatMap(row => row.projects), projectCount: data.reduce((sum, row) => sum + row.projectCount, 0), nextProjectOffset: null,
    applications: data.flatMap(row => row.applications), tasks: data.flatMap(row => row.tasks), counts: {}, nextOffset: null,
    assignments: data.flatMap(row => row.assignments), evidence: data.flatMap(row => row.evidence), handoffs: data.flatMap(row => row.handoffs), assignmentsTruncated: data.some(row => row.assignmentsTruncated), evidenceTruncated: data.some(row => row.evidenceTruncated), handoffsTruncated: data.some(row => row.handoffsTruncated),
  };
  const agents: Agent[] = rosters.flatMap(query => query.isSuccess ? query.data : []);
  const running = new Set(live.flatMap(query => query.isSuccess ? query.data.filter(run => run.status === "running" && run.issueId).map(run => run.issueId!) : []));
  const partial = data.some(row => row.nextOffset != null || row.nextProjectOffset != null || row.evidenceTruncated || row.assignmentsTruncated || row.handoffsTruncated);
  return <>{work.some(query => query.isPending) && <p role="status" className="text-sm text-muted-foreground">Reading your portfolio…</p>}{[...work, ...rosters, ...live].some(query => query.isError) && <p role="alert" className="text-sm text-destructive">Some records could not be refreshed. This map is incomplete.</p>}
    <FridayWorkGraph data={merged} agents={agents} running={running} companies={companies.map((company, index) => ({ id: company.id, name: company.name, projectIds: work[index].isSuccess ? work[index].data.projects.map(project => project.id) : [] }))} onSelect={node => {
      const index = work.findIndex(query => query.isSuccess && (query.data.projects.some(project => project.id === node.recordId) || query.data.tasks.some(task => task.id === (node.taskId ?? node.recordId)) || query.data.applications.some(app => app.id === node.recordId)));
      const companyId = node.kind === "company" ? node.recordId : node.kind === "agent" ? agents.find(agent => agent.id === node.recordId)?.companyId : companies[index]?.id;
      if (!companyId) return;
      navigate({ panel: node.kind === "agent" ? "team" : "work", companyId, mode: "graph", ...(node.kind === "project" ? { projectId: node.recordId } : node.kind === "agent" ? { agentId: node.recordId } : node.kind === "application" ? { applicationId: node.recordId } : node.kind !== "company" ? { taskId: node.taskId ?? node.recordId } : {}) });
    }} />{partial && <p className="text-xs text-muted-foreground">This overview uses a bounded page of records per company. Open a company or project to inspect more work.</p>}</>;
}
