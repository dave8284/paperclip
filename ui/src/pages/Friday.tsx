import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { syncFridayDisplayContext, clearFridayDisplaySelection } from "../lib/friday-display-context";
import { X } from "lucide-react";
import { operatingProfileApi, operatingProfileKey } from "../api/operating-profile";
import { agentsApi } from "../api/agents";
import { aiConnectionsApi } from "../api/ai-connections";
import { useTheme } from "../context/ThemeContext";
import { useCompany } from "../context/CompanyContext";
import { useAgentChatEnabled } from "../hooks/useAgentChatEnabled";
import { queryKeys } from "../lib/queryKeys";
import { Link, useLocation, useNavigate } from "../lib/router";
import { fridayConversationView, fridayNavigationSearch, readFridayNavigation, scopeFridayNavigation, type FridayNavigation } from "../lib/friday-navigation";
import type { AgentConversationFocusData } from "../lib/conversation-focus";
import { Button } from "../components/ui/button";
import { AgentChat } from "./AgentChat";
import { FridayWorkspace, type FridayPanel } from "../components/FridayWorkspace";
import { AgentOSHeader, AgentOSSidebar } from "../components/AgentOSNavigation";
import { AgentOSCompanyScope } from "../components/AgentOSCompanyScope";
import { AgentOSCompanyUpdates } from "../components/AgentOSPortfolio";
import { administrationApi, registrationKey } from "../api/administration";
import { workforceApi, workforceKeys } from "../api/workforce";
import { useAccountIdentity } from "../api/companies-query";

export function Friday() {
  const { selectedCompanyId, companies, loading } = useCompany();
  const { userId } = useAccountIdentity();
  const portfolios = useQuery({ queryKey: workforceKeys.list(userId), queryFn: ({ signal }) => workforceApi.list(signal), enabled: !!selectedCompanyId, retry: false });
  const homeCompanyId = portfolios.data?.[0]?.homeCompanyId ?? selectedCompanyId;
  const { setTheme } = useTheme();
  useEffect(() => { setTheme("light"); }, [setTheme]);
  if (selectedCompanyId && portfolios.isPending) return <p className="agentos-page" role="status">Opening Friday…</p>;
  if (portfolios.error) return <p className="agentos-page text-destructive" role="alert">{portfolios.error.message}</p>;
  if (homeCompanyId && !companies.some(company => company.id === homeCompanyId)) return <p className="agentos-page" role="alert">Friday’s home company is not available to this account.</p>;
  return homeCompanyId ? <FridayCompany key={homeCompanyId} companyId={homeCompanyId} initialDisplayCompanyId={selectedCompanyId ?? homeCompanyId} />
    : <div className="agentos-page"><h1>{loading ? "Opening your workspace…" : "A place for your next idea."}</h1><p className="mt-4 text-muted-foreground">Create your first company to bring your team and work together.</p><Button asChild className="mt-6"><Link to="/onboarding">Create a company</Link></Button></div>;
}

