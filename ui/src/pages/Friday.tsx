import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { operatingProfileApi, operatingProfileKey } from "../api/operating-profile";
import { agentsApi } from "../api/agents";
import { aiConnectionsApi } from "../api/ai-connections";
import { instanceSettingsApi } from "../api/instanceSettings";
import { useTheme } from "../context/ThemeContext";
import { useCompany } from "../context/CompanyContext";
import { useAgentChatEnabled } from "../hooks/useAgentChatEnabled";
import { queryKeys } from "../lib/queryKeys";
import { Link, useLocation, useNavigate } from "../lib/router";
import { fridayConversationView, fridayNavigationSearch, readFridayNavigation, type FridayNavigation } from "../lib/friday-navigation";
import type { AgentConversationFocusData } from "../lib/conversation-focus";
import { Button } from "../components/ui/button";
import { AgentChat } from "./AgentChat";
import { FridayWorkspace, type FridayPanel } from "../components/FridayWorkspace";
import { AgentOSHeader, AgentOSSidebar } from "../components/AgentOSNavigation";
import { AgentOSCompanyScope } from "../components/AgentOSCompanyScope";
import { AgentOSCompanyUpdates } from "../components/AgentOSPortfolio";
import { administrationApi, registrationKey } from "../api/administration";
import { useAccountIdentity } from "../api/companies-query";

export function Friday() {
  const { selectedCompanyId, loading } = useCompany();
  const { setTheme } = useTheme();
  useEffect(() => { setTheme("light"); }, [setTheme]);
  return selectedCompanyId ? <FridayCompany key={selectedCompanyId} companyId={selectedCompanyId} />
    : <div className="agentos-page"><h1>{loading ? "Opening your workspace…" : "A place for your next idea."}</h1><p className="mt-4 text-muted-foreground">Create your first company to bring your team and work together.</p><Button asChild className="mt-6"><Link to="/onboarding">Create a company</Link></Button></div>;
}

