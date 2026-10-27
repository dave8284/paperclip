import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowLeft, Boxes, ChartNoAxesCombined, CheckCheck, ChevronRight, CircleHelp, FileText, FolderKanban, Home, Menu, Network, Repeat2, Settings2, Users, X } from "lucide-react";
import type { Company } from "@paperclipai/shared";
import { departmentsApi, departmentKey } from "@/api/departments";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/lib/queryKeys";
import type { FridayNavigation } from "@/lib/friday-navigation";
import { Link } from "@/lib/router";
import { AgentOSBrand } from "./AgentOSBrand";
import { AgentOSAccountMenu } from "./AgentOSAccountMenu";
import { Button } from "./ui/button";

type Navigation = (view: FridayNavigation) => void;
export function AgentOSHeader({ view, navigate, admin, companies = [], homePath = "/friday" }: {
  view: FridayNavigation; navigate: Navigation; admin?: boolean; companies?: Company[]; homePath?: string;
}) {
  const scope = { companyId: view.companyId, scope: view.scope, projectId: view.projectId };
  const links: Array<{ label: string; next: FridayNavigation; active: boolean }> = [
    { label: "Companies", next: { panel: "companies", companyId: view.companyId }, active: view.panel === "companies" },
    { label: "Work", next: { panel: "work", ...scope, mode: "combined" }, active: view.panel === "work" && view.mode !== "graph" },
    { label: "Decisions", next: { panel: "attention", ...scope }, active: view.panel === "attention" },
    { label: "Workforce", next: { panel: "team", companyId: view.companyId, scope: view.scope }, active: ["team", "workforce", "chat"].includes(view.panel ?? "") },
    { label: "Agent Map", next: { panel: "work", ...scope, mode: "graph" }, active: view.panel === "work" && view.mode === "graph" },
  ];
  return <header className="agentos-header"><AgentOSBrand to={homePath} />
    <select className="agentos-company-picker" aria-label="Selected company" value={view.scope === "portfolio" ? "portfolio" : view.companyId ?? ""} onChange={event => navigate(event.target.value === "portfolio" ? { panel: "work", scope: "portfolio", mode: "combined" } : { panel: "work", scope: "company", companyId: event.target.value, mode: "combined" })}><option value="portfolio">All companies</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select>
    <nav aria-label="Main navigation">{links.map(link => <button type="button" key={link.label} aria-current={link.active ? "page" : undefined} onClick={() => navigate(link.next)}>{link.label}</button>)}</nav>
    <div className="agentos-header-tools">{admin && <Button asChild variant="ghost" size="sm"><Link to="/admin">Admin</Link></Button>}<AgentOSAccountMenu /></div>
  </header>;
}

function CompanyTree({ companyId, view, navigate }: { companyId: string; view: FridayNavigation; navigate: Navigation }) {
  const departments = useQuery({ queryKey: departmentKey(companyId), queryFn: () => departmentsApi.list(companyId) });
  const projects = useQuery({ queryKey: queryKeys.projects.list(companyId), queryFn: () => projectsApi.list(companyId) });
  const rows = departments.data ?? [];
  const groups = [...rows.map(row => ({ id: row.id, name: row.name, projects: projects.data?.filter(project => row.projectIds.includes(project.id)) ?? [] })), { id: "", name: "Ungrouped projects", projects: projects.data?.filter(project => !rows.some(row => row.projectIds.includes(project.id))) ?? [] }];
  return <div className="agentos-company-tree" role="group" aria-label="Company structure">
    {groups.filter(group => group.id || group.projects.length).map(group => <details key={group.id} open={group.projects.some(project => project.id === view.projectId) || group.id === view.departmentId || undefined}>
      <summary><ChevronRight /><span>{group.name}</span><small>{group.projects.length}</small></summary>
      <button type="button" onClick={() => navigate({ panel: "projects", companyId, departmentId: group.id || undefined })}>View projects</button>
      {group.projects.map(project => <button type="button" key={project.id} aria-current={view.projectId === project.id ? "page" : undefined} onClick={() => navigate({ panel: "work", companyId, departmentId: group.id || undefined, projectId: project.id, mode: "combined" })}><FolderKanban /><span>{project.name}</span></button>)}
      {!group.projects.length && <p className="p-3 text-xs text-muted-foreground">No projects yet</p>}
    </details>)}
    {departments.isPending || projects.isPending ? <p className="p-3 text-xs text-muted-foreground">Loading company structure…</p> : null}
    {(departments.error || projects.error) && <p role="alert" className="p-3 text-xs text-destructive">Could not load company structure.</p>}
  </div>;
}

