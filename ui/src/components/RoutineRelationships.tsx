import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RoutineDetail } from "@paperclipai/shared";
import { projectsApi } from "@/api/projects";
import { issuesApi } from "@/api/issues";
import { Button } from "./ui/button";

export function RoutineRelationships({ routine, projectId, parentIssueId, onProjectChange, onParentChange }: {
  routine: RoutineDetail; projectId: string; parentIssueId: string;
  onProjectChange: (value: string) => void; onParentChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const projects = useQuery({ queryKey: ["routine-relationship-projects", routine.companyId], queryFn: () => projectsApi.list(routine.companyId), staleTime: 0 });
  const tasks = useQuery({ queryKey: ["routine-relationship-tasks", routine.companyId, search],
    queryFn: () => issuesApi.list(routine.companyId, { q: search || undefined, includeAgentCreatedTasks: true, limit: 50 }), staleTime: 0 });
  const visibleProjects = projects.isSuccess && !projects.isFetching ? projects.data : [];
  const visibleTasks = tasks.isSuccess && !tasks.isFetching ? tasks.data : [];
  return <fieldset className="space-y-3 rounded-lg border p-4"><legend className="px-1 text-sm font-medium">Relationships</legend>
    <label className="block text-sm">Project<select className="mt-2 w-full rounded-lg border bg-background p-3" value={projectId} onChange={event => onProjectChange(event.target.value)}>
      <option value="">Company-wide</option>
      {projectId && !visibleProjects.some(project => project.id === projectId) && <option value={projectId}>Current project</option>}
      {visibleProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select></label>
    <div className="flex items-end gap-2"><label className="min-w-0 flex-1 text-sm">Find parent task<input className="mt-2 w-full rounded-lg border bg-background p-3" maxLength={200} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); setSearch(draft.trim()); } }} placeholder="Task name or identifier" /></label><Button type="button" variant="outline" onClick={() => setSearch(draft.trim())} disabled={tasks.isFetching}>Search tasks</Button></div>
    <label className="block text-sm">Parent objective<select className="mt-2 w-full rounded-lg border bg-background p-3" value={parentIssueId} onChange={event => onParentChange(event.target.value)}>
      <option value="">No parent task</option>
      {parentIssueId && !visibleTasks.some(task => task.id === parentIssueId) && <option value={parentIssueId}>Current parent task</option>}
      {visibleTasks.map(task => <option key={task.id} value={task.id}>{task.identifier ? `${task.identifier} · ` : ""}{task.title}</option>)}
    </select></label>
    <p className="text-xs text-muted-foreground">Loops with the same parent objective appear together. This changes future cycles; it does not move or rewrite existing work. Showing up to 50 matching tasks.</p>
    {[projects.error, tasks.error].filter(Boolean).map((error, index) => <p role="alert" className="text-sm text-destructive" key={index}>{error!.message}</p>)}
  </fieldset>;
}
