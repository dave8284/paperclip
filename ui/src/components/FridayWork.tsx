import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Agent, FridayWork as WorkData } from "@paperclipai/shared";
import { fridayApi, fridayKey } from "../api/friday";
import { ArrowRight } from "lucide-react";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import type { FridayNavigation } from "../lib/friday-navigation";
import { fridayGraphAgents } from "../lib/friday-graph";
import { AgentOSDelete } from "./AgentOSDelete";
import { Button } from "./ui/button";
import { FridayWorkGraph } from "./FridayWorkGraph";
import { ApplicationTaskInspector } from "./ApplicationTaskInspector";

export function FridayWork({ companyId, agents, view, navigate, onAsk, assistantName = "Friday" }: { companyId: string; agents: Agent[]; view: FridayNavigation; navigate: (view: FridayNavigation) => void; onAsk: (text: string) => void; assistantName?: string }) {
  const roster = useQuery({ queryKey: queryKeys.agents.list(companyId), queryFn: () => agentsApi.list(companyId) });
  agents = roster.isSuccess ? roster.data : agents.filter(agent => agent.companyId === companyId);
  const [offset, setOffset] = useState(0);
  const [projectOffset, setProjectOffset] = useState(0);
  const [status, setStatus] = useState<"active" | "completed" | "all">("all");
  const mode = view.mode ?? "combined";
  const query = { projectId: view.projectId, applicationId: view.applicationId, agentId: view.agentId, offset, projectOffset, status };
  const work = useQuery({ queryKey: [...fridayKey(companyId), "work", query], queryFn: () => fridayApi.work(companyId, query) });
  const runs = useQuery({ queryKey: queryKeys.liveRuns(companyId), queryFn: () => heartbeatsApi.liveRunsForCompany(companyId) });
  const detail = useQuery({ queryKey: queryKeys.issues.detail(view.taskId ?? ""), queryFn: () => issuesApi.get(view.taskId!), enabled: !!view.taskId });
  const data = work.error ? undefined : work.data;
  const running = new Set((runs.error ? [] : runs.data ?? []).filter(run => run.status === "running" && run.issueId).map(run => run.issueId!));
  const chosen = detail.error ? undefined : (detail.data?.companyId === companyId && (!view.projectId || detail.data.projectId === view.projectId) ? detail.data : undefined) ?? data?.tasks.find(task => task.id === view.taskId);
  const selectTask = (taskId: string) => navigate({ ...view, taskId });
  const taskRows = (tasks: WorkData["tasks"]) => tasks.map(task => <div key={task.id} className="agentos-task-shell"><button type="button" key={task.id} className="friday-work-task" onClick={() => selectTask(task.id)} aria-pressed={view.taskId === task.id}>
    <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{task.identifier ?? "Task"}</span><span>{running.has(task.id) ? "Running" : task.status.replaceAll("_", " ")}</span></span>
    <span className="block text-sm font-medium">{task.title}</span><span className="block text-xs text-muted-foreground">{agents.find(agent => agent.id === task.assigneeAgentId)?.name ?? (task.assigneeUserId ? "Human owner" : "Unassigned")}</span>
  </button><AgentOSDelete compact kind="task" id={task.id} companyId={companyId} name={task.title} onRemoved={() => { if (view.taskId === task.id) navigate({ ...view, taskId: undefined }); }} /></div>);
  const activity = data && <div className="space-y-3" aria-label="Project activity">
    <h3 className="text-sm font-semibold">Work and recorded outcomes</h3>
    {data.handoffs.map(handoff => <button type="button" key={handoff.id} className="friday-work-task" onClick={() => selectTask(handoff.taskId)}><span className="text-sm">{agents.find(agent => agent.id === handoff.fromAgentId)?.name ?? "Lead"} → {agents.find(agent => agent.id === handoff.toAgentId)?.name ?? "Completion"}</span><span className="block text-xs text-muted-foreground">{handoff.phase} · {handoff.state.replaceAll("_", " ")} · {new Date(handoff.createdAt).toLocaleString()}</span></button>)}
    {taskRows(data.tasks)}
    {!!data.evidence.length && <h4 className="text-xs font-medium text-muted-foreground">Messages and outputs for these tasks</h4>}
    {data.evidence.map(item => <button type="button" key={`${item.kind}:${item.id}`} className="friday-work-task" onClick={() => selectTask(item.taskId)}><span className="text-sm">{item.title}</span><span className="block text-xs text-muted-foreground">{item.kind} · {new Date(item.createdAt).toLocaleString()}</span></button>)}
  </div>;
  if (view.taskId) return <section className="space-y-4" aria-label="Task details">
    <div className="flex items-center justify-between gap-3"><Button variant="outline" onClick={() => navigate({ ...view, taskId: undefined })}>Back to {mode === "graph" ? "Agent Map" : mode === "kanban" ? "Kanban" : "work"}</Button>{chosen && <AgentOSDelete kind="task" id={chosen.id} companyId={companyId} name={chosen.title} onRemoved={() => navigate({ ...view, taskId: undefined })} />}</div>
    {detail.error && <p role="alert" className="text-destructive">{detail.error.message}</p>}
    {chosen ? <ApplicationTaskInspector key={chosen.id} task={chosen} /> : detail.isPending ? <p role="status">Loading task and its recorded outcomes…</p> : !detail.error && <p role="alert">This task is not available in this workspace.</p>}
  </section>;
  return <div className="agentos-work-view">
    <div className="agentos-work-toolbar"><select className="rounded-lg border bg-background px-3 py-2 text-sm" aria-label="Work status" value={status} onChange={event => { setStatus(event.target.value as typeof status); setOffset(0); }}><option value="all">Active and completed</option><option value="active">Active work</option><option value="completed">Completed work</option></select><Button variant="ghost" size="sm" onClick={() => onAsk(`Summarize current work, blockers and completed outcomes for company ${companyId}. Scope: ${JSON.stringify({ projectId: view.projectId, applicationId: view.applicationId, agentId: view.agentId })}. Cite the underlying tasks.`)}>Discuss with {assistantName}</Button></div>
    {[work.error, runs.error, detail.error, roster.error].filter(Boolean).map((error, index) => <p role="alert" key={index} className="text-sm text-destructive">{error!.message}</p>)}
    {work.isPending && <p className="text-sm text-muted-foreground">Reading projects and their work…</p>}
    {data && <>
      <div className="agentos-work-metrics" aria-label="Work totals">{[["In motion", data.counts.in_progress ?? 0], ["To do", (data.counts.todo ?? 0) + (data.counts.backlog ?? 0)], ["Needs attention", (data.counts.blocked ?? 0) + (data.counts.in_review ?? 0)], ["Completed", data.counts.done ?? 0]].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
      {mode === "combined" && !view.projectId && <section><div className="agentos-section-heading"><h2>Projects</h2><span className="text-sm text-muted-foreground">{data.projectCount} in this company</span></div><div className="agentos-project-grid">{data.projects.map(project => <AgentOSProjectCard key={project.id} companyId={companyId} project={project} lead={agents.find(agent => agent.id === project.leadAgentId)?.name} onOpen={() => navigate({ ...view, projectId: project.id, taskId: undefined, mode: "combined" })} />)}</div></section>}
      {!data.tasks.length && !data.projectCount && <p className="agentos-empty">No work in this scope yet. Tell Friday what you want to start.</p>}
      {mode === "graph" && <FridayWorkGraph data={data} agents={fridayGraphAgents(data, agents, !!(view.projectId || view.applicationId || view.agentId))} running={running} onSelect={node => {
        if (node.kind === "application") navigate({ ...view, applicationId: node.recordId, projectId: undefined, taskId: undefined });
        else if (node.kind === "project") navigate({ ...view, projectId: node.recordId, taskId: undefined });
        else if (node.kind === "agent") navigate({ panel: "team", companyId, agentId: node.recordId });
        else selectTask(node.taskId ?? node.recordId);
      }} />}
      {mode === "kanban" && <div className="agentos-kanban" aria-label="Kanban board">{[["backlog", "Backlog"], ["todo", "To do"], ["in_progress", "Doing"], ["in_review", "In review"], ["blocked", "Blocked"], ["done", "Done"]].map(([state, label]) => <section key={state}><header><h3>{label}</h3><span>{data.counts[state] ?? 0}</span></header>{taskRows(data.tasks.filter(task => task.status === state))}{!data.tasks.some(task => task.status === state) && <p className="text-xs text-muted-foreground">No tasks on this page</p>}</section>)}</div>}
      {mode === "activity" && activity}
      {mode === "combined" && <div className="agentos-work-columns"><div className="space-y-8">{[["In motion", ["in_progress", "in_review", "blocked"]], ["Up next", ["todo", "backlog"]], ["Completed", ["done", "cancelled"]]].map(([label, statuses]) => <section key={label as string}><div className="agentos-section-heading"><h2>{label as string}</h2></div><div className="space-y-2">{taskRows(data.tasks.filter(task => (statuses as string[]).includes(task.status)))}{!data.tasks.some(task => (statuses as string[]).includes(task.status)) && <p className="text-sm text-muted-foreground">No tasks in this section on the current page.</p>}</div></section>)}</div><aside className="agentos-context-rail"><section><p className="agentos-eyebrow">A little context</p><h3>Small updates. Real progress.</h3><p>{data.counts.blocked ? `${data.counts.blocked} tasks are blocked in this scope.` : "No blocked tasks recorded in this scope."}</p><Button variant="ghost" size="sm" onClick={() => navigate({ panel: "attention", companyId, projectId: view.projectId })}>Review decisions <ArrowRight /></Button></section><section><h3>Recorded handoffs</h3>{data.handoffs.slice(0, 6).map(handoff => <button type="button" key={handoff.id} className="friday-work-task" onClick={() => selectTask(handoff.taskId)}><span>{agents.find(agent => agent.id === handoff.fromAgentId)?.name ?? "Lead"} → {agents.find(agent => agent.id === handoff.toAgentId)?.name ?? "Completion"}</span><small>{handoff.phase} · {handoff.state.replaceAll("_", " ")}</small></button>)}{!data.handoffs.length && <p>No handoffs recorded on this page.</p>}</section><section><h3>Latest evidence</h3>{data.evidence.slice(0, 6).map(item => <button type="button" key={`${item.kind}:${item.id}`} className="friday-work-task" onClick={() => selectTask(item.taskId)}>{item.title}<small>{item.kind} · {new Date(item.createdAt).toLocaleString()}</small></button>)}{!data.evidence.length && <p>Outputs will appear as work is recorded.</p>}</section></aside></div>}
      {(data.nextOffset != null || offset > 0) && <div className="flex items-center justify-between gap-2"><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 100))}>Previous tasks</Button><span className="text-xs text-muted-foreground">{data.tasks.length} tasks on this page</span><Button size="sm" variant="outline" disabled={data.nextOffset == null} onClick={() => setOffset(data.nextOffset!)}>Next tasks</Button></div>}
      {(projectOffset > 0 || data.nextProjectOffset != null) && <div className="flex justify-between gap-2"><Button variant="ghost" disabled={!projectOffset} onClick={() => setProjectOffset(value => Math.max(0, value - 200))}>Previous projects</Button><Button variant="ghost" disabled={data.nextProjectOffset == null} onClick={() => setProjectOffset(data.nextProjectOffset!)}>More projects</Button></div>}
      <p className="agentos-record-note">Updated {new Date(data.observedAt).toLocaleTimeString()}. Totals cover the full scope; this view contains {data.tasks.length} loaded tasks. {data.evidenceTruncated || data.handoffsTruncated || data.assignmentsTruncated ? "Some evidence is capped; open a task or project for more detail." : ""}</p>
    </>}
  </div>;
}

