import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModelProfileQualification, ModelProfileQualificationEvidence } from "@paperclipai/shared";
import { agentosModelsApi, agentosModelsKey } from "@/api/agentos-models";
import { useAccountIdentity } from "@/api/companies-query";
import { ApiError } from "@/api/client";
import { Link } from "@/lib/router";
import { ModelIntelligenceInsights } from "./ModelIntelligenceInsights";
import { ModelComparisonPreparation } from "./ModelComparisonPreparation";
import { ModelRoutingControls } from "./ModelRoutingControls";
import { Button } from "./ui/button";

const labels: Record<ModelProfileQualification["state"], string> = {
  access_verified: "Session access verified", workflow_qualified: "Workflow qualified", stale: "Stale", revoked: "Revoked",
};
const evidenceKey = (row: ModelProfileQualificationEvidence) => `${row.runId}:${row.nativeReviewInteractionId ?? row.reviewDecisionId ?? "access"}`;
function localDateTime(value: number) {
  const date = new Date(value);
  return new Date(value - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
const when = (value: string) => new Date(value).toLocaleString();
const denied = (error: unknown) => error instanceof ApiError && [401, 403].includes(error.status);

export function AgentOSModelSettings({ companyId }: { companyId: string }) {
  const account = useAccountIdentity();
  if (!account.settled) return <p role={account.failed ? "alert" : "status"}>{account.failed ? "Could not verify your account. Refresh to retry." : "Verifying account access…"}</p>;
  return <ModelSettingsScope key={JSON.stringify([companyId, account.userId])} companyId={companyId} userId={account.userId} />;
}

function ModelSettingsScope({ companyId, userId }: { companyId: string; userId: string | null }) {
  const key = agentosModelsKey(companyId, userId);
  const query = { retry: false, staleTime: 0, refetchOnMount: "always" as const };
  const accounts = useQuery({ ...query, queryKey: [...key, "accounts"], queryFn: ({ signal }) => agentosModelsApi.accounts(companyId, signal) });
  const catalog = useQuery({ ...query, queryKey: [...key, "catalog"], queryFn: ({ signal }) => agentosModelsApi.catalog(companyId, signal) });
  const connectedProviders = new Set(accounts.isSuccess ? accounts.data.connections.filter(row => row.method === "subscription" && row.status === "connected").map(row => row.provider) : []);
  return <section className="space-y-6" aria-label="Model settings">
    {[accounts, catalog].map((source, index) => source.isError && <div className="space-y-2" key={index}><p role="alert" className="text-destructive">{source.error.message}</p><Button variant="outline" onClick={() => void source.refetch()}>Retry {index ? "model catalogue" : "accounts"}</Button></div>)}
    {catalog.isSuccess && catalog.data.learning && <ModelIntelligenceInsights learning={catalog.data.learning} />}
    {catalog.isSuccess && catalog.data.learningAccess === "restricted" && <p className="text-sm text-muted-foreground">Company-wide learning and evaluations are available to instance administrators because they include private project work.</p>}
    <div className="space-y-3"><h2 className="text-lg font-semibold">Subscription seats</h2><p className="text-sm text-muted-foreground">Only connected subscription accounts can power company agents. Model access and limits come from the selected account and harness.</p>
      {accounts.isPending && <p role="status">Reading subscription accounts…</p>}
      {accounts.isSuccess && <div className="overflow-x-auto"><table className="agentos-data-table"><thead><tr><th>Account</th><th>Provider</th><th>Billing</th><th>Status</th><th>Access</th></tr></thead><tbody>{accounts.data.connections.map(row => <tr key={row.grantId}><td>{row.name}</td><td>{row.provider}</td><td>{row.method}</td><td>{row.status.replaceAll("_", " ")}</td><td><Link to={`/apps/${row.id}/permissions`}>Manage</Link></td></tr>)}</tbody></table></div>}
      <div className="flex flex-wrap gap-4 text-sm"><Link to="/apps/connect?source=openai">Connect Codex</Link><Link to="/apps/connect?source=anthropic">Connect Claude</Link><Link to="/admin?tab=intelligence">Model intelligence and evaluations</Link></div>
    </div>
    <div className="space-y-3"><h3 className="font-semibold">Model catalogue for connected providers</h3><p className="text-sm text-muted-foreground">Models supported by the installed harness. Historical use does not establish current account access. The configured baseline stays in place unless current account and workflow qualification, plus comparative quality and speed evidence, permit an alternative. Native account and model checks run again before dispatch.</p>
      {catalog.isPending && <p role="status">Reading model catalogue…</p>}
      {catalog.isSuccess && accounts.isSuccess && <div className="overflow-x-auto"><table className="agentos-data-table"><thead><tr><th>Model</th><th>Historical use</th><th>Configured employees</th></tr></thead><tbody>{catalog.data.models.filter(row => connectedProviders.has(row.provider as "openai" | "anthropic")).map(row => <tr key={`${row.provider}:${row.id}`}><td>{row.label}</td><td>{row.observed ? "Observed in this company" : "Not yet observed"}</td><td>{row.configuredAgents.map(agent => agent.name).join(", ") || "—"}</td></tr>)}</tbody></table></div>}
    </div>
    <ModelQualifications companyId={companyId} userId={userId} />
    <ModelComparisonPreparation companyId={companyId} userId={userId} />
    <ModelRoutingControls companyId={companyId} userId={userId} />
  </section>;
}

function ModelQualifications({ companyId, userId }: { companyId: string; userId: string | null }) {
  const client = useQueryClient();
  const key = [...agentosModelsKey(companyId, userId), "qualifications"];
  const source = useQuery({ queryKey: key, queryFn: ({ signal }) => agentosModelsApi.qualifications(companyId, signal), retry: false, staleTime: 0, refetchOnMount: "always" });
  const [draft, setDraft] = useState<{ evidence: string; expires: string; requestKey: string } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [authorityLost, setAuthorityLost] = useState(false);
  const [message, setMessage] = useState("");
  const data = source.isSuccess && !source.isFetching && !authorityLost ? source.data : undefined;
  const selected = data?.availableEvidence.find(row => evidenceKey(row) === draft?.evidence);
  const revokeTarget = data?.qualifications.find(row => row.id === revoking && row.state !== "revoked");
  const expires = draft ? new Date(draft.expires).getTime() : NaN;
  const validExpiry = Boolean(selected && Number.isFinite(expires) && expires > Date.now() && expires <= Date.parse(selected.maximumValidUntil));
  const canAct = Boolean(data && !source.isFetching);
  useEffect(() => { if (source.isError) { setDraft(null); setRevoking(null); } }, [source.isError]);
  async function refresh() { await client.invalidateQueries({ queryKey: key }); }
  function onError(error: Error) {
    if (denied(error)) { setAuthorityLost(true); setDraft(null); setRevoking(null); }
  }
  const register = useMutation({ retry: false, mutationFn: async () => {
    if (!canAct || !selected || !draft || !Number.isFinite(expires) || expires <= Date.now()
      || expires > Date.parse(selected.maximumValidUntil)) throw new Error("Choose current native evidence and a valid expiry.");
    return agentosModelsApi.register(companyId, { requestKey: draft.requestKey, runId: selected.runId,
      ...(selected.nativeReviewInteractionId ? { nativeReviewInteractionId: selected.nativeReviewInteractionId }
        : selected.reviewDecisionId ? { reviewDecisionId: selected.reviewDecisionId } : {}), validUntil: new Date(expires).toISOString() });
  }, onError, onSuccess: async result => { setDraft(null); setMessage(`${labels[result.qualification.state]} recorded.`); await refresh(); } });
  const revoke = useMutation({ retry: false, mutationFn: async () => {
    if (!canAct || !revokeTarget) throw new Error("This qualification is unavailable. Refresh its current state.");
    return agentosModelsApi.revoke(companyId, revokeTarget.id);
  }, onError, onSuccess: async () => { setRevoking(null); setMessage("Qualification revoked. Future work must use current eligible evidence."); await refresh(); } });
  const busy = register.isPending || revoke.isPending;
  async function retry() {
    register.reset(); revoke.reset(); setMessage("");
    const result = await source.refetch();
    if (result.isSuccess) setAuthorityLost(false);
  }
  return <section className="space-y-4" aria-label="Current model qualifications"><h3 className="font-semibold">Current model qualifications</h3>
    <p className="text-sm text-muted-foreground">Session access verifies that a completed native session used the model. Workflow qualification also requires an approved independent review for that task and profile. Session access alone never enables alternative routing. Registration reads existing evidence and does not run a model.</p>
    {(source.isPending || source.isFetching) && <p role="status">Reading current qualification evidence…</p>}
    {(source.isError || authorityLost) && <div className="space-y-2"><p role="alert" className="text-destructive">{authorityLost || denied(source.error) ? "Model qualifications require an instance administrator with access to this company." : source.error?.message}</p><Button variant="outline" onClick={() => void retry()}>Retry qualifications</Button></div>}
    {data && <>
      <p className="text-sm text-muted-foreground">Up to {data.limit} recent registrations and {data.evidenceLimit} recent completed executions are checked against current evidence.</p>
      <div className="overflow-x-auto"><table className="agentos-data-table"><thead><tr><th>Model / task family</th><th>Evidence</th><th>State</th><th>Expires</th><th>Action</th></tr></thead><tbody>{data.qualifications.map(row => {
        const evidence = data.availableEvidence.find(item => item.runId === row.runId);
        return <tr key={row.id}><td>{row.profile.model}<span className="block text-sm text-muted-foreground">{row.profile.taskType.replaceAll(".", " · ")} · {row.profile.complexity}</span><span className="block text-sm text-muted-foreground">Effort: {row.profile.requestedEffort ?? "default"} · Harness: {row.observedProviderVersion}</span></td><td><Link to={`/issues/${row.issueId}`}>{evidence?.issueIdentifier ?? "Open task"}</Link><span className="block"><Link to={`/agents/${row.agentId}`}>{evidence?.agentName ?? "Open employee"}</Link></span><span className="block text-sm text-muted-foreground">Observed {when(row.observedAt)}</span></td><td>{labels[row.state]}</td><td>{when(row.validUntil)}</td><td>{row.state !== "revoked" && <Button variant="ghost" size="sm" disabled={!canAct || busy} aria-label={`Revoke ${row.profile.model} qualification`} onClick={() => { revoke.reset(); setMessage(""); setRevoking(row.id); }}>Revoke</Button>}</td></tr>;
      })}</tbody></table></div>
      {!data.qualifications.length && <p className="text-sm text-muted-foreground">No model qualifications registered for this company.</p>}
      {revokeTarget && <section className="space-y-3 rounded-xl border p-4" aria-label="Confirm qualification revocation"><h4 className="font-semibold">Revoke {revokeTarget.profile.model} qualification?</h4><p className="text-sm">This removes this evidence from future model selection. It does not change active work or erase the recorded execution.</p><div className="flex items-center justify-between"><Button variant="ghost" disabled={busy} onClick={() => setRevoking(null)}>Cancel</Button><Button variant="destructive" disabled={!canAct || busy} onClick={() => revoke.mutate()}>Revoke qualification</Button></div></section>}
      <form className="max-w-2xl space-y-3" onSubmit={event => { event.preventDefault(); setMessage(""); register.mutate(); }}>
        <label className="block text-sm">Native execution evidence<select className="mt-2 w-full rounded-lg border bg-background p-3" value={selected && draft ? draft.evidence : ""} disabled={!canAct || busy} onChange={event => {
          register.reset(); setMessage(""); const row = data.availableEvidence.find(item => evidenceKey(item) === event.target.value);
          setDraft(row ? { evidence: evidenceKey(row), expires: localDateTime(Math.min(Date.now() + 86_400_000, Date.parse(row.maximumValidUntil))), requestKey: crypto.randomUUID() } : null);
        }}><option value="">Choose a completed task, employee and model</option>{data.availableEvidence.map(row => <option key={evidenceKey(row)} value={evidenceKey(row)} disabled={Date.parse(row.maximumValidUntil) <= Date.now()}>{row.issueIdentifier ? `${row.issueIdentifier} · ` : ""}{row.issueTitle} · {row.agentName} · {row.model} · {labels[row.state]}</option>)}</select></label>
        {!data.availableEvidence.length && <p className="text-sm text-muted-foreground">No recent completed native executions currently meet the evidence requirements. Review existing work in its native task; this page does not launch probes.</p>}
        {selected && draft && <><p className="text-sm">{labels[selected.state]} · <Link to={`/issues/${selected.issueId}`}>{selected.issueTitle}</Link> · observed {when(selected.observedAt)}.</p><label className="block text-sm">Qualification expires<input type="datetime-local" className="mt-2 w-full rounded-lg border bg-background p-3" value={draft.expires} max={localDateTime(Date.parse(selected.maximumValidUntil))} disabled={busy || !canAct} required onChange={event => { register.reset(); setDraft({ ...draft, expires: event.target.value, requestKey: crypto.randomUUID() }); }} /></label><p className="text-sm text-muted-foreground">Choose a future expiry no later than {when(selected.maximumValidUntil)}.</p>{!validExpiry && <p role="alert" className="text-destructive">Choose a future expiry within the native evidence window.</p>}<div className="flex items-center justify-between"><Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>Cancel registration</Button><Button type="submit" disabled={!canAct || busy || !validExpiry}>{register.isPending ? "Registering…" : "Register qualification"}</Button></div></>}
      </form>
    </>}
    {[register.error, revoke.error].filter(Boolean).map((error, index) => <p key={index} role="alert" className="text-destructive">{error!.message}</p>)}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
