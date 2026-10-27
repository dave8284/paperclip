import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import { useAccountIdentity } from "@/api/companies-query";
import { workforceApi, workforceKeys } from "@/api/workforce";
import { operatingProfileApi, operatingProfileKey } from "@/api/operating-profile";
import { aiConnectionsApi } from "@/api/ai-connections";
import { useAgentChatEnabled } from "@/hooks/useAgentChatEnabled";
import { useLocation, useNavigate } from "@/lib/router";
import { fridayNavigationSearch, parseFridayView } from "@/lib/friday-navigation";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { AgentOSCompanyScope } from "./AgentOSCompanyScope";
import { syncFridayDisplayContext } from "@/lib/friday-display-context";
import { FridayPresence } from "./FridayPresence";
import { FridayOrb } from "./FridayOrb";
import type { AgentConversationFocusData } from "@/lib/conversation-focus";

const AgentChat = lazy(() => import("@/pages/AgentChat").then(module => ({ default: module.AgentChat })));

/** The same durable Friday conversation remains reachable on native record and
 * settings pages; opening the dock never starts a run. */
export function FridayDock() {
  const { companies, selectedCompanyId } = useCompany();
  const { userId } = useAccountIdentity();
  const portfolios = useQuery({ queryKey: workforceKeys.list(userId), queryFn: ({ signal }) => workforceApi.list(signal), retry: false });
  const company = companies.find(item => item.id === portfolios.data?.[0]?.homeCompanyId) ?? companies.find(item => item.id === selectedCompanyId);
  const profile = useQuery({ queryKey: operatingProfileKey(company?.id ?? null), queryFn: () => operatingProfileApi.get(company!.id), enabled: !!company });
  const models = useQuery({ queryKey: ["ai-connections", company?.id], queryFn: () => aiConnectionsApi.list(company!.id), enabled: !!company });
  const chat = useAgentChatEnabled();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname, location.search]);
  const navigate = useNavigate();
  if (!company || location.pathname.includes("/chats/")) return null;
  const fridayPath = `/${company.issuePrefix}/friday`;
  const ready = !!profile.data?.fridayAgentId && chat.enabled;
  if (!ready) return <div className="agentos-friday-presence" data-docked="true"><div className="agentos-presence-controls"><FridayOrb compact state="idle" label="Open Friday" onActivate={() => navigate(fridayPath)} /><div className="agentos-presence-status"><strong>Friday</strong><span>Open your coordinator</span></div></div></div>;
  return <div className="agentos-native-friday"><Suspense fallback={<p role="status">Connecting to Friday…</p>}><AgentOSCompanyScope company={company}><AgentChat agentRef={profile.data!.fridayAgentId!} focusView={{ beforeSend: issueId => syncFridayDisplayContext(issueId, { panel: null, companyId: selectedCompanyId ?? company.id }, location.pathname + location.search), canvas: true, docked: true, showTranscript: open, composerCollapsed: !open, onExpandComposer: () => setOpen(true), onCollapseComposer: () => setOpen(false), onClose: () => setOpen(false), render: data => <DockContent data={data} connected={!!models.data?.connections.some(connection => connection.method === "subscription" && connection.status === "connected")} onOpen={() => setOpen(value => !value)} fridayPath={fridayPath} /> }} /></AgentOSCompanyScope></Suspense></div>;
}

function DockContent({ data, connected, onOpen, fridayPath }: { data: AgentConversationFocusData; connected: boolean; onOpen: () => void; fridayPath: string }) {
  const navigate = useNavigate();
  const documents = useQuery({ queryKey: queryKeys.issues.documents(data.issueId ?? ""), queryFn: () => issuesApi.listDocuments(data.issueId!), enabled: !!data.issueId });
  const request = documents.data?.find(document => document.key === "friday-view");
  const view = useQuery({ queryKey: ["friday-view", data.issueId, request?.latestRevisionId], queryFn: () => issuesApi.getDocument(data.issueId!, "friday-view"), enabled: !!data.issueId && !!request });
  const initial = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!documents.isSuccess || data.loading) return;
    if (initial.current === undefined) { initial.current = request?.latestRevisionId ?? null; return; }
    if (!view.data || view.error || view.data.latestRevisionId === initial.current) return;
    initial.current = view.data.latestRevisionId;
    const next = parseFridayView(view.data.body);
    if (next) { const { version: _, ...destination } = next; navigate(`${fridayPath}?${fridayNavigationSearch(destination)}`); }
  }, [documents.isSuccess, request?.latestRevisionId, view.data, view.error, data.loading, navigate, fridayPath]);
  return <FridayPresence data={data} connected={connected} docked onConversation={onOpen} onType={onOpen} />;
}
