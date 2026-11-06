import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aiConnectionsApi } from "@/api/ai-connections";
import { toolsApi } from "@/api/tools";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { Button } from "./ui/button";
import { agentosConnectorCatalog, isInitialAgentOSConnector } from "@/lib/agentos-connectors";

export function AgentOSConnectors({ companyId }: { companyId: string }) {
  return <ConnectorScope key={companyId} companyId={companyId} />;
}

function ConnectorScope({ companyId }: { companyId: string }) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [showOtherSaved, setShowOtherSaved] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string; ai: boolean } | null>(null);
  const seats = useQuery({ queryKey: ["ai-connections", companyId], queryFn: () => aiConnectionsApi.list(companyId) });
  const tools = useQuery({ queryKey: queryKeys.tools.connections(companyId), queryFn: () => toolsApi.listConnections(companyId) });
  const gallery = useQuery({ queryKey: ["agentos-connector-gallery", companyId], queryFn: () => toolsApi.listGallery(companyId) });
  const grants = useQuery({ queryKey: queryKeys.tools.connectionGrants(removing?.id ?? ""), queryFn: () => toolsApi.listConnectionGrants(removing!.id), enabled: !!removing });
  const readable = seats.isSuccess && tools.isSuccess;
  const canDisconnect = readable && grants.isSuccess && !grants.isFetching && grants.data.capabilities.canConfigure;
  const remove = useMutation({ mutationFn: async () => {
    if (!removing || !canDisconnect || !connections.some(row => row.id === removing.id)) throw new Error("You cannot disconnect this connection.");
    if (removing.ai && (await aiConnectionsApi.activeRuns(companyId, removing.id)).length) throw new Error("This seat is executing work. Wait for its runs to finish before disconnecting it.");
    return toolsApi.archiveConnection(removing.id);
  }, onSuccess: async () => { setRemoving(null); await Promise.all([client.invalidateQueries({ queryKey: queryKeys.tools.connections(companyId) }), client.invalidateQueries({ queryKey: ["ai-connections", companyId] })]); } });
  const seen = new Set<string>();
  const connections = (readable ? [
    ...(seats.data?.connections ?? []).map(row => ({ id: row.id, name: row.name, provider: row.provider, status: row.status.replaceAll("_", " "), detail: row.method === "subscription" ? "Subscription seat" : row.method, ai: true, setup: false })),
    ...(tools.data?.connections ?? []).filter(row => row.status !== "archived").map(row => ({ id: row.id, name: row.name, provider: typeof row.config?.sourceTemplateKey === "string" ? row.config.sourceTemplateKey : "Tool connection", status: row.status === "draft" ? "Sign-in required" : row.enabled ? row.healthStatus.replaceAll("_", " ") : "Disabled", detail: row.ownership, ai: row.connectionPurpose === "ai", setup: row.status === "draft" })),
  ] : []).filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; });
  const apps = agentosConnectorCatalog(gallery.isSuccess ? gallery.data.apps : []).filter(app => `${app.name} ${app.description}`.toLowerCase().includes(search.toLowerCase()));
  const otherCount = connections.filter(row => !isInitialAgentOSConnector(row.provider)).length;
  const visibleConnections = connections.filter(row => showOtherSaved || isInitialAgentOSConnector(row.provider));
  const selectedRemoval = removing && connections.some(row => row.id === removing.id) ? removing : null;
  const manageHref = (row: typeof connections[number]) => row.setup ? `/apps/connect?source=${encodeURIComponent(row.provider)}&resume=${encodeURIComponent(row.id)}` : `/apps/${row.id}/permissions`;
  return <section className="space-y-6"><div><h2 className="text-lg font-semibold">Connectors</h2><p className="mt-2 text-sm text-muted-foreground">Accounts and tools available to this company. Access follows each employee’s permissions. Live Stripe changes still require explicit approval.</p></div>
    {[seats.error, tools.error, gallery.error, grants.error, remove.error].filter(Boolean).map((error, index) => <p key={index} role="alert" className="text-destructive">{error!.message}</p>)}
    {(seats.isError || tools.isError || gallery.isError || grants.isError) && <Button variant="outline" onClick={() => { void seats.refetch(); void tools.refetch(); void gallery.refetch(); if (selectedRemoval) void grants.refetch(); }}>Retry connectors</Button>}
    <div className="overflow-x-auto"><table className="agentos-data-table"><caption className="text-left text-sm font-semibold">Your connections</caption><thead><tr><th>Account</th><th>Connector</th><th>Status</th><th>Access</th><th>Manage</th></tr></thead><tbody>{visibleConnections.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.provider}</td><td><span className="agentos-pill">{row.status}</span></td><td>{row.detail}</td><td><div className="flex gap-2"><Button asChild size="sm" variant="ghost"><Link to={manageHref(row)}>{row.setup ? "Finish sign-in" : "Edit"}</Link></Button><Button size="sm" variant="ghost" onClick={() => { remove.reset(); setRemoving(row); }}>Disconnect</Button></div></td></tr>)}</tbody></table>{!visibleConnections.length && readable && <p className="agentos-empty">No connected accounts yet.</p>}</div>
    {otherCount > 0 && <Button variant="ghost" size="sm" aria-expanded={showOtherSaved} onClick={() => setShowOtherSaved(value => !value)}>{showOtherSaved ? "Hide other saved connections" : `Other saved connections (${otherCount})`}</Button>}
    {selectedRemoval && <section className="space-y-3 rounded-xl border p-5" aria-label="Confirm disconnect"><h3 className="font-semibold">Disconnect {selectedRemoval.name}?</h3><p className="text-sm">This removes this connection’s credentials and agent access. Shared users and employees relying on this connection lose access too; reconnecting will require signing in again.</p>{grants.isSuccess && !grants.data.capabilities.canConfigure && <p role="alert" className="text-sm">Only a connection administrator can disconnect it.</p>}<div className="flex justify-between"><Button variant="ghost" disabled={remove.isPending} onClick={() => setRemoving(null)}>Cancel</Button><Button variant="destructive" disabled={remove.isPending || !canDisconnect} onClick={() => remove.mutate()}>Disconnect</Button></div></section>}
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Available connectors</h3><input className="rounded-lg border bg-background p-3 text-sm" aria-label="Search connectors" placeholder="Find a connector…" value={search} onChange={event => setSearch(event.target.value)} /></div>
    <div className="agentos-project-grid">{apps.map(app => { const connected = connections.filter(row => row.provider === app.slug); return <section className="space-y-3 rounded-xl border p-5" key={app.slug}><h3 className="font-semibold">{app.name}</h3><p className="text-sm text-muted-foreground">{app.description}</p>{connected.length ? <><p className="text-sm">{connected.length} managed {connected.length === 1 ? "connection" : "connections"}</p>{connected.map(row => <Button key={row.id} asChild variant="outline" size="sm"><Link to={manageHref(row)}>{row.setup ? "Finish sign-in:" : "Edit"} {row.name}</Link></Button>)}</> : app.availability?.available === false ? <p className="text-sm text-muted-foreground">{app.availability.reason ?? "Unavailable on this installation"}</p> : readable ? <Button asChild variant="outline" size="sm"><Link to={`/apps/connect?source=${encodeURIComponent(app.slug)}`}>Connect</Link></Button> : <p className="text-sm text-muted-foreground">Connection status unavailable</p>}</section>; })}</div>
    {gallery.isPending && <p role="status">Loading available connectors…</p>}
  </section>;
}
