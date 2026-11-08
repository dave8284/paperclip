import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_MODEL_ROUTING_LIMITS, type ConfigureModelRouting, type ModelRoutingDiscovery, type RollbackModelRouting } from "@paperclipai/shared";
import { modelRoutingApi, modelRoutingKey } from "@/api/model-routing";
import { ApiError } from "@/api/client";
import { Button } from "./ui/button";

type Family = ModelRoutingDiscovery["families"][number];
const denied = (error: unknown) => error instanceof ApiError && [401, 403].includes(error.status);
export function ModelRoutingControls(props: { companyId: string; userId: string | null }) {
  return <RoutingScope key={JSON.stringify([props.companyId, props.userId])} {...props} />;
}
function RoutingScope({ companyId, userId }: { companyId: string; userId: string | null }) {
  const [selected, setSelected] = useState("");
  const [authorityLost, setAuthorityLost] = useState(false);
  const query = useQuery({ queryKey: modelRoutingKey(companyId, userId), queryFn: ({ signal }) => modelRoutingApi.discover(companyId, signal),
    retry: false, staleTime: 0, refetchOnMount: "always" });
  const data = query.isSuccess && !authorityLost ? query.data : undefined;
  const family = data?.families.find(item => item.id === selected);
  return <section className="space-y-4" aria-label="Automatic model routing">
    <h3 className="font-semibold">Automatic model routing</h3>
    <p className="text-sm text-muted-foreground">Choose which task families may adopt proven model improvements. Qualified comparisons enter a small canary first. Missing observations or regressions roll back new work; active tasks keep their recorded model.</p>
    {query.isPending && <p role="status">Reading company routing policies…</p>}
    {(query.isError || authorityLost) && <div className="space-y-2"><p role="alert" className="text-destructive">{authorityLost || denied(query.error)
      ? "Routing policies require a current instance administrator with company access." : query.error?.message}</p>
      <Button variant="outline" onClick={async () => { const result = await query.refetch(); if (result.isSuccess) setAuthorityLost(false); }}>Retry routing policies</Button></div>}
    {data && !data.enabled && <p className="text-sm text-muted-foreground">Model Intelligence is not configured for this instance.</p>}
    {data?.enabled && <>
      <label className="block space-y-2"><span className="text-sm font-medium">Task family</span>
        <select aria-label="Routing task family" className="w-full rounded-md border bg-background p-2 text-base" value={selected} disabled={query.isFetching} onChange={event => setSelected(event.target.value)}>
          <option value="">Choose a task family</option>{data.families.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>
      {family && <FamilyControls key={`${family.id}:${family.policy?.revision ?? 0}`} family={family} companyId={companyId} userId={userId}
        current={!query.isFetching} loseAuthority={() => setAuthorityLost(true)} />}
    </>}
  </section>;
}
function FamilyControls({ family, companyId, userId, current, loseAuthority }: {
  family: Family; companyId: string; userId: string | null; current: boolean; loseAuthority: () => void;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<ConfigureModelRouting>(() => ({ requestKey: crypto.randomUUID(), taskType: family.id,
    expectedRevision: family.policy?.revision ?? 0, mode: family.policy?.mode ?? "off", pinnedReleaseId: family.policy?.pinnedReleaseId ?? null,
    limits: family.policy?.limits ?? DEFAULT_MODEL_ROUTING_LIMITS, reason: "Update this company's model routing policy." }));
  const [rollbackInput, setRollbackInput] = useState<RollbackModelRouting | null>(null);
  const [message, setMessage] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: modelRoutingKey(companyId, userId) });
  const onError = (error: Error) => { if (denied(error)) loseAuthority(); };
  const save = useMutation({ retry: false, mutationFn: () => {
    if (!current) throw new Error("Refresh the current policy before saving.");
    return modelRoutingApi.configure(companyId, draft);
  }, onError, onSuccess: async () => { setMessage("Routing policy saved."); await refresh(); } });
  const rollback = useMutation({ retry: false, mutationFn: (input: RollbackModelRouting) => {
    if (!current) throw new Error("Refresh the current release before rolling it back.");
    return modelRoutingApi.rollback(companyId, input);
  }, onError, onSuccess: async () => { setRollbackInput(null); setMessage("Release rolled back for new work."); await refresh(); } });
  const busy = save.isPending || rollback.isPending;
  const adopted = family.releases.filter(item => item.state === "adopted");
  const valid = current && draft.reason.trim().length >= 10 && (draft.mode !== "pinned" || adopted.some(item => item.id === draft.pinnedReleaseId));
  function edit(change: Partial<ConfigureModelRouting>) { save.reset(); setMessage(""); setDraft(value => ({ ...value, ...change, requestKey: crypto.randomUUID() })); }
  return <div className="space-y-4">
    <p className="text-sm">Current policy: {family.policy?.mode ?? "off"}{family.policy ? ` · revision ${family.policy.revision}` : ""}.</p>
    {family.policy && !family.policy.authorityCurrent && <p role="status" className="text-sm text-muted-foreground">Automatic alternatives are disabled until a current company administrator saves the policy with valid authority.</p>}
    {family.policy?.mode === "pinned" && !adopted.some(item => item.id === family.policy?.pinnedReleaseId)
      && <p role="status" className="text-sm text-muted-foreground">The pinned version was rolled back. New work uses the configured baseline.</p>}
    <label className="block space-y-2"><span className="text-sm font-medium">Routing policy</span>
      <select aria-label="Routing policy" className="w-full rounded-md border bg-background p-2 text-base" disabled={!current || busy} value={draft.mode}
        onChange={event => edit({ mode: event.target.value as ConfigureModelRouting["mode"], pinnedReleaseId: event.target.value === "pinned" ? adopted[0]?.id ?? null : null })}>
        <option value="off">Configured baseline</option><option value="automatic">Automatically adopt proven improvements</option><option value="pinned" disabled={!adopted.length}>Pin an adopted version</option>
      </select></label>
    {draft.mode === "pinned" && <label className="block space-y-2"><span className="text-sm font-medium">Pinned version</span>
      <select aria-label="Pinned routing version" className="w-full rounded-md border bg-background p-2 text-base" value={draft.pinnedReleaseId ?? ""} disabled={!current || busy}
        onChange={event => edit({ pinnedReleaseId: event.target.value })}>{adopted.map(item => <option key={item.id} value={item.id}>Version {item.version} · {item.candidateModel}</option>)}</select></label>}
    <p className="text-sm text-muted-foreground">Canary limit: {draft.limits.canaryPercent}% of eligible new tasks, with at most {draft.limits.maximumPending} unreviewed observations. Adoption requires at least {draft.limits.minimumObservations} reviewed cases in each group and {(draft.limits.minimumLatencyImprovement * 100).toFixed(0)}% lower median latency, while meeting quality and repair limits.</p>
    <label className="block space-y-2"><span className="text-sm font-medium">Reason for policy change</span>
      <textarea aria-label="Reason for routing policy change" className="w-full rounded-md border bg-background p-2 text-base" value={draft.reason} maxLength={300} disabled={!current || busy} onChange={event => edit({ reason: event.target.value })} /></label>
    <div className="flex items-center justify-between"><Button variant="ghost" disabled={busy} onClick={() => edit({ mode: family.policy?.mode ?? "off", pinnedReleaseId: family.policy?.pinnedReleaseId ?? null })}>Reset changes</Button>
      <Button disabled={!valid || busy} onClick={() => save.mutate()}>Save routing policy</Button></div>
    {[save.error, rollback.error].filter(Boolean).map((error, index) => <p role="alert" className="text-destructive" key={index}>{error!.message}</p>)}
    {message && <p role="status">{message}</p>}
    {!family.releases.length && <p className="text-sm text-muted-foreground">No routing release has qualified for this task family. The configured baseline remains in use.</p>}
    {!!family.releases.length && <div className="overflow-x-auto"><table className="agentos-data-table"><thead><tr><th>Version</th><th>Model</th><th>State</th><th>Action</th></tr></thead><tbody>
      {family.releases.map(item => <tr key={item.id}><td>{item.version}</td><td>{item.baselineModel} → {item.candidateModel}</td><td>{item.state.replaceAll("_", " ")}</td><td>{item.state !== "rolled_back" && <Button variant="outline" size="sm" disabled={!current || busy}
        onClick={() => { const input = rollbackInput?.releaseId === item.id ? rollbackInput : { requestKey: crypto.randomUUID(), releaseId: item.id, reason: "Owner requested rollback from Models settings." };
          setRollbackInput(input); rollback.mutate(input); }}>Roll back version {item.version}</Button>}</td></tr>)}
    </tbody></table></div>}
    {!!family.events.length && <details><summary className="cursor-pointer text-sm font-medium">Routing history</summary><ul className="mt-2 space-y-2">{family.events.map(item => <li key={item.id} className="text-sm">{new Date(item.createdAt).toLocaleString()} · {item.reason}</li>)}</ul></details>}
  </div>;
}
