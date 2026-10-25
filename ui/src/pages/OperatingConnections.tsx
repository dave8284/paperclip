import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plug } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { toolsApi } from "../api/tools";
import { aiConnectionsApi } from "../api/ai-connections";
import { queryKeys } from "../lib/queryKeys";
import { Link } from "../lib/router";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { EmptyState } from "../components/EmptyState";

export function OperatingConnections() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [connectionId, setConnectionId] = useState("");
  const connections = useQuery({ queryKey: queryKeys.tools.connections(selectedCompanyId!), queryFn: () => toolsApi.listConnections(selectedCompanyId!), enabled: !!selectedCompanyId });
  const models = useQuery({ queryKey: ["ai-connections", selectedCompanyId], queryFn: () => aiConnectionsApi.list(selectedCompanyId!), enabled: !!selectedCompanyId });
  const selected = connections.data?.connections.find(connection => connection.id === connectionId);
  const catalog = useQuery({ queryKey: queryKeys.tools.catalog(connectionId), queryFn: () => toolsApi.listCatalog(connectionId), enabled: !!selected });
  useEffect(() => { setConnectionId(""); }, [selectedCompanyId]);
  useEffect(() => setBreadcrumbs([{ label: "Applications", href: "/applications" }, { label: "Operating connections" }]), [setBreadcrumbs]);
  if (!selectedCompanyId) return <EmptyState icon={Plug} message="Select an organization to inspect connections." />;
  const activeTools = catalog.data?.catalog.filter(tool => tool.status === "active" && tool.entryKind === "tool") ?? [];
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">Operating connections</h1><p className="text-sm text-muted-foreground">Organization connections, reported health, and discovered capabilities.</p></div>
    <div className="flex flex-wrap gap-4 text-sm"><Link to="/apps" className="text-primary">Connect an account</Link><Link to="/agents" className="text-primary">Agent access</Link><Link to="/routines" className="text-primary">Recurring work</Link><Link to="/applications" className="text-primary">Application portfolio</Link></div>
    {[connections.error, catalog.error, models.error].filter(Boolean).map((error, index) => <p role="alert" key={index} className="text-sm text-destructive">{error!.message}</p>)}
    <Card><CardHeader><CardTitle>Model accounts</CardTitle></CardHeader><CardContent className="space-y-3">
      {models.isLoading && <p className="text-sm text-muted-foreground">Loading model accounts…</p>}
      {models.data?.connections.length === 0 && <p className="text-sm text-muted-foreground">No model account is connected. Connect an account and assign it through the agent settings before starting work.</p>}
      {models.data?.connections.map(connection => <div key={connection.grantId} className="flex flex-wrap justify-between gap-3 text-sm"><Link className="text-primary" to={`/apps/${connection.id}/permissions`}>{connection.name}</Link><span className="text-muted-foreground">{connection.provider} · {connection.status.replaceAll("_", " ")}{connection.isDefault ? " · Your default" : ""}</span></div>)}
      <div className="flex flex-wrap gap-4 text-sm"><Link className="text-primary" to="/apps/connect?source=openai">Connect OpenAI / Codex</Link><Link className="text-primary" to="/apps/connect?source=anthropic">Connect Anthropic / Claude</Link><Link className="text-primary" to="/agents">Configure agent accounts</Link></div>
      <p className="text-xs text-muted-foreground">Account status is reported by Paperclip. Agent grants, runtime compatibility, and budget limits still determine whether a run can start.</p>
    </CardContent></Card>
    {connections.isLoading && <p className="text-sm text-muted-foreground">Loading connections…</p>}
    {connections.data?.connections.length === 0 && <EmptyState icon={Plug} message="No connections configured yet. Connect accounts to make their capabilities available to your agents." />}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{connections.data?.connections.map(connection => <Card key={connection.id}>
      <CardHeader><CardTitle>{connection.name}</CardTitle><p className="text-sm text-muted-foreground">{connection.enabled ? "Enabled" : "Disabled"} · {connection.healthStatus.replaceAll("_", " ")}</p></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{connection.healthCheckedAt ? `Last checked ${new Date(connection.healthCheckedAt).toLocaleString()}` : "Health has not been checked."}</p>
        <div className="flex flex-wrap items-center gap-3"><Button variant="outline" onClick={() => setConnectionId(connection.id)}>Inspect capabilities</Button><Link to={`/apps/${connection.id}/permissions`} className="text-sm text-primary">Configure access →</Link></div>
      </CardContent>
    </Card>)}</div>
    {selected && <Card><CardHeader><CardTitle>{selected.name} capabilities</CardTitle></CardHeader><CardContent className="space-y-4">
      {catalog.isLoading ? <p>Loading capability catalog…</p> : <>
        <p className="text-sm">{activeTools.filter(tool => tool.isReadOnly).length} read tools · {activeTools.filter(tool => tool.isWrite).length} write tools · {activeTools.filter(tool => tool.isDestructive).length} destructive tools</p>
        <p className="text-xs text-muted-foreground">These are discovered tools. Each invocation still checks the agent's installation, permissions, and any required approval. Connection health does not prove application health.</p>
        <div className="divide-y">{activeTools.map(tool => <div key={tool.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>{tool.title ?? tool.toolName}</span><span className="text-muted-foreground">{tool.isDestructive ? "Destructive" : tool.isWrite ? "Write" : tool.isReadOnly ? "Read" : "Unclassified"}</span></div>)}</div>
        {!catalog.error && activeTools.length === 0 && <p className="text-sm text-muted-foreground">No active tools discovered. Open the connection to check setup and refresh its catalog.</p>}
      </>}
    </CardContent></Card>}
    <Card><CardHeader><CardTitle>Operating coverage</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
      <p><strong>GitHub:</strong> use the native GitHub connection for repository access and review. A registered repository URL does not establish that connection.</p>
      <p><strong>Vercel:</strong> the native connector supports project and deployment operations within the connected team's authority.</p>
      <p><strong>Google Cloud:</strong> connect a reviewed MCP endpoint through Apps, or use an explicitly configured execution environment. This fork has no preconfigured Google Cloud account or qualified deployment.</p>
      <p><strong>Marketing, sales, and support:</strong> connect the actual analytics, publishing, CRM, email, and helpdesk providers. Drafts and plans can exist before outbound capabilities are enabled.</p>
    </CardContent></Card>
  </div>;
}
