import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { attentionApi } from "../api/attention";
import { queryKeys } from "../lib/queryKeys";
import { Link } from "@/lib/router";
import { Button } from "./ui/button";

/** Native blockers remain visible as work, without inventing a binary decision. */
export function FridayWorkBlockers({ companyId, projectId, onTask }: { companyId: string; projectId?: string; onTask: (id: string) => void }) {
  const [cursors, setCursors] = useState<string[]>([]);
  useEffect(() => setCursors([]), [companyId, projectId]);
  const cursor = cursors.at(-1);
  const feed = useQuery({ queryKey: [...queryKeys.attention(companyId), "friday", "work", projectId ?? null, cursor ?? null], queryFn: () => attentionApi.list(companyId, { category: "work", projectId, cursor, limit: 10, sort: "decide" }), staleTime: 15_000 });
  if (feed.error) return <p role="alert" className="text-sm text-destructive">Work attention unavailable: {feed.error.message}</p>;
  if (!feed.data?.totalCount) return null;
  return <section className="space-y-3" aria-label="Work needing attention">
    <div><h3 className="text-sm font-semibold">Work needing attention</h3><p className="text-xs text-muted-foreground">{feed.data.totalCount} work items in this {projectId ? "project" : "company"}. Proposals ready for approval are in Decisions.</p></div>
    <div className="divide-y rounded-lg border">{feed.data.items.map(item => {
      const taskId = item.relatedIssue?.id ?? (item.subject.kind === "issue" ? item.subject.id : undefined);
      return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.subject.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.whyNow}</p></div>
        {taskId ? <Button size="sm" variant="outline" onClick={() => onTask(taskId)}>View task</Button> : item.subject.href ? <Link to={item.subject.href} className="text-sm text-primary underline">View source</Link> : null}
      </div>;
    })}</div>
    {(cursors.length > 0 || feed.data.nextCursor) && <div className="flex justify-between gap-2"><Button variant="ghost" size="sm" disabled={!cursors.length} onClick={() => setCursors(previous => previous.slice(0, -1))}>Previous work items</Button><Button variant="ghost" size="sm" disabled={!feed.data.nextCursor} onClick={() => setCursors(previous => [...previous, feed.data!.nextCursor!])}>More work items</Button></div>}
  </section>;
}