function FridayCompany({ companyId }: { companyId: string }) {
  const { companies } = useCompany();
  const { userId } = useAccountIdentity();
  const registration = useQuery({ queryKey: registrationKey(userId), queryFn: administrationApi.registration, retry: false });
  const client = useQueryClient();
  const profile = useQuery({ queryKey: operatingProfileKey(companyId), queryFn: () => operatingProfileApi.get(companyId) });
  const agents = useQuery({ queryKey: queryKeys.agents.list(companyId), queryFn: () => agentsApi.list(companyId) });
  const models = useQuery({ queryKey: ["ai-connections", companyId], queryFn: () => aiConnectionsApi.list(companyId) });
  const [selectedAgent, setSelectedAgent] = useState("");
  const [settings, setSettings] = useState(false);
  const [transcript, setTranscript] = useState(false);
  const [typing, setTyping] = useState(false);
  const [offlineDraft, setOfflineDraft] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const view = readFridayNavigation(location.search);
  const panel = view.panel;
  const go = (next: FridayNavigation) => navigate({ pathname: "/friday", search: fridayNavigationSearch(next) });
  const chat = useAgentChatEnabled();
  const save = useMutation({
    mutationFn: () => operatingProfileApi.update(companyId, { fridayAgentId: selectedAgent || null, expectedRevision: profile.data!.revision }),
    onSuccess: next => { client.setQueryData(operatingProfileKey(companyId), next); setSettings(false); },
  });
  const enableChat = useMutation({ mutationFn: () => instanceSettingsApi.updateExperimental({ enableAgentChat: true }), onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.instance.experimentalSettings }) });
  const error = profile.error ?? agents.error ?? models.error ?? save.error ?? enableChat.error;
  const fridayId = profile.data?.fridayAgentId;
  const targetId = panel === "chat" && view.agentId ? view.agentId : view.speakerId ?? fridayId;
  const targetCompanyId = panel === "chat" ? view.companyId ?? companyId : view.speakerCompanyId ?? companyId;
  const targetRoster = useQuery({ queryKey: queryKeys.agents.list(targetCompanyId), queryFn: () => agentsApi.list(targetCompanyId), enabled: targetCompanyId !== companyId && companies.some(company => company.id === targetCompanyId) });
  const target = (targetCompanyId === companyId ? agents.data : targetRoster.data)?.find(agent => agent.id === targetId);
  const assistantName = target?.name ?? "Friday";
  const showView = (next: FridayNavigation) => go(fridayConversationView(next, targetId !== fridayId ? targetId ?? undefined : undefined, targetId !== fridayId ? targetCompanyId : undefined));
  const setPanel = (next: FridayPanel) => showView(next ? { ...view, panel: next === "portfolio" ? "companies" : next } : { panel: null });
  const openConversation = () => { setTranscript(true); setTyping(true); };
  const closeConversation = () => { setTranscript(false); setTyping(false); };
  const connected = !models.error && !!models.data?.connections.some(connection => connection.method === "subscription" && connection.status === "connected");
  const renderWorkspace = (data: AgentConversationFocusData) => <FridayWorkspace companyId={companyId} data={data} panel={panel} setPanel={setPanel} compact={transcript} connected={connected} view={view} navigate={showView} agents={agents.isSuccess ? agents.data : []} companies={companies} assistantName={assistantName} onConversation={openConversation} onType={openConversation} />;
  const targetCompany = companies.find(company => company.id === targetCompanyId);
  const canChat = !!targetCompany && !!targetId && chat.enabled && !profile.error && !!target;
  const fallback: AgentConversationFocusData = { issueId: null, reply: undefined, attachments: [], workProducts: [], runStatus: "idle", awaitingInput: false, unavailable: false, loading: profile.isPending, voiceDisabled: true, onTranscript: text => { setOfflineDraft(text); openConversation(); } };
  return <div className="agentos-app" data-home={!panel}>
    {companies.map(company => <AgentOSCompanyUpdates key={company.id} companyId={company.id} />)}
    <AgentOSHeader view={view} navigate={go} admin={registration.data?.isInstanceAdmin} onSettings={() => { setSelectedAgent(fridayId ?? ""); setSettings(value => !value); }} />
    {error && <p role="alert" className="agentos-service-notice text-destructive">{error.message}</p>}
    {settings && <section className="agentos-settings" aria-label="Workspace settings"><div className="flex items-center justify-between gap-3"><h2 className="font-medium">Friday & your workspace</h2><Button variant="ghost" size="icon-sm" aria-label="Close settings" onClick={() => setSettings(false)}><X /></Button></div>
      <p className="text-sm text-muted-foreground">Choose your coordinator and connect the subscription she uses.</p>
      <label className="block text-sm">Coordinator<select aria-label="Friday agent" className="mt-2 w-full rounded-lg border bg-background px-3 py-2" value={selectedAgent} onChange={event => setSelectedAgent(event.target.value)}><option value="">Choose an agent</option>{(agents.data ?? []).filter(agent => !["terminated", "pending_approval"].includes(agent.status)).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
      <div className="flex flex-wrap items-center gap-2"><Button disabled={save.isPending || !profile.data} onClick={() => save.mutate()}>Save coordinator</Button>{!chat.enabled && <Button variant="outline" disabled={enableChat.isPending} onClick={() => enableChat.mutate()}>Enable conversations</Button>}</div>
      <div className="flex flex-wrap gap-4 text-sm"><Link to="/apps/connect?source=openai">Connect Codex</Link><Link to="/apps/connect?source=anthropic">Connect Claude</Link><Link to="/teams-catalog?search=AgentOS">Add an operating team</Link><Link to="/operating-connections">Connections</Link><Link to="/applications">Applications</Link><Link to="/company/settings">Company settings</Link></div>
    </section>}
    {!profile.isPending && !canChat && !settings && <div className="agentos-service-notice"><span>{!fridayId ? "Choose a coordinator to start talking to Friday." : !chat.enabled ? "Enable conversations to talk to Friday." : "Friday’s conversation is connecting."}</span><button type="button" onClick={() => { setSelectedAgent(fridayId ?? ""); setSettings(true); }}>Open settings</button></div>}
    <div className="agentos-workspace-shell">{panel && <AgentOSSidebar companies={companies} view={view} navigate={go} />}
      <div className="agentos-main-canvas" data-conversation-open={transcript || typing}>
        {view.companyId && !companies.some(company => company.id === view.companyId) ? <div className="agentos-page" role="alert"><h1>Company unavailable</h1><p>This company is not in your accessible portfolio.</p><Button onClick={() => go({ panel: "companies" })}>Back to companies</Button></div>
          : canChat ? <AgentOSCompanyScope company={targetCompany!}><AgentChat key={targetId} agentRef={targetId} focusView={{ canvas: true, docked: !!panel, assistantName, showTranscript: transcript, composerCollapsed: !typing, onExpandComposer: openConversation, onCollapseComposer: closeConversation, onClose: closeConversation, render: renderWorkspace }} /></AgentOSCompanyScope>
            : <>{renderWorkspace(fallback)}{(typing || transcript) && <section className="agentos-conversation-panel" data-docked={!!panel} aria-label="Conversation with Friday"><header><h2>You & Friday</h2><Button variant="ghost" size="icon-sm" aria-label="Minimise conversation" onClick={closeConversation}><X /></Button></header><div className="space-y-4 p-5"><p className="text-sm text-muted-foreground">Your draft stays here while you connect a coordinator. It has not been sent.</p><textarea className="w-full rounded-xl border bg-background p-3" aria-label="Draft for Friday" value={offlineDraft} onChange={event => setOfflineDraft(event.target.value)} /><Button variant="outline" onClick={() => setSettings(true)}>Connect Friday</Button></div></section>}</>}
      </div>
    </div>
  </div>;
}
