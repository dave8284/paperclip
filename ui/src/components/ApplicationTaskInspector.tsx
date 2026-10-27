import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApplicationWork } from "@paperclipai/shared";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { MarkdownBody } from "./MarkdownBody";
import { Link } from "../lib/router";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export function ApplicationTaskInspector({ task }: { task: ApplicationWork["tasks"][number] }) {
  const record = useQuery({ queryKey: queryKeys.issues.detail(task.id), queryFn: () => issuesApi.get(task.id) });
  const comments = useQuery({ queryKey: [...queryKeys.issues.comments(task.id), "inspector"], queryFn: () => issuesApi.listComments(task.id, { order: "desc", limit: 20 }) });
  const documents = useQuery({ queryKey: queryKeys.issues.documents(task.id), queryFn: () => issuesApi.listDocuments(task.id) });
  const run = useQuery({ queryKey: queryKeys.issues.activeRun(task.id), queryFn: () => heartbeatsApi.activeRunForIssue(task.id) });
  const products = useQuery({ queryKey: queryKeys.issues.workProducts(task.id), queryFn: () => issuesApi.listWorkProducts(task.id) });
  const observedAt = run.data?.lastEventAt ?? run.data?.currentStatusUpdatedAt ?? run.data?.startedAt;
  return <Card>
    <CardHeader><p className="text-xs text-muted-foreground">{task.identifier} · {task.status.replaceAll("_", " ")}</p><CardTitle>{task.title}</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {run.isLoading && <p className="text-sm text-muted-foreground">Loading execution…</p>}
      {[run.error, products.error, record.error, comments.error, documents.error].filter(Boolean).map((error, index) => <p role="alert" key={index} className="text-sm text-destructive">{error!.message}</p>)}
      {record.data?.description && <section className="space-y-2"><h3 className="text-sm font-semibold">What needs to happen</h3><MarkdownBody>{record.data.description}</MarkdownBody></section>}
      {!!documents.data?.length && <section className="space-y-2"><h3 className="text-sm font-semibold">Plans and documents</h3>{documents.data.map(document => <TaskDocument key={document.key} taskId={task.id} documentKey={document.key} title={document.title ?? document.key} />)}</section>}
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
      {!!comments.data?.length && <section className="space-y-4"><h3 className="text-sm font-semibold">Recent work and outcomes</h3>{comments.data.map(comment => <article key={comment.id} className="space-y-2 border-b pb-4"><time className="text-xs text-muted-foreground">{new Date(comment.createdAt).toLocaleString()}</time><MarkdownBody>{comment.body}</MarkdownBody></article>)}</section>}
      <Link to={`/issues/${task.identifier ?? task.id}`} className="text-sm font-medium text-primary">Open task, plan, history, and outputs →</Link>
    </CardContent>
  </Card>;
}

function TaskDocument({ taskId, documentKey, title }: { taskId: string; documentKey: string; title: string }) {
  const [open, setOpen] = useState(false);
  const document = useQuery({ queryKey: queryKeys.issues.document(taskId, documentKey), queryFn: () => issuesApi.getDocument(taskId, documentKey), enabled: open });
  return <details className="rounded-lg border p-3" onToggle={event => setOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">{title}</summary>{document.error && <p role="alert">{document.error.message}</p>}{document.data && <div className="pt-3"><MarkdownBody>{document.data.body}</MarkdownBody></div>}</details>;
}
