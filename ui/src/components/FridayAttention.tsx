import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, AttentionItem } from "@paperclipai/shared";
import { attentionApi } from "../api/attention";
import { authApi } from "../api/auth";
import { inboxDismissalsApi } from "../api/inboxDismissals";
import { queryKeys } from "../lib/queryKeys";
import { AttentionQueueRow } from "./AttentionQueueRow";
import { Button } from "./ui/button";

export function useFridayAttention(companyId: string, projectId?: string, cursor?: string) {
  return useQuery({ queryKey: [...queryKeys.attention(companyId), "friday", projectId ?? null, cursor ?? null],
    queryFn: () => attentionApi.list(companyId, { projectId, cursor, limit: 50, sort: "decide" }), staleTime: 15_000 });
}

export function FridayAttention({ companyId, projectId, agents, onProject, onAsk, compact = false, assistantName = "Friday" }: {
  companyId: string; projectId?: string; agents: Agent[]; onProject: (id: string) => void;
  onAsk: (text: string) => void; compact?: boolean; assistantName?: string;
}) {
  const client = useQueryClient();
  const [cursors, setCursors] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const feed = useFridayAttention(companyId, projectId, cursors.at(-1));
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: () => authApi.getSession() });
  const agentMap = useMemo(() => new Map(agents.map(agent => [agent.id, agent])), [agents]);
  const dismiss = useMutation({ mutationFn: (item: AttentionItem) => inboxDismissalsApi.dismiss(companyId, item.dismissalKey),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.attention(companyId) }) });
  const groups = new Map<string, { name: string; projectId: string | null; items: AttentionItem[] }>();
  const items = feed.error ? [] : feed.data?.items ?? [];
  for (const item of compact ? items.slice(0, 3) : items) {
    const key = item.project?.id ?? "organization";
    const group = groups.get(key) ?? { name: item.project?.name ?? "Across the workspace", projectId: item.project?.id ?? null, items: [] };
    group.items.push(item); groups.set(key, group);
  }
  return <div className="space-y-4" aria-label="Project attention dashboard">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Needs your attention</h3><p className="text-xs text-muted-foreground">{feed.data && !feed.error ? `${feed.data.totalCount} current decisions and blockers` : "Reading current decisions…"}</p></div>
      <Button variant="ghost" size="sm" onClick={() => void feed.refetch()}>Refresh</Button></div>
    {(feed.error || dismiss.error) && <p role="alert" className="text-sm text-destructive">{feed.error?.message ?? dismiss.error?.message}</p>}
    {!feed.isPending && !feed.error && !items.length && <p className="text-sm text-muted-foreground">No decisions or blockers currently need your attention. New ones appear here automatically.</p>}
    {[...groups].map(([key, group]) => <section key={key} className="space-y-2">
      <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-medium text-muted-foreground">{group.name}</h4>{group.projectId && <Button variant="ghost" size="sm" onClick={() => onProject(group.projectId!)}>See project</Button>}</div>
      {group.items.map(item => <div key={item.id} className="rounded-lg border bg-background">
        <AttentionQueueRow item={item} companyId={companyId} expanded={expanded === item.id} onToggleExpand={next => setExpanded(current => current === next.id ? null : next.id)}
          onDismiss={item => { if (!dismiss.isPending) dismiss.mutate(item); }} agentMap={agentMap} agents={agents} currentUserId={session.data?.user?.id ?? session.data?.session?.userId ?? null} />
        <div className="px-3 pb-2"><Button variant="ghost" size="sm" onClick={() => onAsk(`Explain this current decision and recommend the next step. Re-read its native source before acting: ${item.subject.href ?? item.subject.id}. Attention record: ${item.id}. ${item.whyNow}`)}>Discuss with {assistantName}</Button></div>
      </div>)}
    </section>)}
    {!compact && <div className="flex items-center justify-between gap-2"><Button variant="outline" size="sm" disabled={!cursors.length} onClick={() => { setCursors(value => value.slice(0, -1)); setExpanded(null); }}>Previous</Button><Button variant="outline" size="sm" disabled={!feed.data?.nextCursor || !!feed.error} onClick={() => { setCursors(value => [...value, feed.data!.nextCursor!]); setExpanded(null); }}>Next decisions</Button></div>}
    {feed.data && !feed.error && <p className="text-xs text-muted-foreground">Updated {new Date(feed.data.generatedAt).toLocaleTimeString()} · decisions retain their native permissions and revision checks.</p>}
  </div>;
}
