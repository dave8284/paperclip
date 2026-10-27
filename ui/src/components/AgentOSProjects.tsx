import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentOSDepartment } from "@paperclipai/shared";
import { agentsApi } from "@/api/agents";
import { departmentsApi, departmentKey } from "@/api/departments";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/lib/queryKeys";
import type { FridayNavigation } from "@/lib/friday-navigation";
import { Button } from "./ui/button";

export function AgentOSProjects({ companyId, view, navigate, onCreate }: { companyId: string; view: FridayNavigation; navigate: (view: FridayNavigation) => void; onCreate: (text: string) => void }) {
  const client = useQueryClient();
  const projects = useQuery({ queryKey: queryKeys.projects.list(companyId), queryFn: () => projectsApi.list(companyId) });
  const departments = useQuery({ queryKey: departmentKey(companyId), queryFn: () => departmentsApi.list(companyId) });
  const agents = useQuery({ queryKey: queryKeys.agents.list(companyId), queryFn: () => agentsApi.list(companyId) });
  const [editing, setEditing] = useState<AgentOSDepartment | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [leadAgentId, setLeadAgentId] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const invalidate = () => client.invalidateQueries({ queryKey: departmentKey(companyId) });
  const save = useMutation({
    mutationFn: () => {
      const input = { name, description, leadAgentId: leadAgentId || null };
      return editing && editing !== "new" ? departmentsApi.update(companyId, editing.id, { ...input, expectedRevision: editing.revision }) : departmentsApi.create(companyId, input);
    },
    onSuccess: () => { setEditing(null); void invalidate(); },
  });
  const remove = useMutation({ mutationFn: (department: AgentOSDepartment) => departmentsApi.remove(companyId, department.id, department.revision), onSuccess: () => { setRemoving(null); void invalidate(); } });
  const assign = useMutation({ mutationFn: ({ projectId, departmentId }: { projectId: string; departmentId: string | null }) => departmentsApi.assign(companyId, projectId, departmentId), onSuccess: invalidate });
  const projectLead = useMutation({
    mutationFn: ({ projectId, leadAgentId }: { projectId: string; leadAgentId: string | null }) => projectsApi.update(projectId, { leadAgentId }, companyId),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.projects.list(companyId) }),
  });
  const rows = departments.data ?? [];
  const selected = rows.find(row => row.id === view.departmentId);
  const roster = (agents.data ?? []).filter(agent => agent.companyId === companyId);
  const eligible = roster.filter(agent => ["active", "idle", "running", "error"].includes(agent.status) && agent.lifecycleState === "ready");
  const employeeName = (id: string | null | undefined) => !id ? "Not assigned" : roster.find(agent => agent.id === id)?.name ?? "Assigned employee unavailable";
  const startEdit = (department: AgentOSDepartment | null) => {
    save.reset(); setEditing(department ?? "new"); setName(department?.name ?? "");
    setDescription(department?.description ?? ""); setLeadAgentId(department?.leadAgentId ?? "");
  };
  const visible = (projects.data ?? []).filter(project => !project.archivedAt && (!view.departmentId || selected?.projectIds.includes(project.id)));
  const leadOptions = (current: string | null | undefined) => <><option value="">Not assigned</option>{current && !eligible.some(agent => agent.id === current) && <option value={current}>{employeeName(current)} (unavailable)</option>}{eligible.map(agent => <option key={agent.id} value={agent.id}>{agent.name}{agent.title ? ` — ${agent.title}` : ""}</option>)}</>;
  return <div className="space-y-6">
    {[projects.error, departments.error, agents.error, save.error, remove.error, assign.error, projectLead.error].filter(Boolean).map((error, index) => <p key={index} role="alert" className="text-destructive">{error!.message}</p>)}
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => onCreate(`Create a project in company ${companyId}${selected ? `, in department ${selected.name} (${selected.id})` : ""}. Ask me for its objective first.`)}>New project</Button>
      <Button variant="outline" onClick={() => startEdit(null)}>New department</Button>
      {view.departmentId && <Button variant="ghost" onClick={() => navigate({ panel: "projects", companyId })}>All projects</Button>}
    </div>
    {editing && <form className="space-y-4 rounded-xl border p-5" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
      <h2 className="font-semibold">{editing === "new" ? "Create department" : "Edit department"}</h2>
      <label className="block text-sm">Name<input className="mt-2 w-full rounded-lg border bg-background p-3" value={name} onChange={event => setName(event.target.value)} required maxLength={100} /></label>
      <label className="block text-sm">Purpose<textarea className="mt-2 w-full rounded-lg border bg-background p-3" value={description} onChange={event => setDescription(event.target.value)} maxLength={4000} /></label>
      <label className="block text-sm">Department head<select className="mt-2 w-full rounded-lg border bg-background p-3" value={leadAgentId} disabled={agents.isPending || !!agents.error} onChange={event => setLeadAgentId(event.target.value)}>{leadOptions(leadAgentId)}</select></label>
      <p className="text-sm text-muted-foreground">The head coordinates this department’s projects. Private project access remains separately controlled.</p>
      <div className="flex justify-between"><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={save.isPending || !name.trim()} type="submit">Save department</Button></div>
    </form>}
    {view.panel === "departments" && <div className="agentos-project-grid">{rows.map(department => <section className="space-y-3 rounded-xl border p-5" key={department.id}>
      <button type="button" className="text-left" onClick={() => navigate({ panel: "projects", companyId, departmentId: department.id })}><h2 className="text-lg font-semibold">{department.name}</h2><p className="text-sm text-muted-foreground">{department.description || "Projects working toward a shared purpose."}</p><p className="mt-3 text-sm">{department.projectIds.length} accessible projects →</p></button>
      <p className="text-sm"><span className="text-muted-foreground">Department head · </span>{employeeName(department.leadAgentId)}</p>
      <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={() => startEdit(department)}>Edit department</Button><Button variant="ghost" size="sm" onClick={() => setRemoving(department.id)}>Delete department</Button></div>
      {removing === department.id && <div className="space-y-2"><p className="text-sm">Delete this department? Its projects will remain, ungrouped.</p><div className="flex justify-between"><Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>Cancel</Button><Button variant="destructive" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(department)}>Delete</Button></div></div>}
    </section>)}</div>}
    {view.panel === "departments" && !rows.length && !departments.isPending && <p className="agentos-empty">Create departments such as Marketing or Engineering, then group their projects.</p>}
    {view.panel === "projects" && <>
      <div className="agentos-section-heading"><h2>{selected?.name ?? "All projects"}</h2><span>{visible.length} projects</span></div>
      {selected && <p className="text-sm text-muted-foreground">Department head · {employeeName(selected.leadAgentId)}</p>}
      <div className="agentos-project-grid">{visible.map(project => <section key={project.id} className="space-y-4 rounded-xl border p-5">
        <button type="button" className="block w-full text-left" onClick={() => navigate({ panel: "work", companyId, departmentId: rows.find(row => row.projectIds.includes(project.id))?.id, projectId: project.id, mode: "combined" })}><span className="agentos-pill">{project.status.replaceAll("_", " ")}</span><h3 className="mt-4 text-lg font-semibold">{project.name}</h3><p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{project.description || "Open this project’s workspace, tasks and recorded outcomes."}</p><p className="mt-4 text-sm">{project.taskCount ?? 0} tasks · Open workspace →</p></button>
        <label className="block text-xs text-muted-foreground">Department<select aria-label={`Department for ${project.name}`} className="mt-2 w-full rounded-lg border bg-background p-2 text-sm" disabled={assign.isPending || departments.isPending || !!departments.error} value={rows.find(row => row.projectIds.includes(project.id))?.id ?? ""} onChange={event => assign.mutate({ projectId: project.id, departmentId: event.target.value || null })}><option value="">Ungrouped</option>{rows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className="block text-xs text-muted-foreground">Project lead<select aria-label={`Project lead for ${project.name}`} className="mt-2 w-full rounded-lg border bg-background p-2 text-sm" disabled={projectLead.isPending || agents.isPending || !!agents.error} value={project.leadAgentId ?? ""} onChange={event => projectLead.mutate({ projectId: project.id, leadAgentId: event.target.value || null })}>{leadOptions(project.leadAgentId)}</select></label>
      </section>)}</div>
      {!visible.length && !projects.isPending && <p className="agentos-empty">No projects in this scope yet.</p>}
    </>}
    {(projects.isPending || departments.isPending) && <p role="status">Reading company structure…</p>}
  </div>;
}
