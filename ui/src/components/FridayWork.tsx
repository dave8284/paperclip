import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Agent, FridayWork as WorkData } from "@paperclipai/shared";
import { fridayApi, fridayKey } from "../api/friday";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { Link } from "../lib/router";
import type { FridayNavigation } from "../lib/friday-navigation";
import { Button } from "./ui/button";
import { FridayWorkGraph } from "./FridayWorkGraph";
import { ApplicationTaskInspector } from "./ApplicationTaskInspector";

export function FridayWork({ companyId, agents, view, navigate, onAsk, assistantName = "Friday" }: { companyId: string; agents: Agent[]; view: FridayNavigation; navigate: (view: FridayNavigation) => void; onAsk: (text: string) => void; assistantName?: string }) {
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
  const chosen = detail.error ? undefined : (detail.data?.companyId === companyId ? detail.data : undefined) ?? data?.tasks.find(task => task.id === view.taskId);
  const projectName = data?.projects.find(project => project.id === view.projectId)?.name;
  const agentName = agents.find(agent => agent.id === view.agentId)?.name;
  const selectTask = (taskId: string) => navigate({ ...view, taskId });
  const taskRows = (tasks: WorkData["tasks"]) => tasks.map(task => <button type="button" key={task.id} className="friday-work-task" onClick={() => selectTask(task.id)} aria-pressed={view.taskId === task.id}>
    <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{task.identifier ?? "Task"}</span><span>{running.has(task.id) ? "Running" : task.status.replaceAll("_", " ")}</span></span>
    <span className="block text-sm font-medium">{task.title}</span><span className="block text-xs text-muted-foreground">{agents.find(agent => agent.id === task.assigneeAgentId)?.name ?? (task.assigneeUserId ? "Human owner" : "Unassigned")}</span>
  </button>);
  const activity = data && <div className="space-y-3" aria-label="Project activity">
    <h3 className="text-sm font-semibold">Work and recorded outcomes</h3>
    {data.handoffs.map(handoff => <button type="button" key={handoff.id} className="friday-work-task" onClick={() => selectTask(handoff.taskId)}><span className="text-sm">{agents.find(agent => agent.id === handoff.fromAgentId)?.name ?? "Lead"} → {agents.find(agent => agent.id === handoff.toAgentId)?.name ?? "Completion"}</span><span className="block text-xs text-muted-foreground">{handoff.phase} · {handoff.state.replaceAll("_", " ")} · {new Date(handoff.createdAt).toLocaleString()}</span></button>)}
    {taskRows(data.tasks)}
    {!!data.evidence.length && <h4 className="text-xs font-medium text-muted-foreground">Messages and outputs for these tasks</h4>}
    {data.evidence.map(item => <button type="button" key={`${item.kind}:${item.id}`} className="friday-work-task" onClick={() => selectTask(item.taskId)}><span className="text-sm">{item.title}</span><span className="block text-xs text-muted-foreground">{item.kind} · {new Date(item.createdAt).toLocaleString()}</span></button>)}
  </div>;
  return <div className="space-y-4">
    <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Work focus"><Button variant="ghost" size="sm" onClick={() => navigate({ panel: "work", mode })}>All projects</Button>{view.applicationId && <span> / {data?.applications.find(app => app.id === view.applicationId)?.name ?? "Application"}</span>}{view.projectId && <span> / {projectName ?? "Project"}</span>}{agentName && <span> / {agentName}</span>}</nav>
    <div className="flex flex-wrap items-center gap-2"><div className="flex flex-wrap gap-1" aria-label="Work display">{(["graph", "kanban", "activity", "combined"] as const).map(item => <Button key={item} size="sm" variant={mode === item ? "secondary" : "ghost"} aria-pressed={mode === item} onClick={() => navigate({ ...view, mode: item })}>{item === "graph" ? "Galaxy" : item[0].toUpperCase() + item.slice(1)}</Button>)}</div>
      <select className="rounded-md border bg-background px-2 py-1 text-sm" aria-label="Work status" value={status} onChange={event => { setStatus(event.target.value as typeof status); setOffset(0); }}><option value="all">Active and completed</option><option value="active">Active work</option><option value="completed">Completed work</option></select>
      {view.projectId && <Button variant="ghost" size="sm" onClick={() => navigate({ panel: "attention", projectId: view.projectId })}>Project decisions</Button>}
      <Button variant="ghost" size="sm" onClick={() => onAsk(`Summarize current work, blockers and completed outcomes using the Friday work API. Scope: ${JSON.stringify({ projectId: view.projectId, applicationId: view.applicationId, agentId: view.agentId })}. Cite the underlying tasks.`)}>Ask {assistantName}</Button>
    </div>
    {[work.error, runs.error, detail.error].filter(Boolean).map((error, index) => <p role="alert" key={index} className="text-sm text-destructive">{error!.message}</p>)}
    {work.isPending && <p className="text-sm text-muted-foreground">Reading projects and their work…</p>}
    {data && <>
      <div className="friday-work-counts"><span>{data.projectCount} projects</span>{Object.entries(data.counts).map(([state, count]) => <span key={state}>{count} {state.replaceAll("_", " ")}</span>)}</div>
      {!view.projectId && <div className="flex flex-wrap gap-2">{data.projects.map(project => <Button variant="outline" size="sm" key={project.id} onClick={() => navigate({ ...view, projectId: project.id, taskId: undefined })}>{project.name}</Button>)}</div>}
      {!!data.applications.length && !view.applicationId && <div className="flex flex-wrap gap-2">{data.applications.map(app => <Button variant="ghost" size="sm" key={app.id} onClick={() => navigate({ panel: "work", applicationId: app.id, mode })}>{app.name}{app.kind === "platform" ? " · platform" : " · application"}</Button>)}</div>}
      {data.projectCount === 0 && !data.tasks.length && <p className="text-sm text-muted-foreground">No work in this scope yet. Tell Friday what you want to start.</p>}
      <div className={mode === "combined" ? "friday-combined-work" : "space-y-3"}>
        {(mode === "graph" || mode === "combined") && <FridayWorkGraph data={data} agents={agents} running={running} onSelect={node => {
          if (node.kind === "application") navigate({ panel: "work", applicationId: node.recordId, mode });
          else if (node.kind === "project") navigate({ ...view, projectId: node.recordId, taskId: undefined });
          else if (node.kind === "agent") navigate({ panel: "team", agentId: node.recordId });
          else selectTask(node.taskId ?? node.recordId);
        }} />}
        {(mode === "activity" || mode === "combined") && <div className="friday-work-activity">{activity}</div>}
        {mode === "kanban" && <div className="friday-kanban">{["backlog", "todo", "in_progress", "blocked", "in_review", "done", "cancelled"].filter(state => data.tasks.some(task => task.status === state)).map(state => <section key={state} className="space-y-2"><h3 className="text-xs font-semibold uppercase text-muted-foreground">{state.replaceAll("_", " ")}</h3>{taskRows(data.tasks.filter(task => task.status === state))}</section>)}</div>}
      </div>
      {chosen && <section className="space-y-2"><div className="flex justify-end"><Button variant="ghost" size="sm" onClick={() => navigate({ ...view, taskId: undefined })}>Close task</Button></div><ApplicationTaskInspector key={chosen.id} task={chosen} />
        {data.evidence.filter(item => item.taskId === chosen.id).map(item => <Link key={item.id} className="block text-sm text-primary" to={`/issues/${chosen.identifier ?? chosen.id}${item.kind === "comment" ? `#comment-${item.id}` : ""}`}>{item.title} · inspect source</Link>)}
      </section>}
      <div className="flex items-center justify-between gap-2"><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 100))}>Previous tasks</Button><span className="text-xs text-muted-foreground">{data.tasks.length} tasks on this page</span><Button size="sm" variant="outline" disabled={data.nextOffset == null} onClick={() => setOffset(data.nextOffset!)}>Next tasks</Button></div>
      {(projectOffset > 0 || data.nextProjectOffset != null) && <div className="flex justify-between gap-2"><Button variant="ghost" disabled={!projectOffset} onClick={() => setProjectOffset(value => Math.max(0, value - 200))}>Previous projects</Button><Button variant="ghost" disabled={data.nextProjectOffset == null} onClick={() => setProjectOffset(data.nextProjectOffset!)}>More projects</Button></div>}
      <p className="text-xs text-muted-foreground">Observed {new Date(data.observedAt).toLocaleTimeString()}. Counts cover the full authorized scope; the graph and board show this page. {data.evidenceTruncated || data.handoffsTruncated || data.assignmentsTruncated ? "Some evidence is capped; open a task or narrow the project for more detail." : ""}</p>
    </>}
  </div>;
}
