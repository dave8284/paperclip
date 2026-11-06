import type { Company } from "@paperclipai/shared";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { companiesApi } from "@/api/companies";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { AgentOSConnectors } from "./AgentOSConnectors";
import { AgentOSModelSettings } from "./AgentOSModelSettings";
import { AgentOSVoiceSettings } from "./AgentOSVoiceSettings";
import { AgentOSDelete } from "./AgentOSDelete";
import { Button } from "./ui/button";
import type { VoiceTimingContext } from "@/lib/friday-voice-session";

function CompanyPreferences({ company, onRemoved }: { company: Company; onRemoved?: () => void }) {
  const client = useQueryClient();
  const internal = company.purpose === "platform";
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
  return <section className="space-y-8" aria-label={internal ? "Platform settings" : "Company settings"}>
    <form className="max-w-2xl space-y-5" onSubmit={event => { event.preventDefault(); setSaved(false); save.mutate(); }} onChange={() => setSaved(false)}>
      <div><h2 className="text-lg font-semibold">{internal ? "Platform information" : "Company information"}</h2><p className="mt-2 text-sm text-muted-foreground">{internal ? "Friday, shared connections and platform configuration. This internal context is separate from your companies." : `Profile and hiring preferences for ${company.name}. Friday remains your portfolio coordinator.`}</p></div>
      <label className="block text-sm">{internal ? "Platform name" : "Company name"}<input className="mt-2 w-full rounded-lg border bg-background p-3" value={name} onChange={event => setName(event.target.value)} required maxLength={200} /></label>
      <label className="block text-sm">Purpose and description<textarea className="mt-2 min-h-28 w-full rounded-lg border bg-background p-3" value={description} onChange={event => setDescription(event.target.value)} /></label>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={requireApproval} onChange={event => setRequireApproval(event.target.checked)} /><span>Require approval for new agents<span className="mt-1 block text-muted-foreground">Company leads can propose hires; you approve before the agent joins.</span></span></label>
      <div className="flex items-center gap-4"><Button type="submit" disabled={save.isPending || !name.trim()}>{save.isPending ? "Saving…" : internal ? "Save platform" : "Save company"}</Button>{saved && <p role="status" className="text-sm text-muted-foreground">{internal ? "Platform preferences saved." : "Company preferences saved."}</p>}</div>
      {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
    </form>
    <div className="space-y-3"><h3 className="font-semibold">Access and operations</h3><div className="flex flex-wrap gap-4 text-sm"><Link to="/company/settings">Branding and advanced company settings</Link><Link to="/company/settings/members">People and access</Link><Link to="/applications">Applications and repositories</Link><Link to="/teams-catalog?search=AgentOS">Operating teams</Link></div></div>
    {!internal && <div className="max-w-2xl space-y-3 border-t pt-6"><h3 className="font-semibold">Archive or delete company</h3><p className="text-sm text-muted-foreground">Archive to retain work and history. Permanent deletion removes this company’s records; shared employees in other companies are retained. You will review the action before anything changes.</p><AgentOSDelete kind="company" id={company.id} companyId={company.id} name={company.name} onRemoved={onRemoved} /></div>}
  </section>;
}

export function AgentOSSettings({ companyId, voiceContext, onCompanyRemoved }: { companyId: string; voiceContext?: VoiceTimingContext; onCompanyRemoved?: () => void }) {
  const [tab, setTab] = useState("Company");
  const company = useQuery({ queryKey: ["agentos-company-settings", companyId], queryFn: () => companiesApi.get(companyId), enabled: tab === "Company" });
  return <div className="space-y-6"><nav className="agentos-workspace-tabs" aria-label="Settings sections">{["Company", "Voice", "Connectors", "Models"].map(label => <button type="button" key={label} aria-current={tab === label ? "page" : undefined} onClick={() => setTab(label)}>{label === "Company" && company.data?.purpose === "platform" ? "Platform" : label}</button>)}</nav>
    {tab === "Connectors" && <AgentOSConnectors companyId={companyId} />}
    {tab === "Voice" && <AgentOSVoiceSettings companyId={companyId} voiceContext={voiceContext} />}
    {tab === "Models" && <AgentOSModelSettings companyId={companyId} />}
    {tab === "Company" && (company.isPending ? <p role="status">Reading company settings…</p> : company.error ? <p role="alert" className="text-destructive">{company.error.message}</p> : company.data && <CompanyPreferences key={companyId} company={company.data} onRemoved={onCompanyRemoved} />)}
  </div>;
}