export function AgentOSSidebar({ companies, view, navigate }: { companies: Company[]; view: FridayNavigation; navigate: Navigation }) {
  const [expanded, setExpanded] = useState(false);
  const company = view.scope === "portfolio" ? undefined : companies.find(item => item.id === view.companyId);
  const go = (next: FridayNavigation) => { setExpanded(false); navigate(next); };
  const scope = { companyId: view.companyId, scope: view.scope, projectId: view.projectId };
  const links = [
    { label: "Home", Icon: Home, next: { panel: "work", ...scope, mode: "combined" } },
    { label: "Departments", Icon: Boxes, next: { panel: "departments", companyId: view.companyId, scope: view.scope } },
    { label: "Projects", Icon: FolderKanban, next: { panel: "projects", companyId: view.companyId, scope: view.scope } },
    { label: "Kanban", Icon: FolderKanban, next: { panel: "work", ...scope, mode: "kanban" } },
    { label: "Agent Map", Icon: Network, next: { panel: "work", ...scope, mode: "graph" } },
    { label: "Decisions", Icon: CheckCheck, next: { panel: "attention", ...scope } },
    { label: "Routines", Icon: Repeat2, next: { panel: "routines", ...scope } },
    { label: "Artefacts", Icon: FileText, next: { panel: "artifacts", ...scope } },
    { label: "Performance", Icon: ChartNoAxesCombined, next: { panel: "performance", ...scope } },
  ] as const;
  return <aside className="agentos-sidebar" data-expanded={expanded} aria-label="Company navigation">
    <button type="button" className="agentos-mobile-scope" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? <X /> : <Menu />}<span>{company?.name ?? "Your portfolio"}</span><ChevronRight /></button>
    <div className="agentos-sidebar-content"><button type="button" className="agentos-back" onClick={() => go({ panel: null, companyId: view.companyId, scope: view.scope })}><ArrowLeft />Back to Friday</button>
      <p className="agentos-eyebrow">{company?.name ?? "Across your portfolio"}</p>
      {view.projectId && <button type="button" className="agentos-back" onClick={() => go({ panel: "projects", companyId: view.companyId })}><FolderKanban />All projects</button>}
      <nav aria-label="Workspace">{links.map(({ label, Icon, next }) => <Fragment key={label}><button type="button" onClick={() => go(next)} aria-current={view.panel === next.panel && (next.panel !== "work" || (view.mode ?? "combined") === next.mode) ? "page" : undefined}><Icon /><span>{label}</span></button>{label === "Projects" && company && <CompanyTree key={company.id} companyId={company.id} view={view} navigate={go} />}</Fragment>)}</nav>
      <div className="agentos-sidebar-bottom"><div className="agentos-sidebar-divider" /><nav aria-label="People, history and settings">
        <button type="button" onClick={() => go({ panel: "team", companyId: view.companyId, scope: view.scope })} aria-current={view.panel === "team" ? "page" : undefined}><Users />Workforce</button>
        <button type="button" onClick={() => go({ panel: "activity", ...scope })} aria-current={view.panel === "activity" ? "page" : undefined}><Activity />Audit trail</button>
        <button type="button" onClick={() => go({ panel: "library", ...scope })}><CircleHelp />Saved displays</button>
        <button type="button" onClick={() => go({ panel: "settings", companyId: view.companyId })} aria-current={view.panel === "settings" ? "page" : undefined}><Settings2 />Settings</button>
      </nav></div>
    </div>
  </aside>;
}
