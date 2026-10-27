import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, AttentionItem } from "@paperclipai/shared";
import { attentionApi } from "../api/attention";
import { authApi } from "../api/auth";
import { inboxDismissalsApi } from "../api/inboxDismissals";
import { queryKeys } from "../lib/queryKeys";
import { AttentionQueueRow } from "./AttentionQueueRow";
import { ApplicationTaskInspector } from "./ApplicationTaskInspector";
import { issuesApi } from "../api/issues";
import { setFridayDisplaySelection } from "@/lib/friday-display-context";
import { Button } from "./ui/button";

export function fridayDecisionContext(item: AttentionItem, companyId: string) {
  return `Company: ${companyId}. Project: ${item.project?.id ?? "company-wide"}. Decision: ${item.subject.title ?? item.id}. Attention record: ${item.id}. Native source (${item.sourceKind}): ${item.subject.href ?? item.subject.id}. Related task: ${item.relatedIssue?.href ?? item.relatedIssue?.id ?? "none"}. Reason: ${item.whyNow}. Re-read the source, consult the responsible project lead when more detail is needed, and preserve native permissions, approval requirements and revision checks.`;
}

export function useFridayAttention(companyId: string, projectId?: string, cursor?: string) {
  return useQuery({ queryKey: [...queryKeys.attention(companyId), "friday", projectId ?? null, cursor ?? null],
    queryFn: () => attentionApi.list(companyId, { projectId, cursor, limit: 50, sort: "decide" }), staleTime: 15_000 });
}

export function FridayAttention({ companyId, projectId, agents, onProject, onAsk, compact = false, decisionId, assistantName = "Friday" }: {
  companyId: string; projectId?: string; agents: Agent[]; onProject: (id: string) => void;
  onAsk: (text: string) => void; decisionId?: string; compact?: boolean; assistantName?: string;
}) {
  const client = useQueryClient();
  const [cursors, setCursors] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => { setExpanded(decisionId ?? null); }, [decisionId]);
  useEffect(() => { setCursors([]); setExpanded(decisionId ?? null); }, [companyId, projectId, decisionId]);
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
        <AttentionQueueRow presentation="agentos" item={item} companyId={companyId} inlineDetail={expanded === item.id ? <DecisionContext item={item} companyId={companyId} onAsk={onAsk} /> : null} expanded={expanded === item.id} onToggleExpand={next => { setExpanded(current => current === next.id ? null : next.id); setFridayDisplaySelection(companyId, "attention", { decisionId: next.id, sourceId: next.subject.id, ...(next.relatedIssue?.id ? { taskId: next.relatedIssue.id } : {}) }); }}
          onDismiss={item => { if (!dismiss.isPending) dismiss.mutate(item); }} agentMap={agentMap} agents={agents} currentUserId={session.data?.user?.id ?? session.data?.session?.userId ?? null} />
        <div className="px-3 pb-2"><Button variant="ghost" size="sm" onClick={() => { setFridayDisplaySelection(companyId, "attention", { decisionId: item.id, sourceId: item.subject.id, ...(item.relatedIssue?.id ? { taskId: item.relatedIssue.id } : {}) }); onAsk(`Explain this decision and recommend the next step. ${fridayDecisionContext(item, companyId)}`); }}>Discuss with {assistantName}</Button></div>
      </div>)}
    </section>)}
    {!compact && <div className="flex items-center justify-between gap-2"><Button variant="outline" size="sm" disabled={!cursors.length} onClick={() => { setCursors(value => value.slice(0, -1)); setExpanded(null); }}>Previous</Button><Button variant="outline" size="sm" disabled={!feed.data?.nextCursor || !!feed.error} onClick={() => { setCursors(value => [...value, feed.data!.nextCursor!]); setExpanded(null); }}>Next decisions</Button></div>}
    {feed.data && !feed.error && <p className="text-xs text-muted-foreground">Updated {new Date(feed.data.generatedAt).toLocaleTimeString()} · decisions retain their native permissions and revision checks.</p>}
  </div>;
}

function DecisionContext({ item, companyId, onAsk }: { item: AttentionItem; companyId: string; onAsk: (text: string) => void }) {
  const taskId = item.relatedIssue?.id ?? (item.subject.kind === "issue" ? item.subject.id : undefined);
  const task = useQuery({ queryKey: queryKeys.issues.detail(taskId ?? ""), queryFn: () => issuesApi.get(taskId!), enabled: !!taskId });
  const [alternative, setAlternative] = useState("");
  return <section className="space-y-4" aria-label="Decision context"><div><h3 className="text-sm font-semibold">Decision needed</h3><p className="mt-2 text-sm">{item.whyNow}</p></div>
    <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (!alternative.trim()) return; onAsk(`${fridayDecisionContext(item, companyId)} I want this alternative: ${alternative}. Do not treat a changed action as approval of the original.`); setAlternative(""); }}><label className="block text-sm">Suggest a different approach<textarea className="mt-2 w-full rounded-lg border bg-background p-3" value={alternative} onChange={event => setAlternative(event.target.value)} placeholder="Do it this way instead…" /></label><Button size="sm" variant="outline" disabled={!alternative.trim()}>Send instructions to Friday</Button><p className="text-xs text-muted-foreground">You can also speak to Friday about this decision. A changed proposal keeps its approval gate.</p></form>
    {task.error && <p role="alert" className="text-destructive">{task.error.message}</p>}{task.data?.companyId === companyId && <ApplicationTaskInspector task={task.data} />}
  </section>;
}