function FridayCompany({ companyId, initialDisplayCompanyId }: { companyId: string; initialDisplayCompanyId: string }) {
  const { companies } = useCompany();
  const { userId } = useAccountIdentity();
  const registration = useQuery({ queryKey: registrationKey(userId), queryFn: administrationApi.registration, retry: false });
  const profile = useQuery({ queryKey: operatingProfileKey(companyId), queryFn: () => operatingProfileApi.get(companyId) });
  const agents = useQuery({ queryKey: queryKeys.agents.list(companyId), queryFn: () => agentsApi.list(companyId) });
  const models = useQuery({ queryKey: ["ai-connections", companyId], queryFn: () => aiConnectionsApi.list(companyId) });
  const [transcript, setTranscript] = useState(false);
  const [typing, setTyping] = useState(false);
  const [offlineDraft, setOfflineDraft] = useState("");
  const [contextError, setContextError] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const selectionKey = `agentos:selected-company:${userId ?? "local"}:${companyId}`;
  const [rememberedCompany, setRememberedCompany] = useState(() => { try { return initialDisplayCompanyId !== companyId ? initialDisplayCompanyId : sessionStorage.getItem(selectionKey) ?? companyId; } catch { return companyId; } });
  const selectedId = companies.some(company => company.id === rememberedCompany) ? rememberedCompany : companyId;
  const view = scopeFridayNavigation(readFridayNavigation(location.search), selectedId);
  useEffect(() => {
    if (!view.companyId || !companies.some(company => company.id === view.companyId)) return;
    setRememberedCompany(view.companyId);
    try { sessionStorage.setItem(selectionKey, view.companyId); } catch { /* Optional preference. */ }
  }, [view.companyId, selectionKey, companies]);
  const panel = view.panel;
  // The conversation stays alive; a destination never opens its transcript.
  useEffect(() => { setTranscript(false); setTyping(false); clearFridayDisplaySelection(); }, [location.pathname, location.search]);
  const go = (next: FridayNavigation) => navigate({ pathname: "/friday", search: fridayNavigationSearch(next) });
  const chat = useAgentChatEnabled();
  const error = profile.error ?? agents.error ?? models.error;
  const fridayId = profile.data?.fridayAgentId;
  const targetId = panel === "chat" && view.agentId ? view.agentId : view.speakerId ?? fridayId;
  const targetCompanyId = panel === "chat" ? view.companyId ?? companyId : view.speakerCompanyId ?? companyId;
  const targetRoster = useQuery({ queryKey: queryKeys.agents.list(targetCompanyId), queryFn: () => agentsApi.list(targetCompanyId), enabled: targetCompanyId !== companyId && companies.some(company => company.id === targetCompanyId) });
  const target = (targetCompanyId === companyId ? agents.data : targetRoster.data)?.find(agent => agent.id === targetId);
  const assistantName = target?.name ?? "Friday";
  const showView = (next: FridayNavigation) => go(fridayConversationView(next, targetId !== fridayId ? targetId ?? undefined : undefined, targetId !== fridayId ? targetCompanyId : undefined));
  const setPanel = (next: FridayPanel) => showView(next ? { ...view, panel: next === "portfolio" ? "companies" : next } : { panel: null });
  const openConversation = () => { setTranscript(true); setTyping(true); };
  const toggleConversation = () => { setTranscript(!transcript); setTyping(!transcript); };
  const closeConversation = () => { setTranscript(false); setTyping(false); };
  const connected = !models.error && !!models.data?.connections.some(connection => connection.method === "subscription" && connection.status === "connected");
  const renderWorkspace = (data: AgentConversationFocusData) => <FridayWorkspace companyId={companyId} data={data} panel={panel} setPanel={setPanel} compact={transcript} connected={connected} view={view} navigate={showView} agents={agents.isSuccess ? agents.data : []} companies={companies} assistantName={assistantName} onConversation={toggleConversation} onType={openConversation} />;
  const targetCompany = companies.find(company => company.id === targetCompanyId);
  const canChat = !!targetCompany && !!targetId && chat.enabled && !profile.error && !!target;
  const fallback: AgentConversationFocusData = { issueId: null, reply: undefined, attachments: [], workProducts: [], runStatus: "idle", awaitingInput: false, unavailable: false, loading: profile.isPending, voiceDisabled: true, onTranscript: text => { setOfflineDraft(text); openConversation(); } };
  return <div className="agentos-app" data-home={!panel}>
    {companies.map(company => <AgentOSCompanyUpdates key={company.id} companyId={company.id} />)}
    <AgentOSHeader view={view} navigate={go} admin={registration.data?.isInstanceAdmin} companies={companies} />
    {contextError && <p role="alert" className="agentos-service-notice text-destructive">{contextError}</p>}
    {error && <p role="alert" className="agentos-service-notice text-destructive">{error.message}</p>}
    {!profile.isPending && !canChat && panel !== "settings" && <div className="agentos-service-notice"><span>{!fridayId ? "Friday’s coordinator profile is not configured yet." : !chat.enabled ? "Enable conversations to talk to Friday." : "Friday’s conversation is connecting."}</span><button type="button" onClick={() => go({ panel: "settings", companyId })}>Open settings</button></div>}
    <div className="agentos-workspace-shell">{panel && <AgentOSSidebar companies={companies} view={view} navigate={go} />}
      <div className="agentos-main-canvas" data-conversation-open={transcript || typing}>
        {view.companyId && !companies.some(company => company.id === view.companyId) ? <div className="agentos-page" role="alert"><h1>Company unavailable</h1><p>This company is not in your accessible portfolio.</p><Button onClick={() => go({ panel: "companies" })}>Back to companies</Button></div>
          : canChat ? <AgentOSCompanyScope company={targetCompany!}><AgentChat key={targetId} agentRef={targetId} focusView={{ beforeSend: async issueId => { setContextError(""); try { await syncFridayDisplayContext(issueId, view); } catch (error) { setContextError("Friday could not read the current display. Your message is still a draft. Please try again."); throw error; } }, canvas: true, docked: !!panel, assistantName, showTranscript: transcript, composerCollapsed: !typing, onExpandComposer: openConversation, onCollapseComposer: closeConversation, onClose: closeConversation, render: renderWorkspace }} /></AgentOSCompanyScope>
            : <div className="agentos-friday-thread" data-friday-docked={!!panel}><div className="agentos-focus-content">{renderWorkspace(fallback)}</div>{(typing || transcript) && <section className="agentos-conversation-panel" data-docked={!!panel} aria-label="Conversation with Friday"><header><h2>You & Friday</h2><Button variant="ghost" size="icon-sm" aria-label="Minimise conversation" onClick={closeConversation}><X /></Button></header><div className="space-y-4 p-5"><p className="text-sm text-muted-foreground">Your draft stays here while you connect Friday. It has not been sent.</p><textarea className="w-full rounded-xl border bg-background p-3" aria-label="Draft for Friday" value={offlineDraft} onChange={event => setOfflineDraft(event.target.value)} /><Button variant="outline" onClick={() => go({ panel: "settings", companyId })}>Connect Friday</Button></div></section>}</div>}
      </div>
    </div>
  </div>;
}
