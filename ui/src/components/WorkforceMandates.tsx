import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentosWorkforce, PortfolioReadMandate, SavePortfolioReadMandate } from "@paperclipai/shared";
import { workforceApi, workforceKeys } from "@/api/workforce";
import { agentsApi } from "@/api/agents";
import { detachInflightGet } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

function Failure({ error }: { error: unknown }) {
  return error ? <p role="alert" className="text-sm text-destructive">{error instanceof Error ? error.message : "Could not save portfolio access"}</p> : null;
}
export function WorkforceMandates({ userId, workforce }: { userId: string | null; workforce: AgentosWorkforce }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PortfolioReadMandate | "new" | null>(null);
  const client = useQueryClient();
  const queryKey = [...workforceKeys.detail(userId, workforce.portfolio.id), "read-mandates"];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => workforceApi.mandates(workforce.portfolio.id, signal), enabled: open, retry: false });
  const refresh = async () => { await client.invalidateQueries({ queryKey }); };
  return <section aria-label="Portfolio read access" className="flex flex-col gap-3">
    <div><Button variant="outline" onClick={() => setOpen(value => !value)} aria-expanded={open}>{open ? "Hide portfolio read access" : "Portfolio read access"}</Button></div>
    {open && <>
      <p className="text-sm text-muted-foreground">Choose which agent can read shared work summaries across your companies. Private work is excluded. Each read checks your current authority and the agent's exact grant.</p>
      <Failure error={query.error} />
      {query.error && <div><Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></div>}
      {query.isPending && <p className="text-sm">Loading read access…</p>}
      {query.data && !query.error && <>
        {workforce.canManage && !editing && <div><Button variant="outline" onClick={() => setEditing("new")}>Grant portfolio read access</Button></div>}
        {!query.data.length && <p className="text-sm text-muted-foreground">No portfolio read access has been granted.</p>}
        {query.data.map(row => <MandateRow key={row.id} row={row} workforce={workforce} refresh={refresh} edit={() => setEditing(row)} />)}
        {editing && workforce.canManage && <MandateForm key={editing === "new" ? "new" : `${editing.id}:${editing.revision}`} userId={userId} workforce={workforce}
          row={editing === "new" ? undefined : editing} existing={query.data} refresh={refresh} close={() => setEditing(null)} />}
      </>}
    </>}
  </section>;
}
function MandateRow({ row, workforce, refresh, edit }: { row: PortfolioReadMandate; workforce: AgentosWorkforce; refresh: () => Promise<void>; edit: () => void }) {
  const revoke = useMutation({ mutationFn: () => workforceApi.revokeMandate(workforce.portfolio.id, row.id, row.revision), onSuccess: refresh });
  const companyName = (id: string) => workforce.companies.find(company => company.id === id)?.name ?? "Unavailable company";
  const expired = !!row.expiresAt && new Date(row.expiresAt) <= new Date();
  return <Card className="flex flex-col gap-3 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-medium">{row.sourceAgentName ?? workforce.assignments.find(assignment => assignment.agentId === row.sourceAgentId)?.agentName ?? "Unavailable agent"} · {companyName(row.sourceCompanyId)}</p><Badge variant="secondary">{row.revokedAt ? "Revoked" : expired ? "Expired" : "Configured"}</Badge></div>
    <p className="text-sm">Shared project and task summaries in {row.targetCompanyIds.map(companyName).join(", ")}</p>
    <p className="text-xs text-muted-foreground">Revision {row.revision} · {row.expiresAt ? `Expires ${formatDateTime(row.expiresAt)}` : "No scheduled expiry"}. Current native authority is checked on every read.</p>
    {workforce.canManage && workforce.companies.some(company => company.id === row.sourceCompanyId && company.canManage) && <div className="flex flex-wrap gap-3"><Button size="sm" variant="outline" onClick={edit}>{row.revokedAt || expired ? "Grant again" : "Edit access"}</Button>{!row.revokedAt && <Button size="sm" variant="destructive" disabled={revoke.isPending} onClick={() => revoke.mutate()}>Revoke access</Button>}</div>}
    <Failure error={revoke.error} />
  </Card>;
}
function MandateForm({ userId, workforce, row, existing, refresh, close }: {
  userId: string | null; workforce: AgentosWorkforce; row?: PortfolioReadMandate; existing: PortfolioReadMandate[]; refresh: () => Promise<void>; close: () => void;
}) {
  const [sourceCompanyId, setSourceCompanyId] = useState(row?.sourceCompanyId ?? "");
  const [sourceAgentId, setSourceAgentId] = useState(row?.sourceAgentId ?? "");
  const [targetCompanyIds, setTargets] = useState(row?.targetCompanyIds ?? []);
  const [readScope, setScope] = useState(row && !row.revokedAt ? row.readScope : "");
  const [expiryMode, setExpiryMode] = useState(row && !row.revokedAt ? row.expiresAt ? "date" : "none" : "");
  const [expiresAt, setExpiry] = useState(row?.expiresAt?.slice(0, 16) ?? "");
  const intents = useRef(new Map<string, string>());
  const choices = workforce.companies.filter(company => company.canManage);
  const agents = useQuery({ queryKey: [...workforceKeys.account(userId), "mandate-agents", sourceCompanyId], enabled: !!sourceCompanyId, retry: false,
    queryFn: () => { detachInflightGet(`/companies/${sourceCompanyId}/agents`); return agentsApi.list(sourceCompanyId); } });
  const available = !agents.error ? agents.data?.filter(agent => ["active", "idle", "running", "error"].includes(agent.status) && agent.lifecycleState === "ready"
    && (!existing.some(mandate => mandate.sourceAgentId === agent.id) || agent.id === row?.sourceAgentId)) ?? [] : [];
  const mutation = useMutation({ mutationFn: () => {
    if (readScope !== "company_shared_only" || !expiryMode || agents.error || !available.some(agent => agent.id === sourceAgentId)) throw new Error("Choose the agent, shared-work scope and expiry explicitly");
    const input = { expectedRevision: row?.revision ?? 0, sourceCompanyId, sourceAgentId, targetCompanyIds: [...targetCompanyIds].sort(),
      action: "portfolio_work:read" as const, readScope: "company_shared_only" as const, expiresAt: expiryMode === "none" ? null : new Date(`${expiresAt}:00Z`).toISOString() };
    const key = JSON.stringify(input);
    let id = row?.id ?? intents.current.get(key);
    if (!id) { id = crypto.randomUUID(); intents.current.set(key, id); }
    return workforceApi.saveMandate(workforce.portfolio.id, { ...input, id } satisfies SavePortfolioReadMandate);
  }, onSuccess: async () => { await refresh(); close(); } });
  return <Card className="p-4"><form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}>
    <label className="flex flex-col gap-1 text-sm">Agent's company<NativeSelect required disabled={!!row} value={sourceCompanyId} onChange={event => { setSourceCompanyId(event.target.value); setSourceAgentId(""); }}><option value="">Select company</option>{choices.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</NativeSelect></label>
    <label className="flex flex-col gap-1 text-sm">Agent receiving read access<NativeSelect required disabled={!!row || !sourceCompanyId || agents.isPending || !!agents.error} value={sourceAgentId} onChange={event => setSourceAgentId(event.target.value)}><option value="">Select agent</option>{available.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</NativeSelect></label>
    <fieldset className="flex flex-col gap-2"><legend className="text-sm font-medium">Companies this agent may read</legend>{choices.map(company => <label key={company.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={targetCompanyIds.includes(company.id)} onChange={event => setTargets(ids => event.target.checked ? [...ids, company.id] : ids.filter(id => id !== company.id))} />{company.name}</label>)}</fieldset>
    <label className="flex flex-col gap-1 text-sm">Read scope<NativeSelect required value={readScope} onChange={event => setScope(event.target.value)}><option value="">Select scope</option><option value="company_shared_only">Company-shared project and task summaries</option></NativeSelect><span className="text-xs text-muted-foreground">Private work, conversations, configuration and execution access are outside this grant.</span></label>
    <label className="flex flex-col gap-1 text-sm">Expiry<NativeSelect required value={expiryMode} onChange={event => setExpiryMode(event.target.value)}><option value="">Choose expiry</option><option value="date">Expire at a specific time</option><option value="none">No scheduled expiry; revoke manually</option></NativeSelect></label>
    {expiryMode === "date" && <label className="flex flex-col gap-1 text-sm">Expiry date and time (UTC)<Input type="datetime-local" required value={expiresAt} onChange={event => setExpiry(event.target.value)} /></label>}
    <Failure error={mutation.error ?? agents.error} />
    <div className="flex items-center justify-between gap-3"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button type="submit" disabled={mutation.isPending || !sourceAgentId || !targetCompanyIds.length || !readScope || !expiryMode || !!agents.error || (expiryMode === "date" && !expiresAt)}>{mutation.isPending ? "Saving…" : "Save explicit read grant"}</Button></div>
  </form></Card>;
}
