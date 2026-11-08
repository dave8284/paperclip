import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { PrepareModelComparison } from "@paperclipai/shared";
import { ApiError } from "../api/client";
import { modelComparisonsApi, modelComparisonsKey } from "../api/model-comparisons";
import { Link } from "../lib/router";
import { Button } from "./ui/button";
import type { CurrentBoardAccess } from "../api/access";

type Draft = { comparisonId: string; caseId: string; issueId: string; arm: "" | "baseline" | "candidate" };
const empty: Draft = { comparisonId: "", caseId: "", issueId: "", arm: "" };
const dimension = { model: "Model choice", prompt: "Prompt", context: "Context" } as const;
const armName = { baseline: "Baseline", candidate: "Candidate" } as const;
const canPrepare = (access: CurrentBoardAccess | undefined, userId: string | null, companyId: string) => Boolean(userId && access
  && access.userId === userId && !["local_implicit", "mcp_oauth"].includes(access.source)
  && access.isInstanceAdmin && access.companyIds.includes(companyId));

export function ModelComparisonPreparation({ companyId, userId }: { companyId: string; userId: string | null }) {
  return <ComparisonScope key={JSON.stringify([companyId, userId])} companyId={companyId} userId={userId} />;
}

function ComparisonScope({ companyId, userId }: { companyId: string; userId: string | null }) {
  const [draft, setDraft] = useState<Draft>(empty);
  const [authorityLost, setAuthorityLost] = useState(false);
  const receipt = useRef<{ fingerprint: string; requestKey: string } | null>(null);
  const access = useQuery({ queryKey: [...modelComparisonsKey(companyId, userId), "access"], queryFn: ({ signal }) => modelComparisonsApi.access(signal), enabled: userId !== null, retry: false, staleTime: 0, refetchOnMount: "always" });
  const eligible = access.isSuccess && !access.isFetching && canPrepare(access.data, userId, companyId);
  const source = useQuery({ queryKey: modelComparisonsKey(companyId, userId), queryFn: ({ signal }) => modelComparisonsApi.discover(companyId, signal), enabled: eligible, retry: false, staleTime: 0, refetchOnMount: "always" });
  const data = eligible && source.isSuccess && !source.isFetching && !authorityLost ? source.data : undefined;
  const comparison = data?.comparisons.find(row => row.id === draft.comparisonId);
  const selectedCase = comparison?.cases.find(row => row.id === draft.caseId);
  const task = selectedCase?.tasks.find(row => row.issueId === draft.issueId);
  const arm = draft.arm && task?.arms.includes(draft.arm) ? draft.arm : null;
  const valid = Boolean(data?.enabled && comparison && selectedCase && task && arm);
  const prepare = useMutation({ mutationFn: (input: PrepareModelComparison) => modelComparisonsApi.prepare(companyId, input), retry: false, onError: error => {
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) setAuthorityLost(true);
  } });
  async function refresh() {
    // Preserve the same-scope choices and submitted request key across an
    // ambiguous committed response. Only fresh native choices can enable retry.
    const identity = await access.refetch();
    if (!identity.isSuccess || !canPrepare(identity.data, userId, companyId)) return;
    const result = await source.refetch();
    if (result.isSuccess) setAuthorityLost(false);
  }
  const prepared = data?.enabled && prepare.data?.companyId === companyId ? prepare.data : undefined;
  const change = (value: Draft) => { setDraft(value); prepare.reset(); };
  if (userId === null || (access.isSuccess && !access.isFetching && !canPrepare(access.data, userId, companyId))) return <section className="space-y-3" aria-label="Prepare model comparison"><h3 className="font-semibold">Model comparisons</h3><p className="text-sm text-muted-foreground">Comparison preparation requires a signed-in, approved instance administrator with current company access.</p>{access.data?.source === "local_implicit" && <p className="text-sm text-muted-foreground">The local trusted context cannot prepare comparisons.</p>}</section>;
  if (!eligible) return <section className="space-y-3" aria-label="Prepare model comparison"><h3 className="font-semibold">Model comparisons</h3>{access.isError ? <><p role="alert" className="text-sm text-destructive">{access.error.message}</p><Button variant="outline" onClick={() => void refresh()}>Check comparison access again</Button></> : <p role="status" className="text-sm text-muted-foreground">Checking signed-in administrator access…</p>}</section>;
  return <section className="space-y-3" aria-label="Prepare model comparison">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Prepare a model comparison</h3><Button variant="outline" size="sm" disabled={source.isFetching || prepare.isPending} onClick={() => void refresh()}>Refresh comparisons</Button></div>
    <p className="text-sm text-muted-foreground">Choose a saved comparison, case and matching backlog task. Preparation saves the assignment and its acceptance checks. Open the task to review and start it when ready.</p>
    {(source.isError || authorityLost) && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{source.error?.message ?? prepare.error?.message ?? "Current comparison access must be checked again."}</p><Button variant="outline" disabled={source.isFetching} onClick={() => void refresh()}>Check comparison access again</Button></div>}
    {(source.isPending || source.isFetching) && <p role="status" className="text-sm text-muted-foreground">Reading available comparisons and tasks…</p>}
    {data && !data.enabled && <p role="status" className="text-sm text-muted-foreground">Model comparisons are not configured for this workspace.</p>}
    {data?.enabled && !data.comparisons.length && <p role="status" className="text-sm text-muted-foreground">No saved comparisons are available for this company.</p>}
    {prepared ? <div className="space-y-2 rounded-lg border p-4"><p role="status" className="text-sm">Comparison assignment saved for {prepared.task.identifier ?? "the task"} · {prepared.task.title}. Task status: {prepared.task.status.replaceAll("_", " ")}.</p><Link className="text-sm text-primary" to={`/issues/${prepared.task.identifier ?? prepared.task.id}`}>Open prepared task →</Link><div><Button type="button" variant="outline" size="sm" onClick={() => { change(empty); receipt.current = null; void refresh(); }}>Choose another comparison</Button></div></div> : data?.enabled && !!data.comparisons.length && <form aria-label="Comparison assignment" className="space-y-3 rounded-lg border p-4" onSubmit={event => {
      event.preventDefault(); if (!valid || prepare.isPending || !comparison || !selectedCase || !task || !arm) return;
      const selected = { comparisonId: comparison.id, caseId: selectedCase.id, issueId: task.issueId, arm };
      const fingerprint = JSON.stringify(selected);
      if (receipt.current?.fingerprint !== fingerprint) receipt.current = { fingerprint, requestKey: crypto.randomUUID() };
      prepare.mutate({ requestKey: receipt.current.requestKey, ...selected });
    }}>
      <fieldset disabled={prepare.isPending} className="space-y-3">
        <label className="block space-y-1 text-sm"><span>Saved comparison</span><select aria-label="Saved comparison" className="w-full rounded-md border bg-background px-3 py-2" value={comparison?.id ?? ""} onChange={event => change({ ...empty, comparisonId: event.target.value })}><option value="">Choose comparison</option>{data.comparisons.map(row => <option key={row.id} value={row.id}>{dimension[row.dimension]} · {row.taskFamily} · {row.datasetVersion} · {row.baseline.model} → {row.candidate.model}</option>)}</select></label>
        {comparison && <>
          <p className="text-xs text-muted-foreground">{dimension[comparison.dimension]} comparison · Baseline: {comparison.baseline.model} ({comparison.baseline.reasoningEffort}) · Candidate: {comparison.candidate.model} ({comparison.candidate.reasoningEffort})</p>
          <label className="block space-y-1 text-sm"><span>Saved case</span><select aria-label="Saved case" className="w-full rounded-md border bg-background px-3 py-2" value={selectedCase?.id ?? ""} onChange={event => change({ ...draft, caseId: event.target.value, issueId: "", arm: "" })}><option value="">Choose case</option>{comparison.cases.map(row => <option key={row.id} value={row.id}>{row.label} · {row.split === "holdout" ? "Held-out case" : "Training case"}</option>)}</select></label>
          {!comparison.cases.length && <p role="status" className="text-sm text-muted-foreground">This comparison has no available saved cases.</p>}
        </>}
        {selectedCase && <>
          <label className="block space-y-1 text-sm"><span>Backlog task and employee</span><select aria-label="Backlog task and employee" className="w-full rounded-md border bg-background px-3 py-2" value={task?.issueId ?? ""} onChange={event => { const chosen = selectedCase.tasks.find(row => row.issueId === event.target.value); change({ ...draft, issueId: event.target.value, arm: chosen?.arms.length === 1 ? chosen.arms[0] : "" }); }}><option value="">Choose task</option>{selectedCase.tasks.map(row => <option key={row.issueId} value={row.issueId}>{row.identifier ?? "Task"} · {row.title} · {row.agentName}</option>)}</select></label>
          {!selectedCase.tasks.length && <p role="status" className="text-sm text-muted-foreground">No eligible backlog tasks are available for this case.</p>}
        </>}
        {task && comparison && <label className="block space-y-1 text-sm"><span>Comparison arm</span><select aria-label="Comparison arm" className="w-full rounded-md border bg-background px-3 py-2" value={arm ?? ""} onChange={event => change({ ...draft, arm: event.target.value as Draft["arm"] })}><option value="">Choose arm</option>{task.arms.map(value => <option key={value} value={value}>{armName[value]} · {comparison[value].model} · {comparison[value].reasoningEffort}</option>)}</select></label>}
      </fieldset>
      {prepare.error && <p role="alert" className="text-sm text-destructive">{prepare.error.message}</p>}
      <div className="flex items-center justify-between gap-3"><Button type="button" variant="outline" disabled={prepare.isPending} onClick={() => change(empty)}>Cancel</Button><Button type="submit" disabled={!valid || prepare.isPending}>{prepare.isPending ? "Preparing…" : "Prepare backlog task"}</Button></div>
    </form>}
  </section>;
}
