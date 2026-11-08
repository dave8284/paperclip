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
  const plan = item.detail?.kind === "plan_approval" ? item.detail.planTarget : null;
  const targetContext = item.detail?.kind === "plan_approval"
    ? plan ? ` Requested review target: task ${plan.issueId}, document key ${plan.key}, requested revision ${plan.requestedRevisionId ?? "not recorded"}; requested document id: ${plan.requestedDocumentId ?? "not separately bound"}. Observed current document revision: ${plan.currentRevisionId ?? "unavailable"}; target state: ${plan.state}; observed document id: ${plan.currentDocumentId ?? "unavailable"}. The requested revision is the proposal under discussion; a newer current revision does not replace or approve it.`
      : " Requested review target/revision unavailable. Do not infer it from the current document or source update time."
    : "";
  return `Company: ${companyId}. Project: ${item.project?.id ?? "company-wide"}. Decision: ${item.subject.title ?? item.id}. Attention record: ${item.id}. Native source kind: ${item.sourceKind}; id: ${item.subject.id}; href: ${item.subject.href ?? "none"}. Related task id: ${item.relatedIssue?.id ?? item.subject.metadata?.issueId ?? "none"}; href: ${item.relatedIssue?.href ?? "none"}. Source updated: ${item.updatedAt ?? "unavailable"} (observation timestamp, not a target revision).${targetContext} Proposal detail: ${JSON.stringify(item.detail ?? null)}. Reason: ${item.whyNow}. Re-read the full native proposal and its current revision through authorized access before answering; disclose changed or unavailable evidence instead of substituting a newer proposal. Explain the recommended course and impact, consult the responsible project lead when more detail is needed, and preserve native permissions, approval requirements and revision checks. This discussion is not approval.`;
}

function selectDecision(item: AttentionItem, companyId: string) {
  const taskId = item.relatedIssue?.id ?? (typeof item.subject.metadata?.issueId === "string" ? item.subject.metadata.issueId : undefined);
  setFridayDisplaySelection(companyId, "attention", { decisionId: item.id, sourceKind: item.sourceKind, sourceId: item.subject.id, ...(item.project?.id ? { projectId: item.project.id } : {}), ...(taskId ? { taskId } : {}) });
}

export function useFridayAttention(companyId: string, projectId?: string, cursor?: string) {
  return useQuery({ queryKey: [...queryKeys.attention(companyId), "friday", "proposals", projectId ?? null, cursor ?? null],
    queryFn: () => attentionApi.list(companyId, { category: "proposals", projectId, cursor, limit: 50, sort: "decide" }), staleTime: 15_000 });
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
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Ready for your decision</h3><p className="text-xs text-muted-foreground">{feed.data && !feed.error ? `${feed.data.totalCount} current decisions with a proposed course of action` : "Reading current decisions…"}</p></div>
      <Button variant="ghost" size="sm" onClick={() => void feed.refetch()}>Refresh</Button></div>
    {(feed.error || dismiss.error) && <p role="alert" className="text-sm text-destructive">{feed.error?.message ?? dismiss.error?.message}</p>}
    {!feed.isPending && !feed.error && !items.length && <p className="text-sm text-muted-foreground">No proposals currently need your decision. Work blockers remain in the Work view; Friday asks clarifying questions in your conversation.</p>}
    {[...groups].map(([key, group]) => <section key={key} className="space-y-2">
      <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-medium text-muted-foreground">{group.name}</h4>{group.projectId && <Button variant="ghost" size="sm" onClick={() => onProject(group.projectId!)}>See project</Button>}</div>
      {group.items.map(item => <div key={item.id} className="rounded-lg border bg-background">
        <AttentionQueueRow presentation="agentos" item={item} companyId={companyId} inlineDetail={expanded === item.id ? <DecisionContext item={item} companyId={companyId} onAsk={onAsk} /> : null} expanded={expanded === item.id} onToggleExpand={next => { setExpanded(current => current === next.id ? null : next.id); selectDecision(next, companyId); }}
          onDismiss={item => { if (!dismiss.isPending) dismiss.mutate(item); }} agentMap={agentMap} agents={agents} currentUserId={session.data?.user?.id ?? session.data?.session?.userId ?? null} />
        <div className="px-3 pb-2"><Button variant="ghost" size="sm" onClick={() => { selectDecision(item, companyId); onAsk(`Explain this decision and recommend the next step. ${fridayDecisionContext(item, companyId)}`); }}>Discuss with {assistantName}</Button></div>
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
    <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (!alternative.trim()) return; selectDecision(item, companyId); onAsk(`${fridayDecisionContext(item, companyId)} I want this alternative: ${alternative}. Do not treat a changed action as approval of the original.`); setAlternative(""); }}><label className="block text-sm">Suggest a different approach<textarea className="mt-2 w-full rounded-lg border bg-background p-3" value={alternative} onChange={event => setAlternative(event.target.value)} placeholder="Do it this way instead…" /></label><Button size="sm" variant="outline" disabled={!alternative.trim()}>Send instructions to Friday</Button><p className="text-xs text-muted-foreground">You can also speak to Friday about this decision. A changed proposal keeps its approval gate.</p></form>
    {task.error && <p role="alert" className="text-destructive">{task.error.message}</p>}{task.data?.companyId === companyId && <ApplicationTaskInspector task={task.data} />}
  </section>;
}
