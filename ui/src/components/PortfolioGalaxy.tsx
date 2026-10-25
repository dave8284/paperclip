import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Minus, Plus, Maximize } from "lucide-react";
import { managedApplicationsApi } from "../api/managed-applications";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { applicationQueryKey, useApplicationUpdates } from "../hooks/useApplicationUpdates";
import { queryKeys } from "../lib/queryKeys";
import { galaxyPoint } from "../lib/galaxy-layout";
import { Link } from "../lib/router";
import { Button } from "./ui/button";
import { ApplicationTaskInspector } from "./ApplicationTaskInspector";

export function PortfolioGalaxy({ companyId }: { companyId: string }) {
  const [kind, setKind] = useState<"application" | "platform">("application");
  const [cursors, setCursors] = useState<string[]>([]);
  const [applicationId, setApplicationId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  useApplicationUpdates(companyId);
  const galaxy = useQuery({ queryKey: [...applicationQueryKey(companyId), "galaxy", kind, cursors.at(-1)],
    queryFn: () => managedApplicationsApi.galaxy(companyId, kind, cursors.at(-1)) });
  const work = useQuery({ queryKey: [...applicationQueryKey(companyId), applicationId, "work", projectId, agentId, offset],
    queryFn: () => managedApplicationsApi.work(companyId, applicationId, offset, projectId || undefined, agentId || undefined), enabled: !!applicationId });
  const agents = useQuery({ queryKey: queryKeys.agents.list(companyId), queryFn: () => agentsApi.list(companyId) });
  const runs = useQuery({ queryKey: queryKeys.liveRuns(companyId), queryFn: () => heartbeatsApi.liveRunsForCompany(companyId) });
  const galaxyData = galaxy.error ? undefined : galaxy.data;
  const workData = work.error ? undefined : work.data;
  const running = new Set((runs.error ? [] : runs.data ?? []).filter(run => run.status === "running" && run.issueId).map(run => run.issueId!));
  const application = applicationId ? workData?.application : null;
  const tasks = applicationId ? workData?.tasks ?? [] : galaxyData?.tasks ?? [];
  const projects = applicationId ? (workData?.projects ?? []).filter(project => !projectId || project.id === projectId) : [];
  const focus = (app = "", project = "", agent = "") => { setApplicationId(app); setProjectId(project); setAgentId(agent); setTaskId(""); setOffset(0); setView({ x: 0, y: 0, zoom: 1 }); };
  const parents = applicationId ? projects.map(project => ({ id: project.id, name: project.name, ...galaxyPoint(project.id, projects.length === 1 ? 0 : 260) }))
    : (galaxyData?.applications ?? []).map(app => ({ id: app.id, name: app.name, ...galaxyPoint(app.id, 330) }));
  const positions = new Map(parents.map(parent => [parent.id, parent]));
  const taskParent = (task: typeof tasks[number]) => applicationId ? task.projectId ?? "" : "applicationId" in task ? String(task.applicationId) : "";
  const chosenTask = tasks.find(task => task.id === taskId);
  const chosenAgents = workData?.agentWork ?? [];
  const agentPositions = new Map(chosenAgents.filter(row => !agentId || row.agentId === agentId)
    .map(row => [row.agentId, galaxyPoint(`agent:${row.agentId}`, 390)]));
  const width = 1000 / view.zoom, height = 600 / view.zoom;
  const count = applicationId ? Object.values(workData?.counts ?? {}).reduce((sum, value) => sum + value, 0)
    : Object.values(galaxyData?.summaries ?? {}).reduce((sum, summary) => sum + Object.values(summary.taskCounts).reduce((n, value) => n + value, 0), 0);
  const error = galaxy.error ?? work.error ?? agents.error ?? runs.error;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">{application?.name ?? (kind === "platform" ? "Platform development" : "Application galaxy")}</h2>
      <select aria-label="Portfolio scope" className="rounded-md border bg-background px-3 py-2 text-sm" value={kind} onChange={event => { setKind(event.target.value as typeof kind); setCursors([]); focus(); }}><option value="application">Applications</option><option value="platform">Platform development</option></select>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error.message} <Button variant="ghost" onClick={() => { void galaxy.refetch(); if (applicationId) void work.refetch(); void runs.refetch(); void agents.refetch(); }}>Retry</Button></p>}
    {(galaxy.isPending || applicationId && work.isPending) && <p className="text-sm text-muted-foreground">Reading saved work…</p>}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-2">{applicationId && <Button variant="outline" size="sm" onClick={() => projectId || agentId ? focus(applicationId) : focus()}><ArrowLeft />{projectId || agentId ? "Whole application" : "All applications"}</Button>}{application && <Button variant="outline" size="sm" asChild><Link to={`/applications/${application.id}`}>Kanban & details</Link></Button>}</div>
      <div className="flex gap-1"><Button variant="outline" size="icon" aria-label="Zoom out" onClick={() => setView(v => ({ ...v, zoom: Math.max(0.5, v.zoom / 1.3) }))}><Minus /></Button><Button variant="outline" size="icon" aria-label="Zoom in" onClick={() => setView(v => ({ ...v, zoom: Math.min(6, v.zoom * 1.3) }))}><Plus /></Button><Button variant="outline" size="icon" aria-label="Fit galaxy" onClick={() => setView({ x: 0, y: 0, zoom: 1 })}><Maximize /></Button></div>
    </div>
    <svg className="agentos-work-map rounded-xl border bg-card" role="group" aria-label="Live portfolio galaxy" viewBox={`${500 - width / 2 + view.x} ${300 - height / 2 + view.y} ${width} ${height}`}
      onPointerDown={event => { if ((event.target as Element).closest("a")) return; drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (!drag.current) return; const rect = event.currentTarget.getBoundingClientRect(); const dx = (event.clientX - drag.current.x) * width / rect.width, dy = (event.clientY - drag.current.y) * height / rect.height; drag.current = { x: event.clientX, y: event.clientY }; setView(v => ({ ...v, x: v.x - dx, y: v.y - dy })); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onWheel={event => { if (!event.ctrlKey) return; event.preventDefault(); setView(v => ({ ...v, zoom: Math.max(0.5, Math.min(6, v.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15))) })); }}>
      {tasks.map(task => {
        const parent = positions.get(taskParent(task)); if (!parent) return null;
        const point = galaxyPoint(task.id, applicationId && projects.length === 1 ? 220 : 90, parent);
        const assignee = task.assigneeAgentId ? agentPositions.get(task.assigneeAgentId) : null;
        return <g key={`${parent.id}:${task.id}`}><line x1={parent.x} y1={parent.y} x2={point.x} y2={point.y} className="agentos-map-edge" />
          {assignee && <line x1={assignee.x} y1={assignee.y} x2={point.x} y2={point.y} className="agentos-map-assignment" data-running={running.has(task.id)} />}
          <a href={`#task-${task.id}`} aria-label={`${task.title}: ${task.status}`} onClick={event => { event.preventDefault(); setTaskId(task.id); }}><circle cx={point.x} cy={point.y} className="agentos-map-task" data-status={task.status} data-running={running.has(task.id)} data-selected={task.id === taskId} /><title>{task.identifier} · {task.title} · {task.status.replaceAll("_", " ")}</title></a></g>;
      })}
      {parents.map(parent => <a key={parent.id} href={`#focus-${parent.id}`} aria-label={`Focus ${parent.name}`} onClick={event => { event.preventDefault(); applicationId ? focus(applicationId, parent.id) : focus(parent.id); }}><circle cx={parent.x} cy={parent.y} className="agentos-map-project" /><text x={parent.x} y={parent.y + 24} className="agentos-map-label" textAnchor="middle">{parent.name}</text></a>)}
      {[...agentPositions].map(([id, position]) => {
        const agent = agents.data?.find(item => item.id === id);
        const name = agent?.name ?? "Assigned agent";
        return <a key={`agent:${id}`} href={`#agent-${id}`} aria-label={`Focus agent ${name}`} onClick={event => { event.preventDefault(); focus(applicationId, projectId, agentId === id ? "" : id); }}><circle cx={position.x} cy={position.y} className="agentos-map-agent" /><text x={position.x} y={position.y + 4} className="agentos-map-label" textAnchor="middle">{name.slice(0, 1)}</text><text x={position.x} y={position.y + 28} className="agentos-map-label" textAnchor="middle">{name}</text></a>;
      })}
    </svg>
    <p className="text-xs text-muted-foreground">{tasks.length} task dots shown · {count} saved task associations in this view. Pulse means an observed running execution. Select an application, project, or task to inspect it.</p>
    {galaxyData && <p className="text-xs text-muted-foreground">Observed {new Date(applicationId ? work.dataUpdatedAt || galaxyData.observedAt : galaxyData.observedAt).toLocaleString()}. Positions stay tied to record identity.</p>}
    {!applicationId && galaxyData?.tasksTruncated && <p className="text-sm text-muted-foreground">The overview is capped at 500 task dots. Open an application for all of its work and pagination.</p>}
    {!applicationId && !galaxy.isPending && !galaxy.error && parents.length === 0 && <p className="text-sm text-muted-foreground">{kind === "platform" ? "No internal platform work is registered." : "No applications yet. Tell Friday about a repository or new idea, or add one in the portfolio."}</p>}
    {chosenTask && <ApplicationTaskInspector key={chosenTask.id} task={chosenTask} />}
    {applicationId && <div className="space-y-2"><h3 className="text-sm font-medium">Leads and assigned agents</h3>{chosenAgents.map(row => { const agent = agents.data?.find(item => item.id === row.agentId); return <Button key={row.agentId} variant={agentId === row.agentId ? "default" : "outline"} size="sm" onClick={() => focus(applicationId, projectId, agentId === row.agentId ? "" : row.agentId)}>{agent?.name ?? "Assigned agent"} · {row.taskCounts.done ?? 0} done · {row.taskCounts.blocked ?? 0} blocked</Button>; })}{!chosenAgents.length && <p className="text-xs text-muted-foreground">No leads or agent assignments recorded.</p>}</div>}
    {!applicationId && !agents.error && <details className="space-y-2"><summary className="cursor-pointer text-sm font-medium">Organization agents · {agents.data?.length ?? 0}</summary><div className="space-y-2">{agents.data?.map(agent => { const active = runs.error ? [] : (runs.data ?? []).filter(run => run.agentId === agent.id && run.status === "running"); return <div key={agent.id} className="flex items-center justify-between gap-2 text-sm"><Link className="text-primary" to={`/agents/${agent.id}`}>{agent.name}</Link><span className="text-xs text-muted-foreground">{active.length ? `${active.length} observed running` : agent.status.replaceAll("_", " ")}</span></div>; })}<Link to="/projects" className="block text-sm text-primary">All native projects, including work outside the application registry →</Link></div></details>}
    <div className="flex justify-between gap-2">{applicationId ? <><Button variant="outline" size="sm" disabled={!offset} onClick={() => { setOffset(Math.max(0, offset - 100)); setTaskId(""); }}>Previous tasks</Button><Button variant="outline" size="sm" disabled={workData?.nextOffset == null} onClick={() => { setOffset(workData!.nextOffset!); setTaskId(""); }}>Next tasks</Button></> : <><Button variant="outline" size="sm" disabled={!cursors.length} onClick={() => { setCursors(values => values.slice(0, -1)); setTaskId(""); }}>Previous applications</Button><Button variant="outline" size="sm" disabled={!galaxyData?.nextCursor} onClick={() => { setCursors(values => [...values, galaxyData!.nextCursor!]); setTaskId(""); }}>Next applications</Button></>}</div>
  </div>;
}
