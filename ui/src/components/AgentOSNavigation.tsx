import { useState } from "react";
import { Activity, ArrowLeft, Boxes, CheckCheck, ChevronRight, CircleHelp, FileText, FolderKanban, Home, Menu, Network, Repeat2, Settings2, Users, X } from "lucide-react";
import type { Company } from "@paperclipai/shared";
import type { FridayNavigation } from "@/lib/friday-navigation";
import { Link } from "@/lib/router";
import { AgentOSBrand } from "./AgentOSBrand";
import { Button } from "./ui/button";

export function AgentOSHeader({ view, navigate, admin, onSettings, homePath = "/friday" }: {
  view: FridayNavigation; navigate: (view: FridayNavigation) => void; admin?: boolean; onSettings?: () => void; homePath?: string;
}) {
  const links: Array<{ label: string; next: FridayNavigation; active: boolean }> = [
    { label: "Companies", next: { panel: "companies" }, active: view.panel === "companies" },
    { label: "Work", next: { panel: "work", mode: "combined" }, active: view.panel === "work" && view.mode !== "graph" },
    { label: "Decisions", next: { panel: "attention" }, active: view.panel === "attention" },
    { label: "Workforce", next: { panel: "team" }, active: view.panel === "team" || view.panel === "workforce" || view.panel === "chat" },
    { label: "Agent Map", next: { panel: "work", mode: "graph" }, active: view.panel === "work" && view.mode === "graph" },
  ];
  return <header className="agentos-header"><AgentOSBrand to={homePath} /><nav aria-label="Main navigation">{links.map(link => <button type="button" key={link.label} aria-current={link.active ? "page" : undefined} onClick={() => navigate(link.next)}>{link.label}</button>)}</nav><div className="agentos-header-tools">
    <Button variant="ghost" size="icon-sm" aria-label="Audit trail" title="Audit trail" onClick={() => navigate({ panel: "activity" })}><Activity /></Button>
    {admin && <Button asChild variant="ghost" size="sm"><Link to="/admin">Admin</Link></Button>}
    {onSettings && <Button variant="ghost" size="icon-sm" onClick={onSettings} aria-label="Workspace settings"><Settings2 /></Button>}
  </div></header>;
}

export function AgentOSSidebar({ companies, view, navigate }: { companies: Company[]; view: FridayNavigation; navigate: (view: FridayNavigation) => void }) {
  const [expanded, setExpanded] = useState(false);
  const company = companies.find(item => item.id === view.companyId);
  const go = (next: FridayNavigation) => { setExpanded(false); navigate(next); };
  const scope = { companyId: view.companyId, projectId: view.projectId };
  const links = [
    { label: "Home", Icon: Home, next: { panel: "work", ...scope, mode: "combined" } },
    { label: "Kanban", Icon: FolderKanban, next: { panel: "work", ...scope, mode: "kanban" } },
    { label: "Agent Map", Icon: Network, next: { panel: "work", ...scope, mode: "graph" } },
    { label: "Decisions", Icon: CheckCheck, next: { panel: "attention", ...scope } },
    { label: "Routines", Icon: Repeat2, next: { panel: "routines", ...scope } },
    { label: "Artefacts", Icon: FileText, next: { panel: "artifacts", ...scope } },
  ] as const;
  return <aside className="agentos-sidebar" data-expanded={expanded} aria-label="Portfolio navigation">
    <button type="button" className="agentos-mobile-scope" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? <X /> : <Menu />}<span>{company?.name ?? "Your portfolio"}</span><ChevronRight /></button>
    <div className="agentos-sidebar-content">
      <button type="button" className="agentos-back" onClick={() => go({ panel: null })}><ArrowLeft />Back to Friday</button>
      <p className="agentos-eyebrow">Your companies</p>
      <nav aria-label="Companies">{companies.map(item => <button key={item.id} type="button" aria-current={company?.id === item.id ? "page" : undefined} onClick={() => go({ panel: "work", companyId: item.id, mode: "combined" })}><span className="agentos-company-initial">{item.name[0]}</span><span>{item.name}</span></button>)}{!companies.length && <p className="p-3 text-sm text-muted-foreground">No companies yet.</p>}</nav>
      <div className="agentos-sidebar-divider" />
      <p className="agentos-eyebrow">{view.projectId ? "Project workspace" : company ? "Company workspace" : "Across your portfolio"}</p>
      {view.projectId && <button type="button" className="agentos-back" onClick={() => go({ panel: "work", companyId: view.companyId, mode: "combined" })}><Boxes />All projects</button>}
      <nav aria-label="Workspace">{links.map(({ label, Icon, next }) => <button key={label} type="button" onClick={() => go(next)} aria-current={view.panel === next.panel && (next.panel !== "work" || (view.mode ?? "combined") === next.mode) ? "page" : undefined}><Icon /><span>{label}</span></button>)}</nav>
      <div className="agentos-sidebar-divider" />
      <nav aria-label="People and history"><button type="button" onClick={() => go({ panel: "team", companyId: view.companyId })} aria-current={view.panel === "team" ? "page" : undefined}><Users />Workforce</button><button type="button" onClick={() => go({ panel: "activity", ...scope })} aria-current={view.panel === "activity" ? "page" : undefined}><Activity />Audit trail</button><button type="button" onClick={() => go({ panel: "library" })}><CircleHelp />Saved displays</button></nav>
    </div>
  </aside>;
}
