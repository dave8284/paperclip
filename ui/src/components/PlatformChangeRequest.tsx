import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ManagedApplication, PlatformChangeRequestResult, RequestPlatformChange } from "@paperclipai/shared";
import { accessApi } from "../api/access";
import { managedApplicationsApi } from "../api/managed-applications";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { api } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { Link } from "../lib/router";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

export function PlatformChangeRequest({ companyId, application, source }: {
  companyId: string; application?: ManagedApplication; source?: RequestPlatformChange["source"];
}) {
  const [open, setOpen] = useState(false), [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [applicationId, setApplicationId] = useState(application?.id ?? "");
  const [workspaceId, setWorkspaceId] = useState(""), [lead, setLead] = useState(""), [reviewer, setReviewer] = useState("");
  const [title, setTitle] = useState(""), [scope, setScope] = useState("");
  const access = useQuery({ queryKey: queryKeys.access.currentBoardAccess, queryFn: () => accessApi.getCurrentBoardAccess(), retry: false });
  const owner = !access.error && (access.data?.source === "local_implicit" || access.data?.isInstanceAdmin === true);
  const applications = useQuery({ queryKey: ["platform-change-applications", companyId], queryFn: () => managedApplicationsApi.list(companyId, undefined, "platform"), enabled: open && owner && !application });
  const choices = application ? [application] : applications.error ? [] : applications.data?.applications ?? [];
  const selected = choices.find(item => item.id === applicationId && item.kind === "platform" && item.stage !== "archived");
  const workspaces = useQuery({ queryKey: ["platform-change-workspaces", companyId, selected?.homeProjectId], queryFn: () => projectsApi.listWorkspaces(selected!.homeProjectId, companyId), enabled: open && owner && !!selected });
  const employees = useQuery({ queryKey: queryKeys.agents.list(companyId), queryFn: () => agentsApi.list(companyId), enabled: open && owner });
  const eligible = employees.error ? [] : (employees.data ?? []).filter(agent => agent.lifecycleState === "ready" && !["terminated", "pending_approval", "paused"].includes(agent.status));
  const request = useMutation({ mutationFn: (input: RequestPlatformChange) => api.post<PlatformChangeRequestResult>(`/companies/${encodeURIComponent(companyId)}/friday/platform-changes`, input) });
  if (!owner) return null;
  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{source ? "Request component reuse" : "Request platform change"}</Button>;
  const close = () => { setOpen(false); request.reset(); setRequestKey(crypto.randomUUID()); };
  const valid = selected && !workspaces.error && workspaces.data?.some(workspace => workspace.id === workspaceId && workspace.repoUrl)
    && eligible.some(agent => agent.id === lead) && eligible.some(agent => agent.id === reviewer) && lead !== reviewer && title.trim() && scope.trim();
  return <form className="space-y-3 rounded-lg border p-4" aria-label="Platform change request" onSubmit={event => {
    event.preventDefault(); if (!valid || request.isPending) return;
    request.mutate({ requestKey, applicationId, projectWorkspaceId: workspaceId, leadAgentId: lead, reviewerAgentId: reviewer, title, scope, ...(source ? { source } : {}) });
  }}>
    <h3 className="text-sm font-semibold">{source ? "Request reusable component" : "Request platform change"}</h3>
    {request.data ? <><p role="status" className="text-sm">Prepared a task with your request, source references and independent reviewer.</p><Link className="text-sm text-primary" to={`/issues/${request.data.task.identifier ?? request.data.task.id}`}>Open prepared task →</Link><div><Button type="button" variant="outline" onClick={close}>Close</Button></div></> : <>
      <p className="text-sm text-muted-foreground">Prepare implementation and independent review in the internal platform project. Start the saved task when ready. Deployment follows its separate release policy.</p>
      {source && <p className="text-xs text-muted-foreground">The selected saved source is pinned to this request. Its access rules and sandboxed preview remain in place.</p>}
      <fieldset disabled={request.isPending} className="space-y-3">
        {!application && <label className="block space-y-1 text-sm"><span>Internal platform</span><select aria-label="Internal platform" className="w-full rounded-md border bg-background px-3 py-2" value={applicationId} onChange={event => { setApplicationId(event.target.value); setWorkspaceId(""); }}><option value="">Choose platform</option>{choices.filter(item => item.kind === "platform" && item.stage !== "archived").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <label className="block space-y-1 text-sm"><span>Repository</span><select aria-label="Repository" className="w-full rounded-md border bg-background px-3 py-2" value={workspaceId} onChange={event => setWorkspaceId(event.target.value)}><option value="">Choose repository</option>{(!workspaces.error ? workspaces.data ?? [] : []).filter(workspace => workspace.repoUrl).map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
        <label className="block space-y-1 text-sm"><span>Implementation lead</span><select aria-label="Implementation lead" className="w-full rounded-md border bg-background px-3 py-2" value={lead} onChange={event => setLead(event.target.value)}><option value="">Choose lead</option>{eligible.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        <label className="block space-y-1 text-sm"><span>Independent reviewer</span><select aria-label="Independent reviewer" className="w-full rounded-md border bg-background px-3 py-2" value={reviewer} onChange={event => setReviewer(event.target.value)}><option value="">Choose reviewer</option>{eligible.filter(agent => agent.id !== lead).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        <label className="block space-y-1 text-sm"><span>Change title</span><Input aria-label="Change title" value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label>
        <label className="block space-y-1 text-sm"><span>Requested outcome and scope</span><Textarea aria-label="Requested outcome and scope" value={scope} maxLength={12000} onChange={event => setScope(event.target.value)} /></label>
      </fieldset>
      {[applications.error, workspaces.error, employees.error, request.error].filter(Boolean).map((error, index) => <p key={index} role="alert" className="text-sm text-destructive">{error!.message}</p>)}
      <div className="flex items-center justify-between gap-3"><Button type="button" variant="outline" disabled={request.isPending} onClick={close}>Cancel</Button><Button type="submit" disabled={!valid || request.isPending}>{request.isPending ? "Saving…" : "Prepare task"}</Button></div>
    </>}
  </form>;
}
