import { useQuery } from "@tanstack/react-query";
import type { ApplicationWork } from "@paperclipai/shared";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { Link } from "../lib/router";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export function ApplicationTaskInspector({ task }: { task: ApplicationWork["tasks"][number] }) {
  const run = useQuery({ queryKey: queryKeys.issues.activeRun(task.id), queryFn: () => heartbeatsApi.activeRunForIssue(task.id) });
  const products = useQuery({ queryKey: queryKeys.issues.workProducts(task.id), queryFn: () => issuesApi.listWorkProducts(task.id) });
  const observedAt = run.data?.lastEventAt ?? run.data?.currentStatusUpdatedAt ?? run.data?.startedAt;
  return <Card>
    <CardHeader><p className="text-xs text-muted-foreground">{task.identifier} · {task.status.replaceAll("_", " ")}</p><CardTitle>{task.title}</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {run.isLoading && <p className="text-sm text-muted-foreground">Loading execution…</p>}
      {[run.error, products.error].filter(Boolean).map((error, index) => <p role="alert" key={index} className="text-sm text-destructive">{error!.message}</p>)}
      {run.data ? <div className="space-y-2 text-sm">
        <p><Link className="text-primary" to={`/agents/${run.data.agentId}`}>{run.data.agentName}</Link> · {run.data.status.replaceAll("_", " ")}</p>
        {run.data.currentStatusMessage && <p>{run.data.currentStatusMessage}</p>}
        {run.data.currentToolName && <p>Current tool: {run.data.currentToolName}</p>}
        {run.data.nextAction && <p>Next action: {run.data.nextAction}</p>}
        {observedAt && <p className="text-xs text-muted-foreground">Last observed {new Date(observedAt).toLocaleString()}</p>}
        <Link className="text-primary" to={`/agents/${run.data.agentId}/runs/${run.data.id}`}>Inspect this run →</Link>
      </div> : !run.isLoading && !run.error && <p className="text-sm text-muted-foreground">No active run reported. The task's saved status may include waiting or review.</p>}
      <div className="space-y-2"><h3 className="text-sm font-medium">Recorded outputs</h3>
        {products.data?.map(product => <div key={product.id} className="text-sm"><Link to={`/issues/${task.identifier ?? task.id}`} className="text-primary">{product.title}</Link><span className="ml-2 text-muted-foreground">{product.type} · {product.status} · {product.reviewState}</span></div>)}
        {products.data?.length === 0 && <p className="text-sm text-muted-foreground">No work products recorded yet.</p>}
      </div>
      <Link to={`/issues/${task.identifier ?? task.id}`} className="text-sm font-medium text-primary">Open task, plan, history, and outputs →</Link>
    </CardContent>
  </Card>;
}
