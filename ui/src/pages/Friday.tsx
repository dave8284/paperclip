import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Settings2 } from "lucide-react";
import { operatingProfileApi, operatingProfileKey } from "../api/operating-profile";
import { agentsApi } from "../api/agents";
import { aiConnectionsApi } from "../api/ai-connections";
import { instanceSettingsApi } from "../api/instanceSettings";
import { useCompany } from "../context/CompanyContext";
import { useAgentChatEnabled } from "../hooks/useAgentChatEnabled";
import { queryKeys } from "../lib/queryKeys";
import { Link } from "../lib/router";
import { Button } from "../components/ui/button";
import { AgentChat } from "./AgentChat";
import { PortfolioGalaxy } from "../components/PortfolioGalaxy";

export function Friday() {
  const { selectedCompanyId } = useCompany();
  return selectedCompanyId ? <FridayCompany key={selectedCompanyId} companyId={selectedCompanyId} />
    : <p className="text-sm text-muted-foreground">Select an organization to talk to Friday.</p>;
}

function FridayCompany({ companyId }: { companyId: string }) {
  const client = useQueryClient();
  const profile = useQuery({ queryKey: operatingProfileKey(companyId), queryFn: () => operatingProfileApi.get(companyId) });
  const agents = useQuery({ queryKey: queryKeys.agents.list(companyId), queryFn: () => agentsApi.list(companyId) });
  const models = useQuery({ queryKey: ["ai-connections", companyId], queryFn: () => aiConnectionsApi.list(companyId) });
  const [selectedAgent, setSelectedAgent] = useState("");
  const [settings, setSettings] = useState(false);
  const chat = useAgentChatEnabled();
  const save = useMutation({
    mutationFn: () => operatingProfileApi.update(companyId, { fridayAgentId: selectedAgent || null, expectedRevision: profile.data!.revision }),
    onSuccess: next => { client.setQueryData(operatingProfileKey(companyId), next); setSettings(false); },
  });
  const enableChat = useMutation({
    mutationFn: () => instanceSettingsApi.updateExperimental({ enableAgentChat: true }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.instance.experimentalSettings }),
  });
  const error = profile.error ?? agents.error ?? models.error ?? save.error ?? enableChat.error;
  const fridayId = profile.data?.fridayAgentId;
  if (profile.isPending) return <p className="text-sm text-muted-foreground">Loading Friday…</p>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Friday</h1><p className="text-sm text-muted-foreground">One conversation. Your applications, teams, and decisions.</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => { setSelectedAgent(fridayId ?? ""); setSettings(value => !value); }}><Settings2 />Configure Friday</Button><Button variant="outline" asChild><Link to="/operating-connections">Connections</Link></Button></div>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
    {!models.error && models.data && !models.data.connections.some(connection => connection.method === "subscription") && <div role="status" className="space-y-2 rounded-xl border p-4"><p className="text-sm">Friday needs a connected subscription before she can respond or delegate work. You can still type or dictate a draft.</p><div className="flex flex-wrap gap-4 text-sm"><Link to="/apps/connect?source=openai" className="text-primary">Connect ChatGPT / Codex</Link><Link to="/apps/connect?source=anthropic" className="text-primary">Connect Claude</Link></div></div>}
    {profile.data && (settings || !fridayId) && <section className="space-y-3 rounded-xl border p-4" aria-label="Friday configuration">
      <h2 className="font-medium">Choose your coordinator</h2>
      <p className="text-sm text-muted-foreground">Install the operating team, then bind its Friday agent here. Friday can manage the application registry; tasks, hiring, connections, and releases keep their existing permissions. Binding Friday enables subscription-only model execution for this organization, including helper features.</p>
      <select aria-label="Friday agent" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={selectedAgent} onChange={event => setSelectedAgent(event.target.value)}><option value="">No coordinator</option>{(agents.data ?? []).filter(agent => !["terminated", "pending_approval"].includes(agent.status)).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
      <div className="flex items-center justify-between gap-3"><Link to="/teams-catalog?search=AgentOS" className="text-sm text-primary">Install operating team</Link><Button disabled={save.isPending} onClick={() => save.mutate()}>Save coordinator</Button></div>
    </section>}
    <div className="agentos-command-center">
      <section className="agentos-friday-conversation" aria-label="Conversation with Friday">
        {fridayId && chat.enabled ? <AgentChat agentRef={fridayId} voice /> : <div className="space-y-3 p-4"><MessageCircle /><p className="text-sm text-muted-foreground">{fridayId ? "Enable durable conversations to talk to Friday. Your model subscription must also be connected before Friday can respond." : "Bind Friday to start a conversation. Your portfolio remains available alongside it."}</p>{fridayId && chat.loaded && <Button disabled={enableChat.isPending} onClick={() => enableChat.mutate()}>Enable conversations</Button>}</div>}
      </section>
      <section className="agentos-command-work" aria-label="Portfolio alongside Friday"><PortfolioGalaxy companyId={companyId} /></section>
    </div>
  </div>;
}
