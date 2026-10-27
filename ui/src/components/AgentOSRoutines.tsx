import { useEffect, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, RoutineListItem } from "@paperclipai/shared";
import { routinesApi } from "@/api/routines";
import { projectsApi } from "@/api/projects";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { fridayKey } from "@/api/friday";
import { Link } from "@/lib/router";
import { MarkdownBody } from "./MarkdownBody";
import { RoutineWorkflow } from "./RoutineWorkflow";
import { RoutineWorkflowEditor } from "./RoutineWorkflowEditor";
import { setFridayDisplaySelection } from "@/lib/friday-display-context";
import { Button } from "./ui/button";

export function AgentOSRoutines({ companyId, projectId, agentId, agents, onAsk }: { companyId: string; projectId?: string; agentId?: string; agents: Agent[]; onAsk: (text: string) => void }) {
  const client = useQueryClient();
  const [creating, setCreating] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState(""), [objective, setObjective] = useState(""), [lead, setLead] = useState("");
  const [project, setProject] = useState(projectId ?? ""), [cadence, setCadence] = useState("manual");
  const routines = useQuery({ queryKey: [...fridayKey(companyId), "routines", projectId], queryFn: () => routinesApi.list(companyId, { projectId }) });
  const projects = useQuery({ queryKey: queryKeys.projects.list(companyId), queryFn: () => projectsApi.list(companyId), enabled: creating });
  const refresh = () => client.invalidateQueries({ queryKey: fridayKey(companyId) });
  const update = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => routinesApi.update(id, { status }), onSuccess: refresh });
  const [createdDraftId, setCreatedDraftId] = useState<string | null>(null);
  const create = useMutation({ mutationFn: async () => {
    // A failed trigger setup leaves one recoverable paused draft, not a second loop.
    let id = createdDraftId;
    if (!id) { const routine = await routinesApi.create(companyId, { projectId: project || null, title, description: objective, assigneeAgentId: lead || null, status: "paused", concurrencyPolicy: "coalesce_if_active" }); id = routine.id; setCreatedDraftId(id); }
    if (cadence !== "manual") {
      const saved = await routinesApi.get(id);
      if (!saved.triggers.some(trigger => trigger.kind === "schedule" && trigger.cronExpression === cadence)) await routinesApi.createTrigger(id, { kind: "schedule", cronExpression: cadence, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, enabled: true });
    }
    return id;
  }, onSuccess: async id => { setCreating(false); setCreatedDraftId(null); setTitle(""); setObjective(""); setSelected(id); await refresh(); } });
  const rows = (routines.data ?? []).filter(routine => !agentId || routine.assigneeAgentId === agentId);
  const chosen = rows.find(routine => routine.id === selected);
  const related = chosen?.parentIssueId ? rows.filter(routine => routine.id !== chosen.id && routine.parentIssueId === chosen.parentIssueId) : [];
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm text-muted-foreground">Each loop creates recorded work, keeps its outputs and returns at its next trigger. Open a cycle to follow its tasks and outcomes.</p><Button onClick={() => setCreating(value => !value)}>Create loop</Button></div>
    {[routines.error, projects.error, create.error, update.error].filter(Boolean).map((error, i) => <p role="alert" className="text-destructive" key={i}>{error!.message}</p>)}
    {creating && <form className="space-y-4 rounded-xl border p-5" onSubmit={event => { event.preventDefault(); create.mutate(); }}><h2 className="text-lg font-semibold">A new operating loop</h2><label className="block text-sm">Name<input required maxLength={200} className="mt-2 w-full rounded-lg border bg-background p-3" disabled={!!createdDraftId} value={title} onChange={event => setTitle(event.target.value)} /></label><label className="block text-sm">Objective, steps and success measures<textarea required className="mt-2 w-full rounded-lg border bg-background p-3" disabled={!!createdDraftId} value={objective} onChange={event => setObjective(event.target.value)} placeholder="For example: review campaign feedback, propose improvements, request approval to publish, record the new version and measure its results." /></label><div className="grid gap-4 md:grid-cols-3"><label className="text-sm">Project<select className="mt-2 w-full rounded-lg border bg-background p-3" value={project} disabled={!!projectId || !!createdDraftId} onChange={event => setProject(event.target.value)}><option value="">Company-wide</option>{projects.data?.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label className="text-sm">Accountable lead<select required className="mt-2 w-full rounded-lg border bg-background p-3" value={lead} disabled={!!createdDraftId} onChange={event => setLead(event.target.value)}><option value="">Choose an employee</option>{agents.filter(agent => !["terminated", "pending_approval"].includes(agent.status)).map(agent => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></label><label className="text-sm">Cadence<select className="mt-2 w-full rounded-lg border bg-background p-3" value={cadence} onChange={event => setCadence(event.target.value)}><option value="manual">Manual</option><option value="0 * * * *">Hourly</option><option value="0 9 * * *">Daily at 9am</option><option value="0 9 * * 1">Monday at 9am</option></select></label></div><p className="text-xs text-muted-foreground">Saved paused so you can review the instructions before starting. Scheduled times use {Intl.DateTimeFormat().resolvedOptions().timeZone}. Publishing and financial actions retain their approval requirements.</p><div className="flex justify-between"><Button type="button" variant="ghost" onClick={() => { setCreating(false); void refresh(); }}>Close</Button><Button type="submit" disabled={create.isPending || !title.trim() || !objective.trim() || !lead}>{createdDraftId ? "Finish trigger setup" : "Save loop"}</Button></div></form>}
    {routines.isPending && <p role="status">Reading operating loops…</p>}
    {!rows.length && !routines.isPending && <p className="agentos-empty">No loops in this scope yet.</p>}
    <div className="agentos-project-grid">{rows.map(routine => <button type="button" className="agentos-loop-card" key={routine.id} aria-pressed={selected === routine.id} onClick={() => setSelected(routine.id)}><div className="flex justify-between gap-3"><span className="agentos-eyebrow">Operating loop</span><span className="agentos-pill">{routine.status}</span></div><h3>{routine.title}</h3><p>{agents.find(agent => agent.id === routine.assigneeAgentId)?.name ?? "Unassigned"}</p><div className="agentos-loop-mini" aria-hidden="true"><span data-active={!!routine.activeIssue}>Work</span><i>→</i><span>Evidence</span><i>↻</i><span>Next trigger</span></div><p>{routine.activeIssue ? `${routine.activeIssue.identifier ?? "Current task"} · ${routine.activeIssue.status.replaceAll("_", " ")}` : routine.lastRun ? `Last cycle: ${routine.lastRun.status.replaceAll("_", " ")}` : "No cycles yet"}</p></button>)}</div>
    {!!related.length && <section className="space-y-2" aria-label="Related operating loops"><h3 className="text-sm font-semibold">Loops with the same parent task</h3><p className="text-xs text-muted-foreground">These loops share an objective. Each keeps its own trigger and recorded cycles.</p><div className="flex flex-wrap gap-2">{related.map(routine => <Button key={routine.id} variant="outline" onClick={() => setSelected(routine.id)}>{routine.title}</Button>)}</div></section>}
    {chosen && <RoutineLoop key={chosen.id} routine={chosen} agents={agents} onClose={() => setSelected(null)} onToggle={() => update.mutate({ id: chosen.id, status: chosen.status === "active" ? "paused" : "active" })} busy={update.isPending} onAsk={onAsk} />}
  </div>;
}
function RoutineLoop({ routine, agents, onClose, onToggle, busy, onAsk }: { routine: RoutineListItem; agents: Agent[]; onClose: () => void; onToggle: () => void; busy: boolean; onAsk: (text: string) => void }) {
  const detail = useQuery({ queryKey: [...fridayKey(routine.companyId), "routine-detail", routine.id, routine.updatedAt], queryFn: () => routinesApi.get(routine.id) });
  const [cycle, setCycle] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ triggerId?: string } | null>(null);
  const runs = detail.data?.recentRuns ?? [];
  const current = runs.find(run => run.id === cycle) ?? runs[0];
  const taskId = current?.linkedIssueId ?? routine.activeIssue?.id;
  useEffect(() => { setFridayDisplaySelection(routine.companyId, "routines", { routineId: routine.id, ...(current?.id ? { cycleId: current.id } : {}), ...(taskId ? { taskId } : {}) }); }, [routine.companyId, routine.id, current?.id, taskId]);
  const tasks = useQuery({ queryKey: [...fridayKey(routine.companyId), "routine-tasks", taskId], queryFn: () => issuesApi.list(routine.companyId, { parentId: taskId!, includeAgentCreatedTasks: true, limit: 100 }), enabled: !!taskId });
  const root = useQuery({ queryKey: queryKeys.issues.detail(taskId ?? ""), queryFn: () => issuesApi.get(taskId!), enabled: !!taskId });
  const childOutputs = useQueries({ queries: (tasks.data ?? []).slice(0, 30).map(task => ({ queryKey: queryKeys.issues.workProducts(task.id), queryFn: () => issuesApi.listWorkProducts(task.id) })) });
  const outputs = useQuery({ queryKey: queryKeys.issues.workProducts(taskId ?? ""), queryFn: () => issuesApi.listWorkProducts(taskId!), enabled: !!taskId });
  const revisions = useQuery({ queryKey: [...fridayKey(routine.companyId), "routine-revisions", routine.id, routine.latestRevisionId], queryFn: () => routinesApi.listRevisions(routine.id) });
  const client = useQueryClient();
  const run = useMutation({ mutationFn: () => routinesApi.run(routine.id, { idempotencyKey: crypto.randomUUID() }), onSuccess: () => { void client.invalidateQueries({ queryKey: fridayKey(routine.companyId) }); void detail.refetch(); } });
  return <section className="space-y-5 rounded-xl border p-5" aria-label="Operating loop detail"><div className="flex flex-wrap justify-between gap-3"><h2 className="text-lg font-semibold">{routine.title}</h2><Button variant="ghost" onClick={onClose}>Close loop</Button></div>{[detail.error, root.error, tasks.error, outputs.error, ...childOutputs.map(query => query.error), revisions.error, run.error].filter(Boolean).map((error, i) => <p role="alert" className="text-destructive" key={i}>{error!.message}</p>)}
    <MarkdownBody>{routine.description ?? "No objective recorded."}</MarkdownBody>
    {detail.data?.parentIssue && <p className="text-sm">Parent objective: <Link className="text-primary" to={`/issues/${detail.data.parentIssue.id}`}>{detail.data.parentIssue.title}</Link></p>}
    {detail.data && <RoutineWorkflow key={current?.id ?? "definition"} routine={detail.data} cycle={current} task={root.data} tasks={tasks.data ?? []} outputs={[...(outputs.data ?? []), ...childOutputs.flatMap(query => query.data ?? [])]} agents={agents} onEdit={triggerId => setEditor({ triggerId })} />}
    {editor && detail.data && <RoutineWorkflowEditor key={editor.triggerId ?? "definition"} routine={detail.data} agents={agents} triggerId={editor.triggerId} onClose={() => setEditor(null)} />}

    {!!tasks.data?.length && <section className="space-y-2"><h3 className="text-sm font-semibold">Work breakdown · this cycle</h3>{tasks.data.map(task => <Link key={task.id} className="friday-work-task" to={`/issues/${task.identifier ?? task.id}`}><span>{task.title}</span><span className="text-xs text-muted-foreground">{task.status.replaceAll("_", " ")}</span></Link>)}</section>}
    {!!outputs.data?.length && <section className="space-y-2"><h3 className="text-sm font-semibold">Recorded outputs</h3>{outputs.data.map(output => <Link className="friday-work-task" key={output.id} to={`/issues/${taskId}`}><span>{output.title}</span><span className="text-xs text-muted-foreground">{output.status} · {output.reviewState}</span></Link>)}</section>}
    <div className="flex flex-wrap gap-3">{routine.status !== "archived" && <Button variant="outline" disabled={busy} onClick={onToggle}>{routine.status === "active" ? "Pause loop" : "Start loop"}</Button>}<Button variant="outline" disabled={run.isPending || routine.status !== "active"} onClick={() => run.mutate()}>Run one cycle</Button><Button variant="ghost" onClick={() => onAsk(`Review routine ${routine.id}, its recorded cycle ${current?.id ?? "history"}, outputs and feedback. Propose improvements and record changes as a new routine revision; retain output versions and approval gates.`)}>Review with Friday</Button><Button asChild variant="ghost"><Link to={`/routines/${routine.id}`}>Triggers and full history</Link></Button></div>
    <div className="overflow-x-auto"><table className="agentos-data-table"><caption className="text-left text-sm font-semibold">Recent cycles</caption><thead><tr><th>Started</th><th>Trigger</th><th>Result</th><th>Task</th></tr></thead><tbody>{runs.map(row => <tr key={row.id}><td><button type="button" onClick={() => setCycle(row.id)}>{new Date(row.triggeredAt).toLocaleString()}</button></td><td>{row.source}</td><td>{row.status.replaceAll("_", " ")}{row.failureReason && <p>{row.failureReason}</p>}</td><td>{row.linkedIssue && <Link to={`/issues/${row.linkedIssueId}`}>{row.linkedIssue.identifier ?? row.linkedIssue.title}</Link>}</td></tr>)}</tbody></table></div>
    {!!revisions.data?.length && <details><summary className="cursor-pointer text-sm">Loop definition history · {revisions.data.length} versions</summary><ol className="mt-3 space-y-3">{revisions.data.map(revision => <li key={revision.id} className="text-sm">Version {revision.revisionNumber} · {new Date(revision.createdAt).toLocaleString()}<p className="text-muted-foreground">{revision.changeSummary ?? "Definition updated"}</p></li>)}</ol></details>}
  </section>;
}
