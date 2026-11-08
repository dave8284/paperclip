import { useState } from "react";
import type { AdminModelActivity } from "@paperclipai/shared";
import { Link } from "@/lib/router";

const readable = (value: string) => value.replaceAll("_", " ").replaceAll(".", " · ");
const modelKey = (model: { provider: string; model: string }) => `${model.provider} / ${model.model}`;
const elapsed = (ms: number | null | undefined) => ms == null ? "Not recorded" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
const number = (value: number) => new Intl.NumberFormat().format(Math.round(value));

/** Actual execution evidence, separate from selection recommendations and reviews. */
export function ModelActivityAudit({ activity }: { activity: AdminModelActivity }) {
  const [family, setFamily] = useState("");
  const [model, setModel] = useState("");
  const families = [...new Set([...activity.taskModels, ...activity.recentRuns].map(row => row.taskType))].sort();
  const models = [...new Set([...activity.taskModels.map(modelKey), ...activity.recentRuns.flatMap(row => row.actualModels.map(modelKey))])].sort();
  const taskModels = activity.taskModels.filter(row => (!family || row.taskType === family) && (!model || modelKey(row) === model));
  const recentRuns = activity.recentRuns.filter(row => (!family || row.taskType === family) && (!model || row.actualModels.some(actual => modelKey(actual) === model)));
  return <section className="space-y-5" aria-label="Model activity and routing audit">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2"><h2 className="text-lg font-medium">Models by task type</h2><p className="max-w-3xl text-sm text-muted-foreground">Actual model usage linked to tasks and runs. Compare observed work here; reviewed quality and eligibility determine whether a model is suitable next time.</p></div>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">Task type<select className="rounded-lg border bg-background p-2" value={family} onChange={event => setFamily(event.target.value)}><option value="">All task types</option>{families.map(value => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-sm">Executed model<select className="max-w-xs rounded-lg border bg-background p-2" value={model} onChange={event => setModel(event.target.value)}><option value="">All executed models</option>{models.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
    </div>
    <div className="overflow-x-auto rounded-xl border border-border"><table className="agentos-data-table"><thead><tr><th>Task type / company</th><th>Executed model</th><th>Runs / completed / failed</th><th>Mean run time</th><th>Input / output tokens</th></tr></thead><tbody>{taskModels.map(row => <tr key={`${row.companyId}:${row.taskType}:${modelKey(row)}`}><td>{readable(row.taskType)}<span className="block text-xs text-muted-foreground">{row.companyName}</span></td><td>{row.model}<span className="block text-xs text-muted-foreground">{row.provider}</span></td><td>{number(row.runs)} / {number(row.succeeded)} / {number(row.failed)}</td><td>{elapsed(row.meanDurationMs)}</td><td>{number(row.inputTokens)} / {number(row.outputTokens)}{row.unpricedReceipts > 0 && <span className="block text-xs text-muted-foreground">{number(row.unpricedReceipts)} unpriced receipts</span>}</td></tr>)}</tbody></table>{!taskModels.length && <p className="p-5 text-sm text-muted-foreground">No linked model usage for this filter yet.</p>}</div>
    <p className="text-xs leading-relaxed text-muted-foreground">{activity.moreTaskModels ? `Showing the ${activity.taskModelLimit} largest groups; more are recorded.` : `Up to ${activity.taskModelLimit} company/task/model groups in this period.`} Filters apply to the displayed records. Run time includes tools and orchestration; completed runs are not quality passes. Multi-model runs appear in each observed model group. Unclassified means no bound task-classification receipt was recorded. Unlinked usage remains in Model usage below.</p>

    <div className="space-y-2"><h2 className="text-lg font-medium">Routing audit trail</h2><p className="text-sm text-muted-foreground">{activity.moreRuns ? `Showing the latest ${activity.runLimit} runs; older runs remain in the native audit trail.` : `Latest runs, up to ${activity.runLimit}.`} Open a row to see the selected model, actual usage, System One suggestion, review strategy and linked outcome.</p></div>
    <div className="divide-y divide-border rounded-xl border border-border">{recentRuns.map(row => <details key={row.id} className="group p-4">
      <summary className="cursor-pointer text-sm"><span className="font-medium">{readable(row.taskType)}</span><span className="text-muted-foreground"> · {row.companyName} · {new Date(row.createdAt).toLocaleString()} · {readable(row.status)}</span><span className="mt-2 block text-muted-foreground">{row.actualModels.length ? row.actualModels.map(modelKey).join(", ") : "Actual model usage not recorded"} · {row.review ? row.review.passed ? "Reviewed: met criteria" : "Reviewed: needs improvement" : "No linked review in the current ledger"}</span></summary>
      <div className="mt-4 space-y-4 text-sm">
        <dl className="grid gap-4 md:grid-cols-2">
          <div><dt className="font-medium">Selected execution profile</dt><dd className="mt-1 space-y-2 text-muted-foreground">
            {row.selected && <p>{modelKey(row.selected)}<br />Model Intelligence: {readable(row.selected.reason)} · Policy {row.selected.policyVersion}</p>}
            {row.nativeProfile && <p>Frozen native request: {row.nativeProfile.model} · {row.nativeProfile.harness} harness<br />{row.nativeProfile.sessionRequest === "existing" ? "An existing session was supplied" : "No prior session was recorded"}. This is the requested profile; actual provider usage is shown separately.</p>}
            {!row.selected && <p>{row.nativeProfile ? "No Model Intelligence selection reason or qualification is recorded for this run." : "No selection receipt or frozen native profile is available. The requested model and selection reason are unknown."}</p>}
          </dd></div>
          <div><dt className="font-medium">Actual execution</dt><dd className="mt-1 text-muted-foreground">{row.actualModels.length ? row.actualModels.map(modelKey).join(", ") : "Awaiting or missing linked usage receipts"}{row.actualModelsTruncated && " · More models recorded; open execution details"}<br />Run time: {elapsed(row.durationMs)}<br />{row.runtimeSessionState === "fresh" ? "Runtime session metadata: fresh." : row.runtimeSessionState === "reused" ? "Runtime session metadata: reused." : row.runtimeSessionState === "conflicting" ? "Runtime session metadata has conflicting fresh/reused flags." : "Runtime session metadata is not recorded."}<br />Session metadata does not verify provider-side reuse.</dd></div>
          <div><dt className="font-medium">System One observation</dt><dd className="mt-1 text-muted-foreground">{row.triage ? <>{readable(row.triage.status)} · {readable(row.triage.reason)}<br />{row.triage.model ?? "Model not invoked"} · {elapsed(row.triage.elapsedMs)}{row.triage.proposedTaskType && <><br />Suggested task: {readable(row.triage.proposedTaskType)}</>}{row.triage.proposedCandidateId && <><br />Suggested profile: <span className="break-all">{row.triage.proposedCandidateId}</span></>}<br />Shadow observation; it did not change routing.</> : "No System One observation recorded for this run."}</dd></div>
          <div><dt className="font-medium">Context and review</dt><dd className="mt-1 text-muted-foreground">{row.triage?.contextStrategy === "context_rich_author_and_independent_review" ? "Elephant author context; independent Goldfish review requested. Completion and isolation require separate evidence." : row.triage ? "Standard context requested." : "Context strategy not recorded."}</dd></div>
        </dl>
        <div className="space-y-2 rounded-lg bg-muted p-3">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div><dt className="font-medium">Queue delay</dt><dd>{elapsed(row.queueDelayMs)}</dd></div>
            <div><dt className="font-medium">First recorded agent comment</dt><dd>{elapsed(row.firstAgentCommentMs)}</dd></div>
            <div><dt className="font-medium">Total run time</dt><dd>{elapsed(row.durationMs)}</dd></div>
          </dl>
          <p className="text-xs leading-relaxed text-muted-foreground">Queue delay runs from creation to execution start. First recorded agent comment runs from execution start to the earliest retained comment attributed to this agent and run on its bound task; it can be progress or an answer. This is not provider first-token, complete-answer or audible-response timing. Missing native task, timestamps or comment evidence stays unknown.</p>
        </div>
        <div className="space-y-2 rounded-lg bg-muted p-3">
          <h3 className="font-medium">Execution attempts and retries</h3>
          {row.execution ? <>
            <p>{row.execution.label} · Attempt {number(row.execution.attempt)}{row.execution.cause && <> · {readable(row.execution.cause)}</>}{row.execution.retryAt && <><br />Next retry: {new Date(row.execution.retryAt).toLocaleString()}</>}</p>
            <div className="flex flex-wrap gap-4">
              {row.execution.predecessorRunId && (row.execution.predecessorAgentId ? <Link className="text-primary underline" to={`/${row.companyPrefix}/agents/${row.execution.predecessorAgentId}/runs/${row.execution.predecessorRunId}`}>Open preceding run</Link> : <span>Preceding run recorded; details unavailable.</span>)}
              {row.execution.successorRunId && (row.execution.successorAgentId ? <Link className="text-primary underline" to={`/${row.companyPrefix}/agents/${row.execution.successorAgentId}/runs/${row.execution.successorRunId}`}>Open successor run</Link> : <span>Successor run recorded; details unavailable.</span>)}
              {!row.execution.predecessorRunId && !row.execution.successorRunId && <span>No preceding or successor run is linked.</span>}
            </div>
          </> : <p>{row.executionState === "unavailable" ? "Execution attempt evidence is temporarily unavailable. Refresh to try reading it again." : "Execution attempt evidence is not recorded by this server."}</p>}
          <p className="text-xs leading-relaxed text-muted-foreground">Attempts follow native execution recovery accounting. Other task runs and provider turns are not counted as retries. Process completion does not establish result quality.</p>
        </div>
        {row.review && <p className="rounded-lg bg-muted p-3">{row.review.passed ? "Met acceptance criteria" : "Needs improvement"} · {row.review.source} review · {row.review.iterations} iterations · {elapsed(row.review.latencyMs)}<span className="mt-1 block whitespace-pre-wrap">{row.review.evidenceRef}</span></p>}
        <div className="flex flex-wrap gap-4"><Link className="text-primary underline" to={`/${row.companyPrefix}/agents/${row.agentId}/runs/${row.id}`}>Open execution details</Link>{row.taskId && <Link className="text-primary underline" to={`/${row.companyPrefix}/issues/${row.taskId}`}>Open task and evidence</Link>}</div>
      </div>
    </details>)}{!recentRuns.length && <p className="p-5 text-sm text-muted-foreground">No recent runs for this filter.</p>}</div>
    <p className="text-xs text-muted-foreground">Review links use the latest {activity.reviewLookupLimit} evaluation records and match both company and run. No match means unknown here, not a failed or unreviewed outcome. Reviewing a result in the selection ledger below supplies evidence for future eligible routing.</p>
  </section>;
}
