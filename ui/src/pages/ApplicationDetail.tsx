import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applicationKickoffBrief, MANAGED_APPLICATION_STAGES } from "@paperclipai/shared";
import type { ManagedApplication } from "@paperclipai/shared";
import { Layers } from "lucide-react";
import { Link, useNavigate, useParams } from "../lib/router";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { managedApplicationsApi } from "../api/managed-applications";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { applicationQueryKey, useApplicationUpdates } from "../hooks/useApplicationUpdates";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { ApplicationWorkMap } from "../components/ApplicationWorkMap";
import { ApplicationTaskInspector } from "../components/ApplicationTaskInspector";
import { StatusBadge } from "../components/StatusBadge";

const lanes = ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"];
const label = (value: string) => value.replaceAll("_", " ");

export function ApplicationDetail() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [view, setView] = useState<"map" | "board" | "list">("map");
  const [projectId, setProjectId] = useState("");
  const [offset, setOffset] = useState(0);
  const [coordinatorId, setCoordinatorId] = useState("");
  const [linkProjectId, setLinkProjectId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  useApplicationUpdates(selectedCompanyId);
  useEffect(() => { setProjectId(""); setOffset(0); setSelectedTaskId(null); setCoordinatorId(""); }, [applicationId, selectedCompanyId]);
  const work = useQuery({
    queryKey: [...applicationQueryKey(selectedCompanyId), applicationId, "work", projectId, offset],
    queryFn: () => managedApplicationsApi.work(selectedCompanyId!, applicationId!, offset, projectId || undefined),
    enabled: !!selectedCompanyId && !!applicationId,
  });
  const agents = useQuery({ queryKey: queryKeys.agents.list(selectedCompanyId!), queryFn: () => agentsApi.list(selectedCompanyId!), enabled: !!selectedCompanyId });
  const liveRuns = useQuery({ queryKey: queryKeys.liveRuns(selectedCompanyId!), queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!), enabled: !!selectedCompanyId });
  const availableProjects = useQuery({ queryKey: queryKeys.projects.list(selectedCompanyId!), queryFn: () => projectsApi.list(selectedCompanyId!), enabled: !!selectedCompanyId });
  const application = work.data?.application;
  useEffect(() => { setBreadcrumbs([{ label: "Applications", href: "/applications" }, { label: application?.name ?? "Application" }]); }, [application?.name, setBreadcrumbs]);
  const refresh = () => client.invalidateQueries({ queryKey: applicationQueryKey(selectedCompanyId) });
  const kickoff = useMutation({
    mutationFn: () => issuesApi.create(selectedCompanyId!, {
      title: `Plan and operate ${application!.name}`, description: applicationKickoffBrief(application!),
      projectId: application!.homeProjectId, assigneeAgentId: coordinatorId,
      status: "todo", priority: "high", idempotencyKey: `agentos:${applicationId}:kickoff`,
    }),
    onSuccess: issue => { void refresh(); navigate(`/issues/${issue.identifier ?? issue.id}`); },
  });
  const stage = useMutation({ mutationFn: (next: ManagedApplication["stage"]) => managedApplicationsApi.update(selectedCompanyId!, applicationId!, { stage: next }), onSuccess: refresh });
  const link = useMutation({ mutationFn: () => managedApplicationsApi.linkProject(selectedCompanyId!, applicationId!, linkProjectId), onSuccess: () => { setLinkProjectId(""); void refresh(); } });
  if (!selectedCompanyId) return <EmptyState icon={Layers} message="Select an organization to view this application." />;
  if (work.isLoading) return <PageSkeleton variant="list" />;
  if (!work.data) return <div role="alert" className="space-y-3"><p>{work.error?.message ?? "Application unavailable."}</p><Button variant="outline" onClick={() => void work.refetch()}>Retry</Button><Link to="/applications">Back to applications</Link></div>;
  const { projects, tasks, counts } = work.data;
  const visibleProjects = projectId ? projects.filter(project => project.id === projectId) : projects;
  const selectedTask = tasks.find(task => task.id === selectedTaskId);
  const agentById = new Map((agents.data ?? []).map(agent => [agent.id, agent]));
  const assignedAgentIds = new Set(tasks.map(task => task.assigneeAgentId).filter((id): id is string => !!id));
  for (const project of projects) if (project.leadAgentId) assignedAgentIds.add(project.leadAgentId);
  const eligibleAgents = (agents.data ?? []).filter(agent => !["terminated", "pending_approval"].includes(agent.status));
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const errors = [work.error, agents.error, liveRuns.error, availableProjects.error, kickoff.error, stage.error, link.error].filter(Boolean);
  const runningTaskIds = new Set((liveRuns.error ? [] : liveRuns.data ?? []).filter(run => run.status === "running" && run.issueId).map(run => run.issueId!));
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><Link to="/applications" className="text-sm text-muted-foreground">← All applications</Link><h1 className="text-2xl font-semibold">{application!.name}</h1><p className="text-sm text-muted-foreground">{application!.source === "existing" ? "Existing application" : "New application"}</p></div>
      <label className="space-y-1 text-sm"><span className="block text-muted-foreground">Lifecycle</span><select aria-label="Application lifecycle" className="rounded-md border bg-background px-3 py-2" value={application!.stage} disabled={stage.isPending} onChange={event => stage.mutate(event.target.value as ManagedApplication["stage"])}>{MANAGED_APPLICATION_STAGES.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
    </div>
    {errors.map((error, index) => <p key={index} role="alert" className="text-sm text-destructive">{error!.message}</p>)}
    <Card><CardContent className="space-y-4 pt-6"><p className="whitespace-pre-wrap text-sm">{application!.brief}</p>
      <div className="flex flex-wrap items-center gap-3"><select aria-label="Planning coordinator" className="rounded-md border bg-background px-3 py-2 text-sm" value={coordinatorId} onChange={event => setCoordinatorId(event.target.value)}><option value="">Choose a coordinator</option>{eligibleAgents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.title ?? agent.role}</option>)}</select><Button disabled={!coordinatorId || kickoff.isPending} onClick={() => kickoff.mutate()}>{kickoff.isPending ? "Assigning…" : "Start planning"}</Button><Link to="/agents" className="text-sm text-primary">Manage agent pool</Link></div>
      <p className="text-xs text-muted-foreground">Assigns a real planning task to your coordinator. Its native task page shows the plan, execution, approvals, and outputs. Agent setup and budget limits still apply.</p>
    </CardContent></Card>
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[["Tasks", total], ["In progress", counts.in_progress ?? 0], ["Blocked", counts.blocked ?? 0], ["Completed", counts.done ?? 0]].map(([name, count]) => <Card key={name}><CardContent className="pt-6"><p className="text-2xl font-semibold">{count}</p><p className="text-sm text-muted-foreground">{name}</p></CardContent></Card>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-1" role="group" aria-label="Work view">{(["map", "board", "list"] as const).map(mode => <Button key={mode} variant={view === mode ? "default" : "outline"} onClick={() => setView(mode)}>{mode === "map" ? "Work map" : mode === "board" ? "Kanban" : "Task list"}</Button>)}</div>
      <select aria-label="Filter by project" className="rounded-md border bg-background px-3 py-2 text-sm" value={projectId} onChange={event => { setProjectId(event.target.value); setOffset(0); setSelectedTaskId(null); }}><option value="">All projects</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
    </div>
    {view === "map" && <ApplicationWorkMap projects={visibleProjects} tasks={tasks} selectedTaskId={selectedTaskId} runningTaskIds={runningTaskIds} onSelectTask={setSelectedTaskId} onSelectProject={id => { setProjectId(id); setOffset(0); setSelectedTaskId(null); }} />}
    {selectedTask && view === "map" && <ApplicationTaskInspector task={selectedTask} />}
    {view === "board" && <div className="flex gap-4 overflow-x-auto pb-4">{lanes.map(lane => <section key={lane} className="w-64 shrink-0 space-y-3"><h2 className="text-sm font-medium capitalize">{label(lane)} <span className="text-muted-foreground">{counts[lane] ?? 0}</span></h2>{tasks.filter(task => task.status === lane).map(task => <Card key={task.id}><CardContent className="space-y-2 pt-4"><p className="text-xs text-muted-foreground">{task.identifier}</p><Link to={`/issues/${task.identifier ?? task.id}`} className="block text-sm font-medium">{task.title}</Link><p className="text-xs text-muted-foreground">{task.assigneeAgentId ? agentById.get(task.assigneeAgentId)?.name ?? "Assigned agent" : "Unassigned"}</p></CardContent></Card>)}</section>)}</div>}
    {view === "list" && <Card><CardContent className="divide-y">{tasks.map(task => <div key={task.id} className="flex items-center justify-between gap-3 py-3"><Link to={`/issues/${task.identifier ?? task.id}`} className="text-sm"><span className="mr-3 text-muted-foreground">{task.identifier}</span>{task.title}</Link><StatusBadge status={task.status} /></div>)}</CardContent></Card>}
    {total === 0 && <p className="text-sm text-muted-foreground">No tasks yet. Start planning with a configured coordinator, or add work in the home project.</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">Showing {tasks.length ? offset + 1 : 0}–{offset + tasks.length} of {total} accessible tasks. Counts include all pages.</span><div className="flex gap-2"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</Button><Button variant="outline" disabled={work.data.nextOffset === null} onClick={() => setOffset(work.data!.nextOffset!)}>Next</Button></div></div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Projects</CardTitle></CardHeader><CardContent className="space-y-4">{projects.map(project => <div key={project.id} className="flex items-center justify-between gap-3"><Link to={`/projects/${project.id}`} className="text-sm text-primary">{project.name}</Link><span className="text-xs text-muted-foreground">{project.id === application!.homeProjectId ? "Home project" : label(project.status)}</span></div>)}<div className="flex flex-wrap gap-2"><select aria-label="Link existing project" className="rounded-md border bg-background px-3 py-2 text-sm" value={linkProjectId} onChange={event => setLinkProjectId(event.target.value)}><option value="">Link an existing project</option>{(availableProjects.data ?? []).filter(project => !projects.some(linked => linked.id === project.id)).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><Button variant="outline" disabled={!linkProjectId || link.isPending} onClick={() => link.mutate()}>Link project</Button></div><Link to="/projects" className="block text-sm text-primary">Create or manage projects →</Link></CardContent></Card>
      <Card><CardHeader><CardTitle>Team on this work</CardTitle></CardHeader><CardContent className="space-y-3">{[...assignedAgentIds].map(id => <div key={id} className="flex items-center justify-between gap-3"><Link to={`/agents/${id}`} className="text-sm text-primary">{agentById.get(id)?.name ?? "Assigned agent"}</Link><span className="text-xs text-muted-foreground">{agentById.get(id)?.title ?? agentById.get(id)?.role ?? ""}</span></div>)}{assignedAgentIds.size === 0 && <p className="text-sm text-muted-foreground">Agents appear here when assigned to the displayed tasks or project leadership.</p>}<p className="text-xs text-muted-foreground">Project leads and assignees on this page. Open an agent for its complete task and run history.</p><div className="flex flex-wrap gap-4 text-sm"><Link to="/routines" className="text-primary">Recurring work</Link><Link to="/apps" className="text-primary">Connections</Link><Link to="/dashboard/live" className="text-primary">Live execution</Link></div></CardContent></Card>
    </div>
    <p className="text-xs text-muted-foreground">Lifecycle describes the product stage. Pause or stop execution using the native project, task, and agent controls.</p>
  </div>;
}
