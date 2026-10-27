import type { Analytics } from "@agentos/model-intelligence";
import type { Company } from "@paperclipai/shared";
import { ModelIntelligenceInsights } from "./ModelIntelligenceInsights";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aiConnectionsApi } from "@/api/ai-connections";
import { companiesApi } from "@/api/companies";
import { api } from "@/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { AgentOSConnectors } from "./AgentOSConnectors";
import { AgentOSVoiceSettings } from "./AgentOSVoiceSettings";
import { AgentOSDelete } from "./AgentOSDelete";
import { Button } from "./ui/button";

function CompanyPreferences({ company, onRemoved }: { company: Company; onRemoved?: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState(company.name);
  const [description, setDescription] = useState(company.description ?? "");
  const [requireApproval, setRequireApproval] = useState(company.requireBoardApprovalForNewAgents);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => companiesApi.update(company.id, { name: name.trim(), description: description.trim() || null, requireBoardApprovalForNewAgents: requireApproval }),
    onSuccess: async () => {
      setSaved(true);
      await client.invalidateQueries({ queryKey: queryKeys.companies.all });
      await client.invalidateQueries({ queryKey: ["agentos-company-settings", company.id] });
    },
  });
  return <section className="space-y-8" aria-label="Company settings">
    <form className="max-w-2xl space-y-5" onSubmit={event => { event.preventDefault(); setSaved(false); save.mutate(); }} onChange={() => setSaved(false)}>
      <div><h2 className="text-lg font-semibold">Company information</h2><p className="mt-2 text-sm text-muted-foreground">Profile and hiring preferences for {company.name}. Friday remains your portfolio coordinator.</p></div>
      <label className="block text-sm">Company name<input className="mt-2 w-full rounded-lg border bg-background p-3" value={name} onChange={event => setName(event.target.value)} required maxLength={200} /></label>
      <label className="block text-sm">Purpose and description<textarea className="mt-2 min-h-28 w-full rounded-lg border bg-background p-3" value={description} onChange={event => setDescription(event.target.value)} /></label>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={requireApproval} onChange={event => setRequireApproval(event.target.checked)} /><span>Require approval for new agents<span className="mt-1 block text-muted-foreground">Company leads can propose hires; you approve before the agent joins.</span></span></label>
      <div className="flex items-center gap-4"><Button type="submit" disabled={save.isPending || !name.trim()}>{save.isPending ? "Saving…" : "Save company"}</Button>{saved && <p role="status" className="text-sm text-muted-foreground">Company preferences saved.</p>}</div>
      {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
    </form>
    <div className="space-y-3"><h3 className="font-semibold">Access and operations</h3><div className="flex flex-wrap gap-4 text-sm"><Link to="/company/settings">Branding and advanced company settings</Link><Link to="/company/settings/members">People and access</Link><Link to="/applications">Applications and repositories</Link><Link to="/teams-catalog?search=AgentOS">Operating teams</Link></div></div>
    <div className="max-w-2xl space-y-3 border-t pt-6"><h3 className="font-semibold">Archive or delete company</h3><p className="text-sm text-muted-foreground">Archive to retain work and history. Permanent deletion removes this company’s records; shared employees in other companies are retained. You will review the action before anything changes.</p><AgentOSDelete kind="company" id={company.id} companyId={company.id} name={company.name} onRemoved={onRemoved} /></div>
  </section>;
}

export function AgentOSSettings({ companyId, onCompanyRemoved }: { companyId: string; onCompanyRemoved?: () => void }) {
  const [tab, setTab] = useState("Company");
  const company = useQuery({ queryKey: ["agentos-company-settings", companyId], queryFn: () => companiesApi.get(companyId), enabled: tab === "Company" });
  const models = useQuery({ queryKey: ["ai-connections", companyId], queryFn: () => aiConnectionsApi.list(companyId), enabled: tab === "Models" });
  const catalog = useQuery({ queryKey: ["model-catalog", companyId], queryFn: () => api.get<{ learning: Analytics | null; learningAccess?: "admin" | "restricted"; models: Array<{ id: string; label: string; provider: string; observed: boolean; configuredAgents: Array<{ id: string; name: string }> }> }>(`/companies/${companyId}/friday/models`), enabled: tab === "Models" });
  const connectedProviders = new Set(models.data?.connections.filter(connection => connection.method === "subscription" && connection.status === "connected").map(connection => connection.provider));
  return <div className="space-y-6"><nav className="agentos-workspace-tabs" aria-label="Settings sections">{["Company", "Voice", "Connectors", "Models"].map(label => <button type="button" key={label} aria-current={tab === label ? "page" : undefined} onClick={() => setTab(label)}>{label}</button>)}</nav>
    {[models.error, catalog.error].filter(Boolean).map((error, index) => <p role="alert" key={index} className="text-destructive">{error!.message}</p>)}
    {tab === "Connectors" && <AgentOSConnectors companyId={companyId} />}
    {tab === "Voice" && <AgentOSVoiceSettings companyId={companyId} />}
    {tab === "Models" && <section className="space-y-4">{catalog.data?.learning && <ModelIntelligenceInsights learning={catalog.data.learning} />}{catalog.data?.learningAccess === "restricted" && <p className="text-sm text-muted-foreground">Company-wide learning and evaluations are available to instance administrators because they include private project work.</p>}<h2 className="text-lg font-semibold">Subscription seats</h2><p className="text-sm text-muted-foreground">Only connected subscription accounts can power company agents. Model access and limits come from the selected account and harness.</p><div className="overflow-x-auto"><table className="agentos-data-table"><thead><tr><th>Account</th><th>Provider</th><th>Billing</th><th>Status</th><th>Access</th></tr></thead><tbody>{models.data?.connections.map(connection => <tr key={connection.grantId}><td>{connection.name}</td><td>{connection.provider}</td><td>{connection.method}</td><td>{connection.status.replaceAll("_", " ")}</td><td><Link to={`/apps/${connection.id}/permissions`}>Manage</Link></td></tr>)}</tbody></table></div><div className="flex gap-4 text-sm"><Link to="/apps/connect?source=openai">Connect Codex</Link><Link to="/apps/connect?source=anthropic">Connect Claude</Link><Link to="/admin?tab=intelligence">Model intelligence and evaluations</Link></div><h3 className="font-semibold">Model catalogue for connected providers</h3><p className="text-sm text-muted-foreground">Models supported by the installed harness. An observed subscription receipt is evidence of previous use; current account entitlement is checked again when work starts. Unproven profiles cannot replace your configured model automatically.</p><div className="overflow-x-auto"><table className="agentos-data-table"><thead><tr><th>Model</th><th>Subscription evidence</th><th>Configured employees</th></tr></thead><tbody>{catalog.data?.models.filter(model => connectedProviders.has(model.provider as "openai" | "anthropic")).map(model => <tr key={`${model.provider}:${model.id}`}><td>{model.label}</td><td>{model.observed ? "Observed in this company" : "Not yet observed"}</td><td>{model.configuredAgents.map(agent => agent.name).join(", ") || "—"}</td></tr>)}</tbody></table></div></section>}
    {tab === "Company" && (company.isPending ? <p role="status">Reading company settings…</p> : company.error ? <p role="alert" className="text-destructive">{company.error.message}</p> : company.data && <CompanyPreferences key={companyId} company={company.data} onRemoved={onCompanyRemoved} />)}
  </div>;
}
