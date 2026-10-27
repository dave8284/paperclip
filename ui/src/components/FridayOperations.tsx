import { AgentOSArtifactDetail } from "./AgentOSArtifactDetail";
import type { CompanyArtifact } from "@paperclipai/shared";
import { AgentOSRoutines } from "./AgentOSRoutines";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { activityApi } from "../api/activity";
import { artifactsApi } from "../api/artifacts";
import { fridayKey } from "../api/friday";
import { Link } from "../lib/router";
import type { FridayNavigation } from "../lib/friday-navigation";
import { Button } from "./ui/button";

export function FridayOperations({ companyId, agents, view, onAsk, assistantName = "Friday" }: { companyId: string; agents: Agent[]; view: FridayNavigation; onAsk: (text: string) => void; assistantName?: string }) {
  const [selectedArtifact, setSelectedArtifact] = useState<CompanyArtifact | null>(null);
  const [search, setSearch] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const artifacts = useQuery({ queryKey: [...fridayKey(companyId), "artifacts", view.projectId, view.agentId, search, cursors.at(-1)], queryFn: () => artifactsApi.list(companyId, { projectId: view.projectId, agentId: view.agentId, q: search || undefined, cursor: cursors.at(-1), limit: 30 }), enabled: view.panel === "artifacts" });
  const activity = useQuery({ queryKey: [...fridayKey(companyId), "activity", view.projectId, view.agentId], queryFn: () => activityApi.list(companyId, { projectId: view.projectId, agentId: view.agentId, limit: 100 }), enabled: view.panel === "activity" });
  const error = artifacts.error ?? activity.error;
  return <div className="space-y-4">
    {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
    {view.panel === "routines" && <AgentOSRoutines companyId={companyId} projectId={view.projectId} agentId={view.agentId} agents={agents} onAsk={onAsk} />}
    {view.panel === "artifacts" && (selectedArtifact ? <AgentOSArtifactDetail key={selectedArtifact.id} artifact={selectedArtifact} onClose={() => setSelectedArtifact(null)} /> : <>
      <label className="block text-sm">Search artefacts<input className="mt-2 w-full rounded-lg border bg-background p-3" value={search} onChange={event => { setSearch(event.target.value); setCursors([]); }} placeholder="Find a document, file or recorded output…" /></label>
      {artifacts.isPending && <p className="text-sm text-muted-foreground">Reading recorded outputs…</p>}
      {!artifacts.error && artifacts.data?.artifacts.map(artifact => <button type="button" key={artifact.id} onClick={() => setSelectedArtifact(artifact)} className="friday-work-task"><span className="block text-sm font-medium">{artifact.title}</span><span className="block text-xs text-muted-foreground">{artifact.project?.name ?? "Workspace"} · {artifact.createdByAgent?.name ?? "Recorded output"} · {artifact.mediaKind}</span>{artifact.previewText && <span className="mt-2 block text-sm text-muted-foreground">{artifact.previewText.slice(0, 180)}</span>}</button>)}
      {artifacts.data?.artifacts.length === 0 && <p className="text-sm text-muted-foreground">No outputs recorded in this scope yet.</p>}
      <div className="flex justify-between gap-2"><Button size="sm" variant="outline" disabled={!cursors.length} onClick={() => setCursors(value => value.slice(0, -1))}>Previous</Button><Button size="sm" variant="outline" disabled={!artifacts.data?.nextCursor || !!artifacts.error} onClick={() => setCursors(value => [...value, artifacts.data!.nextCursor!])}>More outputs</Button></div>
    </>)}
    {view.panel === "activity" && <>
      <p className="text-sm text-muted-foreground">Recent recorded actions, linked to their source. Project scope includes the project and its readable tasks. Friday’s conversation retains your requests and the full responses.</p>
      {activity.isPending && <p className="text-sm text-muted-foreground">Reading the audit trail…</p>}
      {!activity.error && <div className="overflow-x-auto"><table className="agentos-data-table" aria-label="Audit trail"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>{activity.data?.map(event => <tr key={event.id}><td><time>{new Date(event.createdAt).toLocaleString()}</time></td><td>{agents.find(agent => agent.id === event.agentId)?.name ?? event.actorType}</td><td>{event.action.replaceAll("_", " ").replaceAll(".", " · ")}</td><td>{event.entityType === "issue" ? <Link to={`/issues/${event.entityId}`}>Task →</Link> : event.entityType === "project" ? <Link to={`/projects/${event.entityId}`}>Project →</Link> : event.entityType}</td><td>{event.details && <details><summary>View details</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(event.details, null, 2)}</pre></details>}</td></tr>)}</tbody></table>{activity.data?.length === 0 && <p className="agentos-empty">No recorded actions in this scope yet.</p>}</div>}
      <Link className="block text-sm text-primary" to="/activity">Open the full searchable audit trail →</Link>
    </>}
  </div>;
}
