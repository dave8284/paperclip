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
import { FridayWorkspace, type FridayPanel } from "../components/FridayWorkspace";
import { FridayOrb } from "../components/FridayOrb";

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
  const [transcript, setTranscript] = useState(false);
  const [panel, setPanel] = useState<FridayPanel>(null);
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
  const connected = !models.error && !!models.data?.connections.some(connection => connection.method === "subscription");
  return <div className="friday-home">
    <header className="friday-toolbar">
      <div><h1 className="text-sm font-medium">Friday</h1><p className="text-xs text-muted-foreground">Your command centre</p></div>
      <nav className="flex flex-wrap items-center gap-1" aria-label="Friday navigation">
        <Button size="sm" variant={transcript ? "secondary" : "ghost"} aria-pressed={transcript} onClick={() => setTranscript(value => !value)}>Conversation</Button>
        <Button size="sm" variant={panel === "portfolio" ? "secondary" : "ghost"} aria-pressed={panel === "portfolio"} onClick={() => setPanel(value => value === "portfolio" ? null : "portfolio")}>Portfolio</Button>
        <Button size="sm" variant={panel === "library" ? "secondary" : "ghost"} aria-pressed={panel === "library"} onClick={() => setPanel(value => value === "library" ? null : "library")}>Displays</Button>
        <details className="friday-navigation"><summary className="cursor-pointer rounded-md px-3 py-2 text-sm">Explore</summary><div className="friday-navigation-menu">
          <Link to="/dashboard">Dashboard</Link><Link to="/projects">Projects</Link><Link to="/applications">Applications</Link><Link to="/agents">Agents</Link><Link to="/inbox">Decisions & inbox</Link><Link to="/operating-connections">Connections</Link>
          <Button size="sm" variant="ghost" onClick={() => { setSelectedAgent(fridayId ?? ""); setSettings(value => !value); }}><Settings2 />Configure Friday</Button>
        </div></details>
      </nav>
    </header>
    {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
    {!models.error && models.data && !connected && <div role="status" className="friday-connection-notice"><span>Connect a subscription to let Friday respond and delegate.</span><Link to="/apps/connect?source=openai">Connect Codex</Link><Link to="/apps/connect?source=anthropic">Connect Claude</Link></div>}
    {profile.data && (settings || !fridayId) && <section className="space-y-3 rounded-xl border p-4" aria-label="Friday configuration">
      <h2 className="font-medium">Choose your coordinator</h2>
      <p className="text-sm text-muted-foreground">Install the operating team, then bind its Friday agent here. Friday can manage the application registry; tasks, hiring, connections, and releases keep their existing permissions. Binding Friday enables subscription-only model execution for this organization, including helper features.</p>
      <select aria-label="Friday agent" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={selectedAgent} onChange={event => setSelectedAgent(event.target.value)}><option value="">No coordinator</option>{(agents.data ?? []).filter(agent => !["terminated", "pending_approval"].includes(agent.status)).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
      <div className="flex items-center justify-between gap-3"><Link to="/teams-catalog?search=AgentOS" className="text-sm text-primary">Install operating team</Link><Button disabled={save.isPending} onClick={() => save.mutate()}>Save coordinator</Button></div>
    </section>}
    <section className="friday-conversation" aria-label="Conversation with Friday">
      {fridayId && chat.enabled && !profile.error ? <AgentChat key={fridayId} agentRef={fridayId} focusView={{
        showTranscript: transcript,
        render: data => <FridayWorkspace key={fridayId} companyId={companyId} data={data} panel={panel} setPanel={setPanel} compact={transcript} connected={connected} />,
      }} /> : <div className="friday-unconfigured">
        <FridayOrb state="offline" label="Friday is not connected" />
        <MessageCircle /><p className="text-sm text-muted-foreground">{fridayId ? "Enable conversations to talk to Friday." : "Choose your coordinator above to begin."}</p>
        {fridayId && chat.loaded && <Button disabled={enableChat.isPending} onClick={() => enableChat.mutate()}>Enable conversations</Button>}
      </div>}
    </section>
  </div>;
}
