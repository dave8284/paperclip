import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AI_PROVIDERS, saveAiExecutionCapacitySchema, type AiExecutionCapacityGroup, type AiExecutionCapacityOverview } from "@paperclipai/shared";
import { api, requestResponse } from "@/api/client";
import { readApiJson } from "@/api/response";
import { adminKey } from "@/api/administration";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function AdminAiCapacity({ userId }: { userId: string | null }) {
  const client = useQueryClient();
  const key = [...adminKey(userId), "ai-capacity"];
  const query = useQuery({ queryKey: key, queryFn: async () => readApiJson(await requestResponse("/instance/ai-execution-capacity", { cache: "no-store" })) as Promise<AiExecutionCapacityOverview> });
  const [editing, setEditing] = useState<AiExecutionCapacityGroup | "new" | null>(null);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-medium">AI capacity</h1><Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</Button></div>
    <p className="text-sm text-muted-foreground">Group connections that use the same subscription seat. Employees and companies in a group share its active-work limit. This limits simultaneous work; it does not increase the provider’s quota or enable API billing.</p>
    {query.isPending && <p role="status">Loading capacity settings…</p>}
    {query.error && <p role="alert" className="text-sm text-destructive">{query.error.message}</p>}
    {query.data && !query.error && <>
      {query.data.groups.map(group => <section key={group.id} className="space-y-3 rounded-xl border border-border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-medium">{group.name}</h2><Button variant="outline" onClick={() => setEditing(group)}>Edit group</Button></div>
        <p className="text-sm">{group.active} active · {group.waiting} waiting · Limit {group.maxConcurrent} · {group.interactiveReserved} reserved for conversation</p>
        {group.overdue > 0 && <p className="text-sm text-muted-foreground">{group.overdue} requests have waited beyond the warning threshold. Their work is saved; uncertain running work keeps its slot until it is verified as finished.</p>}
        <ul className="space-y-1 text-sm text-muted-foreground">{group.bindings.map(binding => {
          const connection = query.data.connections.find(row => row.grantId === binding.grantId);
          return <li key={binding.grantId}>{connection ? `${connection.companyName} · ${connection.connectionName}` : "Disconnected subscription connection"}</li>;
        })}</ul>
      </section>)}
      {query.data.groups.length === 0 && <p className="text-sm">No shared capacity groups are configured.</p>}
      <p className="text-sm text-muted-foreground">{query.data.connections.filter(row => !row.groupId).length} available connections are outside these limits. Add every connection using the same seat to the same group. Host sign-ins without a managed connection are outside these groups.</p>
      {editing === null ? <Button onClick={() => setEditing("new")}>Create capacity group</Button> : <CapacityForm key={editing === "new" ? "new" : `${editing.id}:${editing.revision}`} initial={editing === "new" ? null : editing} data={query.data} onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await client.invalidateQueries({ queryKey: key }); }} />}
    </>}
  </div>;
}

function CapacityForm({ initial, data, onCancel, onSaved }: { initial: AiExecutionCapacityGroup | null; data: AiExecutionCapacityOverview; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [provider, setProvider] = useState<string>(initial?.provider ?? "");
  const [limit, setLimit] = useState(initial ? String(initial.maxConcurrent) : "");
  const [reserve, setReserve] = useState(initial ? String(initial.interactiveReserved) : "");
  const [warning, setWarning] = useState(initial ? String(initial.waitWarningMs / 1000) : "");
  const [priority, setPriority] = useState(initial?.interactivePriority ?? false);
  const [selected, setSelected] = useState(initial?.bindings.map(row => row.grantId) ?? []);
  const save = useMutation({ mutationFn: () => api.post("/instance/ai-execution-capacity", saveAiExecutionCapacitySchema.parse({
    ...(initial ? { id: initial.id, expectedRevision: initial.revision } : {}),
    policy: { name, provider, maxConcurrent: Number(limit), interactiveReserved: Number(reserve), interactivePriority: priority, waitWarningMs: Number(warning) * 1000 },
    bindings: [...data.connections, ...(initial?.bindings.filter(row => !data.connections.some(connection => connection.grantId === row.grantId)) ?? [])]
      .filter(row => selected.includes(row.grantId)).map(({ companyId, connectionId, grantId }) => ({ companyId, connectionId, grantId })),
  })), onSuccess: onSaved });
  return <form className="space-y-4 rounded-xl border border-border p-5" aria-label={initial ? "Edit capacity group" : "Create capacity group"} onSubmit={event => { event.preventDefault(); save.mutate(); }}>
    <h2 className="font-medium">{initial ? "Edit capacity group" : "Create capacity group"}</h2>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-2 text-sm">Group name<Input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="space-y-2 text-sm">Provider<select required disabled={Boolean(initial)} className="w-full rounded-md border border-input bg-background px-3 py-2" value={provider} onChange={event => { setProvider(event.target.value); setSelected([]); }}><option value="">Choose provider</option>{AI_PROVIDERS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="space-y-2 text-sm">Maximum simultaneous work<Input required type="number" min={1} max={32} value={limit} onChange={event => setLimit(event.target.value)} /></label>
      <label className="space-y-2 text-sm">Slots reserved for conversation<Input required type="number" min={0} max={Math.max(0, Number(limit) - 1)} value={reserve} onChange={event => setReserve(event.target.value)} /></label>
      <label className="space-y-2 text-sm">Warn after waiting (seconds)<Input required type="number" min={1} max={86400} value={warning} onChange={event => setWarning(event.target.value)} /></label>
    </div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={priority} onChange={event => setPriority(event.target.checked)} />Give conversations priority over newer background work</label>
    <p className="text-sm text-muted-foreground">Older requests move ahead after the warning threshold. Reserved conversation slots stay available for conversation. Waiting does not cancel a task or interrupt work already running.</p>
    <fieldset className="space-y-2"><legend className="text-sm font-medium">Connections using this seat</legend>{data.connections.filter(row => row.provider === provider && (!row.groupId || row.groupId === initial?.id)).map(row => <label key={row.grantId} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(row.grantId)} onChange={event => setSelected(current => event.target.checked ? [...current, row.grantId] : current.filter(id => id !== row.grantId))} />{row.companyName} · {row.connectionName}</label>)}{provider && !data.connections.some(row => row.provider === provider && (!row.groupId || row.groupId === initial?.id)) && <p className="text-sm text-muted-foreground">No available managed subscription connections for this provider.</p>}</fieldset>
    {initial?.bindings.filter(row => !data.connections.some(connection => connection.grantId === row.grantId)).map(row => <label key={row.grantId} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(row.grantId)} onChange={event => setSelected(current => event.target.checked ? [...current, row.grantId] : current.filter(id => id !== row.grantId))} />Disconnected connection · remove it to save an updated group</label>)}
    {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
    <div className="flex items-center justify-between gap-3"><Button type="button" variant="ghost" onClick={onCancel} disabled={save.isPending}>Cancel</Button><Button disabled={save.isPending || (!initial && selected.length === 0)}>{save.isPending ? "Saving…" : "Save capacity group"}</Button></div>
  </form>;
}
