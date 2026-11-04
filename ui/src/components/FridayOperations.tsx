import { AgentOSArtifactBrowser } from "./AgentOSArtifactBrowser";
import { AgentOSRoutines } from "./AgentOSRoutines";
import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { activityApi } from "../api/activity";
import { fridayKey } from "../api/friday";
import { Link } from "../lib/router";
import type { FridayNavigation } from "../lib/friday-navigation";

export function FridayOperations({ companyId, agents, view, onAsk, assistantName = "Friday" }: { companyId: string; agents: Agent[]; view: FridayNavigation; onAsk: (text: string) => void; assistantName?: string }) {
  const activity = useQuery({ queryKey: [...fridayKey(companyId), "activity", view.projectId, view.agentId], queryFn: () => activityApi.list(companyId, { projectId: view.projectId, agentId: view.agentId, limit: 100 }), enabled: view.panel === "activity" });
  const error = activity.error;
  return <div className="space-y-4">
    {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
    {view.panel === "routines" && <AgentOSRoutines companyId={companyId} projectId={view.projectId} agentId={view.agentId} agents={agents} onAsk={onAsk} />}
    {view.panel === "artifacts" && <AgentOSArtifactBrowser key={`${companyId}:${view.projectId ?? ""}:${view.agentId ?? ""}`} companyId={companyId} projectId={view.projectId} agentId={view.agentId} />}
    {view.panel === "activity" && <>
      <p className="text-sm text-muted-foreground">Recent recorded actions, linked to their source. Project scope includes the project and its readable tasks. Friday’s conversation retains your requests and the full responses.</p>
      {activity.isPending && <p className="text-sm text-muted-foreground">Reading the audit trail…</p>}
      {!activity.error && <div className="overflow-x-auto"><table className="agentos-data-table" aria-label="Audit trail"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>{activity.data?.map(event => <tr key={event.id}><td><time>{new Date(event.createdAt).toLocaleString()}</time></td><td>{agents.find(agent => agent.id === event.agentId)?.name ?? event.actorType}</td><td>{event.action.replaceAll("_", " ").replaceAll(".", " · ")}</td><td>{event.entityType === "issue" ? <Link to={`/issues/${event.entityId}`}>Task →</Link> : event.entityType === "project" ? <Link to={`/projects/${event.entityId}`}>Project →</Link> : event.entityType}</td><td>{event.details && <details><summary>View details</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(event.details, null, 2)}</pre></details>}</td></tr>)}</tbody></table>{activity.data?.length === 0 && <p className="agentos-empty">No recorded actions in this scope yet.</p>}</div>}
      <Link className="block text-sm text-primary" to="/activity">Open the full searchable audit trail →</Link>
    </>}
  </div>;
}
