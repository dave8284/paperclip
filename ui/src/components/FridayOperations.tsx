import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { activityApi } from "../api/activity";
import { artifactsApi } from "../api/artifacts";
import { routinesApi } from "../api/routines";
import { fridayKey } from "../api/friday";
import { Link } from "../lib/router";
import type { FridayNavigation } from "../lib/friday-navigation";
import { Button } from "./ui/button";

export function FridayOperations({ companyId, agents, view, onAsk, assistantName = "Friday" }: { companyId: string; agents: Agent[]; view: FridayNavigation; onAsk: (text: string) => void; assistantName?: string }) {
  const client = useQueryClient();
  const [cursors, setCursors] = useState<string[]>([]);
  const routines = useQuery({ queryKey: [...fridayKey(companyId), "routines", view.projectId], queryFn: () => routinesApi.list(companyId, { projectId: view.projectId }), enabled: view.panel === "routines" });
  const artifacts = useQuery({ queryKey: [...fridayKey(companyId), "artifacts", view.projectId, view.agentId, cursors.at(-1)], queryFn: () => artifactsApi.list(companyId, { projectId: view.projectId, agentId: view.agentId, cursor: cursors.at(-1), limit: 30 }), enabled: view.panel === "artifacts" });
  const activity = useQuery({ queryKey: [...fridayKey(companyId), "activity", view.agentId], queryFn: () => activityApi.list(companyId, { agentId: view.agentId, limit: 100 }), enabled: view.panel === "activity" });
  const update = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => routinesApi.update(id, { status }), onSuccess: () => client.invalidateQueries({ queryKey: fridayKey(companyId) }) });
  const error = routines.error ?? artifacts.error ?? activity.error ?? update.error;
  return <div className="space-y-4">
    {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
    {view.panel === "routines" && <>
      <p className="text-sm text-muted-foreground">Each recurring operation has an owner, a trigger, and recorded runs. Friday can commission a lead to manage the loop.</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onAsk("Help me commission a recurring operating pipeline. Establish the objective, application/project, accountable lead, permitted actions, cadence or event triggers, success measures and escalation conditions. Reuse native routines and tasks. Identify missing provider connections; do not invent working integrations. Ask me for the missing objective first.")}>Create an operating loop</Button><Button size="sm" variant="ghost" onClick={() => onAsk("Help me plan an improvement to the Paperclip/AgentOS platform itself. Assign an engineering lead in the internal platform project, preserve active work, and propose implementation, verification, release and rollback scope. Ask what I want changed first.")}>Improve the platform</Button></div>
      {routines.isPending && <p className="text-sm text-muted-foreground">Reading routines…</p>}
      {!routines.error && routines.data?.filter(routine => !view.agentId || routine.assigneeAgentId === view.agentId).map(routine => <section key={routine.id} className="space-y-2 rounded-lg border p-4"><div className="flex items-center justify-between gap-2"><Link className="text-sm font-semibold" to={`/routines/${routine.id}`}>{routine.title}</Link><span className="text-xs text-muted-foreground">{routine.status}</span></div><p className="text-xs text-muted-foreground">{agents.find(agent => agent.id === routine.assigneeAgentId)?.name ?? "No agent assigned"} · {routine.concurrencyPolicy.replaceAll("_", " ")}</p>
        {routine.triggers.map(trigger => <p className="text-xs text-muted-foreground" key={trigger.id}>{trigger.label ?? trigger.kind} · {trigger.enabled ? "enabled" : "disabled"}{trigger.nextRunAt ? ` · next ${new Date(trigger.nextRunAt).toLocaleString()}` : ""}</p>)}
        {routine.activeIssue && <Link className="block text-sm text-primary" to={`/issues/${routine.activeIssue.identifier ?? routine.activeIssue.id}`}>Current work: {routine.activeIssue.title}</Link>}
        <div className="flex gap-2">{routine.status !== "archived" && <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate({ id: routine.id, status: routine.status === "active" ? "paused" : "active" })}>{routine.status === "active" ? "Pause routine" : "Resume routine"}</Button>}<Button size="sm" variant="ghost" onClick={() => onAsk(`Inspect routine ${routine.id}, its latest runs and outputs. Explain what it is doing, whether it is meeting its objective, and any blocker. Do not change its schedule without an agreed scope.`)}>Discuss with {assistantName}</Button></div>
      </section>)}
      {routines.data?.length === 0 && <p className="text-sm text-muted-foreground">No routines in this scope yet.</p>}
    </>}
    {view.panel === "artifacts" && <>
      {artifacts.isPending && <p className="text-sm text-muted-foreground">Reading recorded outputs…</p>}
      {!artifacts.error && artifacts.data?.artifacts.map(artifact => <Link key={artifact.id} to={artifact.href} className="friday-work-task"><span className="block text-sm font-medium">{artifact.title}</span><span className="block text-xs text-muted-foreground">{artifact.project?.name ?? "Workspace"} · {artifact.createdByAgent?.name ?? "Recorded output"} · {artifact.mediaKind}</span>{artifact.previewText && <span className="mt-2 block text-sm text-muted-foreground">{artifact.previewText.slice(0, 180)}</span>}</Link>)}
      {artifacts.data?.artifacts.length === 0 && <p className="text-sm text-muted-foreground">No outputs recorded in this scope yet.</p>}
      <div className="flex justify-between gap-2"><Button size="sm" variant="outline" disabled={!cursors.length} onClick={() => setCursors(value => value.slice(0, -1))}>Previous</Button><Button size="sm" variant="outline" disabled={!artifacts.data?.nextCursor || !!artifacts.error} onClick={() => setCursors(value => [...value, artifacts.data!.nextCursor!])}>More outputs</Button></div>
    </>}
    {view.panel === "activity" && <>
      <p className="text-sm text-muted-foreground">Recent recorded actions, linked to their source. Friday’s conversation retains your requests and the full responses.</p>
      {activity.isPending && <p className="text-sm text-muted-foreground">Reading the audit trail…</p>}
      {!activity.error && activity.data?.map(event => <div key={event.id} className="friday-work-task"><div className="flex flex-wrap justify-between gap-2"><span className="text-sm">{event.action.replaceAll("_", " ").replaceAll(".", " · ")}</span><time className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</time></div><p className="text-xs text-muted-foreground">{agents.find(agent => agent.id === event.agentId)?.name ?? event.actorType} · {event.entityType}</p>
        {event.entityType === "issue" && <Link className="text-xs text-primary" to={`/issues/${event.entityId}`}>Inspect task and evidence</Link>}{event.entityType === "project" && <Link className="text-xs text-primary" to={`/projects/${event.entityId}`}>Inspect project</Link>}
      </div>)}
      <Link className="block text-sm text-primary" to="/activity">Open the full searchable audit trail →</Link>
    </>}
  </div>;
}
