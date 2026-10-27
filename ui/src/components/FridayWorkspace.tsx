import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bookmark } from "lucide-react";
import type { AgentConversationFocusData } from "@/lib/conversation-focus";
import { fridayCanvases, fridayCanvasKey, savedFridayCanvases, type FridayCanvas } from "@/lib/friday-canvas";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { AgentOSDelete } from "./AgentOSDelete";
import { Button } from "./ui/button";
import { FridayPresence } from "./FridayPresence";
import { AgentOSCompanies, AgentOSDecisionPeek, AgentOSPortfolioMap, AgentOSScopedRecords, AgentOSWorkforceTable } from "./AgentOSPortfolio";
import { AgentOSCompanyScope } from "./AgentOSCompanyScope";
import { projectsApi } from "@/api/projects";
import { agentsApi } from "@/api/agents";
import type { Agent, Company } from "@paperclipai/shared";
import type { FridayNavigation } from "../lib/friday-navigation";
import { parseFridayView } from "../lib/friday-navigation";
import { FridayWork } from "./FridayWork";
import { FridayTeam } from "./FridayTeam";
import { TaskAttachmentPanel } from "./task-side-panel/TaskAttachmentPanel";
import { Workforce } from "../pages/Workforce";

export type FridayPanel = FridayNavigation["panel"] | "portfolio";
export function FridayWorkspace({ companyId, data, panel, setPanel, compact, connected, view, navigate, agents = [], companies = [], onConversation, onType, assistantName = "Friday" }: {
  companyId: string; data: AgentConversationFocusData; panel: FridayPanel;
  setPanel: (panel: FridayPanel) => void; compact: boolean; connected: boolean;
  view?: FridayNavigation; navigate?: (view: FridayNavigation) => void; agents?: Agent[]; companies?: Company[]; onConversation?: () => void; onType?: () => void; assistantName?: string;
}) {
  const client = useQueryClient();
  const canvases = fridayCanvases(data.issueId, data.attachments, data.workProducts);
  const [selected, setSelected] = useState<string | null>(null);
  const [previewStopped, setPreviewStopped] = useState(false);
  const [askError, setAskError] = useState("");
  const [viewError, setViewError] = useState("");
  const asking = useRef(false);
  const nav: FridayNavigation = view ?? { panel: panel === "portfolio" ? "work" : panel };
  const go = navigate ?? ((next: FridayNavigation) => setPanel(next.panel));
  const ask = async (text: string) => {
    if (asking.current) return;
    asking.current = true; setAskError("");
    try { if (data.onVoiceMessage) await data.onVoiceMessage(text); else data.onTranscript(text); }
    catch (error) { data.onTranscript(text); setAskError(error instanceof Error ? error.message : "The message was preserved as a draft."); }
    finally { asking.current = false; }
  };
  const seen = useRef<Set<string> | null>(null);
  const arrivalKey = canvases.map(canvas => canvas.attachment.id).sort().join(",");
  useEffect(() => {
    if (data.loading || data.unavailable) return;
    const next = new Set(canvases.map(canvas => canvas.attachment.id));
    const arrival = seen.current && canvases.find(canvas => !seen.current!.has(canvas.attachment.id));
    seen.current = next;
    if (arrival) { setSelected(arrival.attachment.id); setPreviewStopped(false); setPanel("canvas"); }
  }, [arrivalKey, data.loading, data.unavailable]);
  const documents = useQuery({ queryKey: queryKeys.issues.documents(data.issueId ?? ""), queryFn: () => issuesApi.listDocuments(data.issueId!), enabled: !!data.issueId });
  const viewDocument = documents.data?.find(document => document.key === "friday-view");
  const requestedView = useQuery({ queryKey: ["friday-view", data.issueId, viewDocument?.latestRevisionId], queryFn: () => issuesApi.getDocument(data.issueId!, "friday-view"), enabled: !!data.issueId && !!viewDocument });
  const initialView = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!documents.isSuccess || data.loading || documents.error) return;
    if (initialView.current === undefined) { initialView.current = viewDocument?.latestRevisionId ?? null; return; }
    if (!requestedView.data || requestedView.error || requestedView.data.latestRevisionId === initialView.current) return;
    initialView.current = requestedView.data.latestRevisionId;
    const requested = parseFridayView(requestedView.data.body);
    setViewError(requested ? "" : "The requested view could not be displayed. Ask the agent to publish a supported view.");
    if (requested) { const { version: _, ...next } = requested; go(next); }
  }, [documents.isSuccess, documents.data, requestedView.data, requestedView.error, data.loading]);
  const saved = savedFridayCanvases(documents.isError ? [] : documents.data ?? [], canvases);
  const save = useMutation({
    mutationFn: (canvas: FridayCanvas) => issuesApi.upsertDocument(data.issueId!, fridayCanvasKey(canvas.attachment.id), {
      title: `Saved display: ${canvas.product.title}`.slice(0, 200), format: "markdown",
      body: JSON.stringify({ version: 1, attachmentId: canvas.attachment.id, workProductId: canvas.product.id }),
      baseRevisionId: null, changeSummary: "Save this display for Friday to reuse. The attachment remains the immutable source.",
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.issues.documents(data.issueId!) }),
    onError: () => { void client.invalidateQueries({ queryKey: queryKeys.issues.documents(data.issueId!) }); },
  });
  const chosen = canvases.find(canvas => canvas.attachment.id === selected);
  const selectCanvas = (canvas: FridayCanvas) => { setSelected(canvas.attachment.id); setPreviewStopped(false); setPanel("canvas"); };
  const scopeCompany = companies.find(company => company.id === nav.companyId);
  const scopeId = scopeCompany?.id ?? companyId;
  const scopeAgents = useQuery({ queryKey: queryKeys.agents.list(scopeId), queryFn: () => agentsApi.list(scopeId), enabled: scopeId !== companyId });
  const roster = scopeId === companyId ? agents : scopeAgents.isSuccess ? scopeAgents.data : [];
  const project = useQuery({ queryKey: queryKeys.projects.detail(nav.projectId ?? ""), queryFn: () => projectsApi.get(nav.projectId!), enabled: !!nav.projectId });
  const visibleCompanies = scopeCompany ? [scopeCompany] : companies;
  const scopedGo = (next: FridayNavigation) => go({ ...next, companyId: nav.companyId });
  const title = panel === "work" ? nav.mode === "graph" ? "Agent Map" : nav.mode === "kanban" ? "Kanban" : project.data?.name ?? scopeCompany?.name ?? "Work in motion"
    : panel === "attention" ? "Decisions" : panel === "team" || panel === "chat" ? "Workforce" : panel === "activity" ? "Audit trail" : panel === "routines" ? "Routines" : panel === "artifacts" ? "Artefacts" : panel === "workforce" ? "Workforce management" : panel === "library" ? "Saved displays" : chosen?.product.title ?? "Canvas";
  const scopeTabs = [
    ["Home", { panel: "work", mode: "combined" }], ["Kanban", { panel: "work", mode: "kanban" }], ["Agent Map", { panel: "work", mode: "graph" }],
    ["Decisions", { panel: "attention" }], ["Routines", { panel: "routines" }], ["Artefacts", { panel: "artifacts" }],
  ] as const;
  return <div className="agentos-canvas-stage" data-panel={!!panel}>
    {!panel && <div className="agentos-company-strip"><span className="agentos-eyebrow">Your portfolio</span>{companies.map(company => <button type="button" key={company.id} onClick={() => go({ panel: "work", companyId: company.id, mode: "combined" })}><span />{company.name}</button>)}</div>}
    <FridayPresence data={data} connected={connected} docked={!!panel} assistantName={assistantName} onConversation={onConversation} onType={onType} />
    {askError && <p role="alert" className="text-sm text-destructive">{askError}</p>}
    {(viewError || requestedView.error || scopeAgents.error || project.error) && <p role="alert" className="text-sm text-destructive">{viewError || requestedView.error?.message || scopeAgents.error?.message || project.error?.message}</p>}
    {!panel && <div className="agentos-home-content"><section className="agentos-home-intro"><h1>A little clarity. A lot in motion.</h1><p>Your companies, projects and people.<br />One conversation to move things forward.</p></section>
      <div className="agentos-prompt-chips"><button type="button" onClick={() => go({ panel: "attention" })}>What needs me?</button><button type="button" onClick={() => go({ panel: "companies" })}>Show my companies</button><button type="button" onClick={() => go({ panel: "work", mode: "combined" })}>See work in motion</button></div>
      <AgentOSDecisionPeek companies={companies} navigate={go} /><footer className="agentos-home-footer"><span>{companies.length} {companies.length === 1 ? "company" : "companies"} in your portfolio</span><button type="button" onClick={() => { data.onTranscript("I want to create a new project: "); onType?.(); }}>Start something new <ArrowRight /></button></footer>
    </div>}
    {panel && <section className="agentos-page" aria-label="Friday workspace">
      {panel !== "companies" && <><div className="agentos-breadcrumbs"><button type="button" onClick={() => go({ panel: "companies" })}>Portfolio</button>{scopeCompany && <><span>/</span><button type="button" onClick={() => go({ panel: "work", companyId: scopeCompany.id, mode: "combined" })}>{scopeCompany.name}</button></>}{nav.projectId && <><span>/</span><button type="button" onClick={() => scopedGo({ panel: "work", projectId: nav.projectId, mode: "combined" })}>{project.data?.name ?? "Project"}</button></>}</div>
        <div className="agentos-page-heading"><div><p className="agentos-eyebrow">{nav.projectId ? "Project workspace" : scopeCompany ? "Company workspace" : "Across your portfolio"}</p><h1>{title}</h1><p>{panel === "work" && nav.mode === "graph" ? "Every point is a record. Follow the people, handoffs and work behind it." : panel === "team" ? "Your digital employees. Skills, assignments and execution profiles, together." : panel === "attention" ? "The decisions and blockers that need you, with their context intact." : scopeCompany?.description ?? "A clear view of the work and the people moving it forward."}</p></div>
          {scopeCompany && !nav.projectId && <AgentOSDelete kind="company" id={scopeCompany.id} companyId={scopeCompany.id} name={scopeCompany.name} onRemoved={() => go({ panel: "companies" })} />}
          {scopeCompany && nav.projectId && project.data?.companyId === scopeCompany.id && <AgentOSDelete kind="project" id={project.data.id} companyId={scopeCompany.id} name={project.data.name} onRemoved={() => go({ panel: "work", companyId: scopeCompany.id, mode: "combined" })} />}
          {panel === "team" && <Button variant="outline" onClick={() => go({ panel: "workforce" })}>Manage shared workforce</Button>}
        </div>
        {scopeCompany && !["team", "chat", "workforce", "activity"].includes(panel) && <nav className="agentos-workspace-tabs" aria-label="Workspace views">{scopeTabs.map(([label, next]) => <button key={label} type="button" aria-current={panel === next.panel && (next.panel !== "work" || (nav.mode ?? "combined") === next.mode) ? "page" : undefined} onClick={() => go({ ...next, companyId: nav.companyId, projectId: nav.projectId })}>{label}</button>)}</nav>}
      </>}
      {panel === "companies" ? <AgentOSCompanies companies={companies} navigate={go} onCreate={() => { data.onTranscript("I want to create a new company: "); onType?.(); }} />
        : panel === "workforce" ? <Workforce embedded />
        : panel === "work" ? !scopeCompany && nav.mode === "graph" ? <AgentOSPortfolioMap companies={companies} navigate={go} />
          : visibleCompanies.map(company => <AgentOSCompanyScope key={company.id} company={company}><div className="agentos-company-work">{!scopeCompany && <div className="agentos-section-heading"><h2>{company.name}</h2><button type="button" onClick={() => go({ panel: "work", companyId: company.id, mode: "combined" })}>Open company <ArrowRight /></button></div>}<FridayWork key={[company.id, nav.projectId, nav.applicationId, nav.agentId].join(":")} companyId={company.id} agents={roster} view={{ ...nav, companyId: company.id }} navigate={next => go({ ...next, companyId: company.id })} onAsk={text => void ask(text)} assistantName={assistantName} /></div></AgentOSCompanyScope>)
        : panel === "team" || panel === "chat" ? nav.agentId ? scopeCompany ? <AgentOSCompanyScope company={scopeCompany}><FridayTeam companyId={scopeId} agents={roster} agentId={nav.agentId} navigate={scopedGo} /></AgentOSCompanyScope> : <FridayTeam companyId={scopeId} agents={roster} agentId={nav.agentId} navigate={scopedGo} /> : <AgentOSWorkforceTable companies={visibleCompanies} navigate={go} />
        : ["attention", "activity", "routines", "artifacts"].includes(panel) ? visibleCompanies.map(company => <AgentOSScopedRecords key={`${company.id}:${panel}:${nav.projectId ?? ""}`} company={company} view={nav} navigate={go} onAsk={text => void ask(text)} />)
        : panel === "canvas" && chosen && data.issueId ? <><div className="flex flex-wrap items-center gap-2 pb-4"><Button size="sm" variant="outline" disabled={saved.has(chosen.attachment.id) || save.isPending || documents.isPending || documents.isError} onClick={() => save.mutate(chosen)}><Bookmark />{saved.has(chosen.attachment.id) ? "Saved for reuse" : "Save for reuse"}</Button><Button size="sm" variant="ghost" onClick={() => setPreviewStopped(value => !value)}>{previewStopped ? "Resume preview" : "Stop preview"}</Button><Button size="sm" variant="ghost" onClick={() => setPanel("library")}>All displays</Button></div>{previewStopped || data.unavailable ? <p className="text-sm">Preview stopped. Refresh the conversation to continue.</p> : <TaskAttachmentPanel key={chosen.attachment.id} issueId={data.issueId} attachmentId={chosen.attachment.id} />}</>
        : <div className="space-y-4"><p className="text-sm text-muted-foreground">Ask Friday for a chart, report, calculator or interactive view. Saved displays remain available in this conversation.</p>{!canvases.length && <p className="agentos-empty">No displays published yet.</p>}{canvases.map(canvas => <button type="button" key={canvas.product.id} onClick={() => selectCanvas(canvas)} className="friday-work-task"><span>{canvas.product.title}</span><span className="text-xs text-muted-foreground">{saved.has(canvas.attachment.id) ? "Saved" : "Open"}</span></button>)}</div>}
      {(save.error || documents.error) && <p role="alert" className="text-sm text-destructive">{save.error?.message ?? documents.error?.message}</p>}
    </section>}
  </div>;
}
