import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bookmark, Settings2 } from "lucide-react";
import type { AgentConversationFocusData } from "@/lib/conversation-focus";
import { fridayCanvases, fridayCanvasKey, savedFridayCanvases, type FridayCanvas } from "@/lib/friday-canvas";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { AgentOSDelete } from "./AgentOSDelete";
import { Button } from "./ui/button";
import { FridaySuggestions } from "./FridaySuggestions";
import { FridayPresence } from "./FridayPresence";
import { AgentOSCompanies, AgentOSDecisionPeek, AgentOSPortfolioMap, AgentOSScopedRecords, AgentOSWorkforceTable } from "./AgentOSPortfolio";
import { AgentOSCompanyScope } from "./AgentOSCompanyScope";
import { projectsApi } from "@/api/projects";
import { agentsApi } from "@/api/agents";
import type { Agent, Company } from "@paperclipai/shared";
import type { FridayNavigation } from "../lib/friday-navigation";
import { parseFridayView } from "../lib/friday-navigation";
import { AgentOSPerformance } from "./AgentOSPerformance";
import { AgentOSSettings } from "./AgentOSSettings";
import { AgentOSProjects } from "./AgentOSProjects";
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
  const introKey = `agentos:introduced:${data.voiceSessionKey ?? companyId}`;
  const [introduced, setIntroduced] = useState(false);
  useEffect(() => { try { setIntroduced(localStorage.getItem(introKey) === "true"); } catch { /* Optional preference. */ } }, [introKey]);
  useEffect(() => { if (!compact && !data.reply) return; setIntroduced(true); try { localStorage.setItem(introKey, "true"); } catch { /* Optional preference. */ } }, [compact, data.reply, introKey]);
  const allCanvases = fridayCanvases(data.issueId, data.attachments, data.workProducts);
  const [selected, setSelected] = useState<string | null>(null);
  const [previewStopped, setPreviewStopped] = useState(false);
  const [askError, setAskError] = useState("");
  const [viewError, setViewError] = useState("");
  const asking = useRef(false);
  const nav: FridayNavigation = view ?? { panel: panel === "portfolio" ? "work" : panel };
  const displayCompanyId = nav.scope === "portfolio" ? undefined : nav.companyId ?? companyId;
  const canvases = allCanvases.filter(canvas => {
    const metadata = canvas.product.metadata;
    const targetCompany = typeof metadata?.displayCompanyId === "string" ? metadata.displayCompanyId : canvas.product.companyId;
    const targetProject = typeof metadata?.displayProjectId === "string" ? metadata.displayProjectId : canvas.product.projectId;
    return (!displayCompanyId || targetCompany === displayCompanyId) && (!nav.projectId || targetProject === nav.projectId);
  });
  const go = navigate ?? ((next: FridayNavigation) => setPanel(next.panel));
  const ask = async (text: string) => {
    if (asking.current) return;
    asking.current = true; setAskError(""); onConversation?.();
    try { if (data.onVoiceMessage) await data.onVoiceMessage(text); else data.onTranscript(text); }
    catch (error) { data.onTranscript(text); setAskError(error instanceof Error ? error.message : "The message was preserved as a draft."); }
    finally { asking.current = false; }
  };
  const seen = useRef<Set<string> | null>(null);
  const seenScope = useRef("");
  const canvasScope = `${displayCompanyId ?? "portfolio"}:${nav.projectId ?? ""}`;
  const arrivalKey = canvases.map(canvas => canvas.attachment.id).sort().join(",");
  useEffect(() => {
    if (data.loading || data.unavailable) return;
    const next = new Set(canvases.map(canvas => canvas.attachment.id));
    if (seenScope.current !== canvasScope) { seenScope.current = canvasScope; seen.current = next; return; }
    const arrival = seen.current && canvases.find(canvas => !seen.current!.has(canvas.attachment.id));
    seen.current = next;
    if (arrival) { setSelected(arrival.attachment.id); setPreviewStopped(false); setPanel("canvas"); }
  }, [arrivalKey, data.loading, data.unavailable, canvasScope]);
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
  const scopeCompany = nav.scope === "portfolio" ? undefined : companies.find(company => company.id === (nav.companyId ?? companyId));
  const scopeId = scopeCompany?.id ?? companyId;
  const scopeAgents = useQuery({ queryKey: queryKeys.agents.list(scopeId), queryFn: () => agentsApi.list(scopeId), enabled: scopeId !== companyId });
  const roster = scopeId === companyId ? agents : scopeAgents.isSuccess ? scopeAgents.data : [];
  const project = useQuery({ queryKey: queryKeys.projects.detail(nav.projectId ?? ""), queryFn: () => projectsApi.get(nav.projectId!), enabled: !!nav.projectId });
  const visibleCompanies = scopeCompany ? [scopeCompany] : companies;
  const scopedGo = (next: FridayNavigation) => go({ ...next, companyId: scopeCompany?.id, scope: nav.scope });
  const title = panel === "work" ? nav.mode === "graph" ? "Agent Map" : nav.mode === "kanban" ? "Kanban" : project.data?.name ?? scopeCompany?.name ?? "Work in motion"
    : panel === "projects" ? "Projects" : panel === "departments" ? "Departments" : panel === "settings" ? "Settings" : panel === "performance" ? "Performance" : panel === "attention" ? "Decisions" : panel === "team" || panel === "chat" ? "Workforce" : panel === "activity" ? "Audit trail" : panel === "routines" ? "Routines" : panel === "artifacts" ? "Artefacts" : panel === "workforce" ? "Workforce management" : panel === "library" ? "Saved displays" : chosen?.product.title ?? "Canvas";
  const scopeTabs = [
    ["Home", { panel: "work", mode: "combined" }], ["Kanban", { panel: "work", mode: "kanban" }], ["Agent Map", { panel: "work", mode: "graph" }],
    ["Decisions", { panel: "attention" }], ["Routines", { panel: "routines" }], ["Artefacts", { panel: "artifacts" }], ["Performance", { panel: "performance" }],
  ] as const;
  return <div className="agentos-canvas-stage" data-panel={!!panel}>
    {!panel && <nav className="agentos-home-utilities" aria-label="Workspace settings"><button type="button" onClick={() => go({ panel: "settings", companyId: nav.companyId ?? companyId })}><Settings2 aria-hidden="true" /><span>Settings</span></button></nav>}
    {!panel && !introduced && !compact && <div className="agentos-company-strip"><span className="agentos-eyebrow">Your portfolio</span>{companies.map(company => <button type="button" key={company.id} onClick={() => go({ panel: "work", companyId: company.id, mode: "combined" })}><span />{company.name}</button>)}</div>}
    <FridayPresence data={data} connected={connected} docked={!!panel} assistantName={assistantName} onConversation={onConversation} onType={onType} />
    {askError && <p role="alert" className="text-sm text-destructive">{askError}</p>}
    {(viewError || requestedView.error || scopeAgents.error || project.error) && <p role="alert" className="text-sm text-destructive">{viewError || requestedView.error?.message || scopeAgents.error?.message || project.error?.message}</p>}
    {!panel && <div className="agentos-home-content">{!introduced && !compact && <section className="agentos-home-intro"><h1>A little clarity. A lot in motion.</h1><p>Your companies, projects and people.<br />One conversation to move things forward.</p></section>}
      <FridaySuggestions companies={visibleCompanies} navigate={go} onNew={() => { data.onTranscript("I want to create a new project: "); onType?.(); }} />
      <AgentOSDecisionPeek companies={visibleCompanies} navigate={go} /><footer className="agentos-home-footer"><span>{companies.length} {companies.length === 1 ? "company" : "companies"} in your portfolio</span><button type="button" onClick={() => { data.onTranscript("I want to create a new project: "); onType?.(); }}>Start something new <ArrowRight /></button></footer>
    </div>}
    {panel && <section className="agentos-page" aria-label="Friday workspace">
      {panel !== "companies" && <><div className="agentos-breadcrumbs"><button type="button" onClick={() => go({ panel: "companies" })}>Portfolio</button>{scopeCompany && <><span>/</span><button type="button" onClick={() => go({ panel: "work", companyId: scopeCompany.id, mode: "combined" })}>{scopeCompany.name}</button></>}{nav.projectId && <><span>/</span><button type="button" onClick={() => scopedGo({ panel: "work", projectId: nav.projectId, mode: "combined" })}>{project.data?.name ?? "Project"}</button></>}</div>
        <div className="agentos-page-heading"><div><p className="agentos-eyebrow">{nav.projectId ? "Project workspace" : scopeCompany ? "Company workspace" : "Across your portfolio"}</p><h1>{title}</h1><p>{panel === "work" && nav.mode === "graph" ? "Dotted spheres are employees. Solid points are work and evidence; follow their recorded connections." : panel === "team" ? "Your digital employees. Skills, assignments and execution profiles, together." : panel === "attention" ? "The decisions and blockers that need you, with their context intact." : scopeCompany?.description ?? "A clear view of the work and the people moving it forward."}</p></div>
          {scopeCompany && nav.projectId && project.data?.companyId === scopeCompany.id && <AgentOSDelete kind="project" id={project.data.id} companyId={scopeCompany.id} name={project.data.name} onRemoved={() => go({ panel: "work", companyId: scopeCompany.id, mode: "combined" })} />}
          {panel === "team" && <Button variant="outline" onClick={() => go({ panel: "workforce" })}>Manage shared workforce</Button>}
        </div>
        {scopeCompany && !["team", "chat", "workforce", "activity", "settings"].includes(panel) && <nav className="agentos-workspace-tabs" aria-label="Workspace views">{scopeTabs.map(([label, next]) => <button key={label} type="button" aria-current={panel === next.panel && (next.panel !== "work" || (nav.mode ?? "combined") === next.mode) ? "page" : undefined} onClick={() => go({ ...next, companyId: scopeCompany?.id, scope: nav.scope, projectId: nav.projectId })}>{label}</button>)}</nav>}
      </>}
      {panel === "companies" ? <AgentOSCompanies companies={companies} navigate={go} onCreate={() => { data.onTranscript("I want to create a new company: "); onType?.(); }} />
        : panel === "performance" ? visibleCompanies.map(company => <AgentOSCompanyScope key={company.id} company={company}><section className="mb-8">{!scopeCompany && <h2 className="mb-4 text-lg font-semibold">{company.name}</h2>}<AgentOSPerformance key={[company.id, nav.projectId, nav.departmentId].join(":")} companyId={company.id} projectId={nav.projectId} departmentId={nav.departmentId} onAsk={text => void ask(text)} /></section></AgentOSCompanyScope>)
        : panel === "settings" ? <AgentOSCompanyScope company={scopeCompany ?? companies.find(company => company.id === companyId)!}><AgentOSSettings key={scopeId} companyId={scopeId} onCompanyRemoved={() => go({ panel: "companies" })} /></AgentOSCompanyScope>
        : panel === "projects" || panel === "departments" ? visibleCompanies.map(company => <AgentOSCompanyScope key={company.id} company={company}><section className="mb-8">{!scopeCompany && <h2 className="mb-4 text-lg font-semibold">{company.name}</h2>}<AgentOSProjects companyId={company.id} view={nav} navigate={go} onCreate={text => { data.onTranscript(text); onType?.(); }} /></section></AgentOSCompanyScope>)
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