function AgentOSProjectCard({ companyId, project, lead, onOpen }: { companyId: string; project: WorkData["projects"][number]; lead?: string; onOpen: () => void }) {
  const scope = useQuery({ queryKey: [...fridayKey(companyId), "project-summary", project.id], queryFn: () => fridayApi.work(companyId, { projectId: project.id, limit: 1 }) });
  const counts = scope.isSuccess ? scope.data.counts : null;
  const total = counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : null;
  return <div className="agentos-card-shell"><button type="button" className="agentos-project-card" onClick={onOpen}><div className="flex items-center justify-between gap-3"><span className="agentos-eyebrow">Project</span><span className="agentos-pill">{project.status.replaceAll("_", " ")}</span></div><h3>{project.name}</h3><p>{lead ? `Led by ${lead}` : "Project team"}</p><progress aria-label={`${project.name} completion`} value={counts?.done ?? 0} max={total || 1} /><div className="flex justify-between gap-3 text-xs text-muted-foreground"><span>{counts ? counts.in_progress ?? 0 : "—"} in motion</span><span>{counts?.done ?? "—"}/{total ?? "—"} done</span></div>{scope.error && <p className="text-destructive">Progress unavailable</p>}<div className="agentos-card-footer">Open workspace <ArrowRight /></div></button><AgentOSDelete compact kind="project" id={project.id} companyId={companyId} name={project.name} /></div>;
}
