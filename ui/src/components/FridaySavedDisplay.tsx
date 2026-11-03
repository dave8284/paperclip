import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IssueDocument } from "@paperclipai/shared";
import { issuesApi } from "@/api/issues";
import { fridayApi, fridayKey } from "@/api/friday";
import { queryKeys } from "@/lib/queryKeys";
import { scopedFridaySavedDisplay, type FridayDisplayScope, type FridaySavedDisplay as Display } from "@/lib/friday-saved-display";
import type { FridayNavigation } from "@/lib/friday-navigation";
import { clearFridayDisplaySelection, setFridayDisplaySelection } from "@/lib/friday-display-context";
import { Button } from "./ui/button";

type Props = { document: IssueDocument; scope: FridayDisplayScope; companyNames: Readonly<Record<string, string>>; navigate: (view: FridayNavigation) => void };
export function FridaySavedDisplay(props: Props) {
  // Reject cached or caller-supplied mismatched scope before even reading a document.
  if (!scopedFridaySavedDisplay(props.document, props.scope)) return <Unavailable />;
  return <AuthorizedDisplay key={`${props.document.issueId}:${props.document.key}:${props.document.latestRevisionId}`} {...props} />;
}
function Unavailable() { return <p role="alert" className="text-sm text-destructive">This saved display is not available in this workspace.</p>; }
function AuthorizedDisplay({ document, scope, companyNames, navigate }: Props) {
  const current = useQuery({
    queryKey: [...queryKeys.issues.documents(document.issueId), "saved-display", document.key, document.latestRevisionId],
    queryFn: ({ signal }) => issuesApi.getDocument(document.issueId, document.key, { signal, cache: "no-store" }),
    staleTime: 0, refetchOnMount: "always", retry: false,
  });
  if (current.isFetching || current.isPending) return <p role="status" className="text-sm text-muted-foreground">Opening saved display…</p>;
  if (current.error) return <p role="alert" className="text-sm text-destructive">Saved display unavailable: {current.error.message}</p>;
  const display = current.data && current.data.key === document.key ? scopedFridaySavedDisplay(current.data, scope) : null;
  if (!display) return <Unavailable />;
  return <DisplayTable key={`${current.data!.latestRevisionId}:${JSON.stringify(display)}`} document={current.data!} display={display} companyName={companyNames[display.companyId] ?? "Company"} navigate={navigate} />;
}
function DisplayTable({ document, display, companyName, navigate }: { document: IssueDocument; display: Display; companyName: string; navigate: Props["navigate"] }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    setFridayDisplaySelection(display.companyId, "canvas", { displayKey: document.key, source: display.source,
      ...(display.projectId ? { projectId: display.projectId } : {}), ...(document.latestRevisionId ? { documentRevisionId: document.latestRevisionId } : {}) });
    return clearFridayDisplaySelection;
  }, [display.companyId, display.projectId, display.source, document.key, document.latestRevisionId]);
  const query = { projectId: display.projectId, status: display.status, limit: display.source === "tasks" ? display.limit : 1,
    offset: display.source === "tasks" ? offset : 0, projectOffset: display.source === "projects" ? offset : 0 };
  const work = useQuery({ queryKey: [...fridayKey(display.companyId), "saved-display", display.source, query],
    queryFn: ({ signal }) => fridayApi.work(display.companyId, query, { signal, cache: "no-store" }), staleTime: 0, refetchOnMount: "always", retry: false });
  // Do not show a cached snapshot as current while reauthorizing or after failure.
  const data = work.isSuccess && !work.isFetching ? work.data : undefined;
  const projects = data?.projects.filter(project => !display.projectId || project.id === display.projectId) ?? [];
  const tasks = data?.tasks.filter(task => !display.projectId || task.projectId === display.projectId) ?? [];
  const rows = display.source === "tasks" ? tasks : projects;
  const next = data && (display.source === "tasks" ? data.nextOffset : projects.length > display.limit ? offset + display.limit : data.nextProjectOffset);
  const open = (projectId?: string | null, taskId?: string) => navigate({ panel: "work", scope: "company", companyId: display.companyId, projectId: projectId ?? undefined, taskId, mode: "combined" });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{companyName} · {display.projectId ? projects.find(project => project.id === display.projectId)?.name ?? "Selected project" : "All projects"}</p><Button size="sm" variant="outline" disabled={work.isFetching} onClick={() => void work.refetch()}>Refresh data</Button></div>
    {work.isFetching && <p role="status" className="text-sm text-muted-foreground">Reading current {display.source}…</p>}
    {work.error && <p role="alert" className="text-sm text-destructive">Current data unavailable: {work.error.message}</p>}
    {data && <>
      <div className="agentos-employee-table-wrap"><table className="agentos-employee-table"><caption className="sr-only">{display.title}</caption><thead><tr><th>{display.source === "tasks" ? "Task" : "Project"}</th><th>Status</th>{display.source === "tasks" && <><th>Project</th><th>Priority</th></>}<th><span className="sr-only">Open record</span></th></tr></thead><tbody>
        {display.source === "tasks" ? tasks.slice(0, display.limit).map(task => <tr key={task.id}><td>{task.title}<small>{task.identifier}</small></td><td>{task.status.replaceAll("_", " ")}</td><td>{projects.find(project => project.id === task.projectId)?.name ?? (task.projectId ? "Project" : "No project")}</td><td>{task.priority}</td><td><Button size="sm" variant="ghost" onClick={() => open(task.projectId, task.id)}>Open task</Button></td></tr>)
          : projects.slice(0, display.limit).map(project => <tr key={project.id}><td>{project.name}</td><td>{project.status.replaceAll("_", " ")}</td><td><Button size="sm" variant="ghost" onClick={() => open(project.id)}>Open project</Button></td></tr>)}
      </tbody></table></div>
      {!rows.length && <p className="agentos-empty">No {display.source} in this saved display's scope.</p>}
      <div className="flex items-center justify-between gap-3"><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - display.limit))}>Previous page</Button><span className="text-xs text-muted-foreground">{Math.min(rows.length, display.limit)} {display.source} on this page</span><Button size="sm" variant="outline" disabled={next == null} onClick={() => setOffset(next!)}>Next page</Button></div>
      <p className="agentos-record-note">Observed {new Date(data.observedAt).toLocaleString()}. Current authorized data; each open or resume reads it again.</p>
    </>}
  </div>;
}
