import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ManagedApplication, RequestPlatformChange } from "@paperclipai/shared";
import { ApiError } from "../api/client";
import { componentTextLimit, platformChangesApi, type ComponentPublicationSource } from "../api/platform-changes";
import { Link } from "../lib/router";
import { applyCompanyPrefix } from "../lib/company-routes";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

export interface PlatformChangeRequestProps {
  companyId: string;
  application?: ManagedApplication;
  source?: RequestPlatformChange["source"];
  publicationCandidate?: ComponentPublicationSource;
}

/** Account/company/revision keyed by the entry component. All publication reads
 * are native, fresh and explicitly opened by the owner; no provider is called. */
export function PlatformChangeRequestForm({ companyId, application, source, publicationCandidate, userId }: PlatformChangeRequestProps & { userId: string | null }) {
  const [open, setOpen] = useState(false), [authorityLost, setAuthorityLost] = useState(false);
  const [destination, setDestination] = useState(publicationCandidate ? "" : companyId);
  const [applicationId, setApplicationId] = useState(application?.id ?? "");
  const [workspaceId, setWorkspaceId] = useState(""), [lead, setLead] = useState(""), [reviewer, setReviewer] = useState("");
  const [title, setTitle] = useState(""), [scope, setScope] = useState(""), [editedText, setEditedText] = useState<string>();
  const receipt = useRef<{ fingerprint: string; key: string } | null>(null);
  const key = ["platform-change", userId, companyId] as const;
  const query = { retry: false, staleTime: 0, refetchOnMount: "always" as const };
  const access = useQuery({ ...query, queryKey: [...key, "access"], queryFn: ({ signal }) => platformChangesApi.access(signal) });
  const current = access.isSuccess && !access.isFetching;
  const owner = current && !authorityLost && (access.data.source === "local_implicit" || (access.data.isInstanceAdmin && access.data.userId === userId && access.data.companyIds.includes(companyId)));
  const companies = useQuery({ ...query, queryKey: [...key, "destinations"], queryFn: ({ signal }) => platformChangesApi.companies(signal), enabled: open && owner && !!publicationCandidate });
  const destinations = companies.isSuccess && !companies.isFetching ? companies.data.filter(company => company.status !== "archived" && (access.data?.source === "local_implicit" || access.data?.companyIds.includes(company.id))) : [];
  const destinationReady = !!destination && (!publicationCandidate || destinations.some(company => company.id === destination));
  const destinationPrefix = destinations.find(company => company.id === destination)?.issuePrefix;
  const original = useQuery({ ...query, queryKey: [...key, "publication-source", publicationCandidate], queryFn: ({ signal }) => platformChangesApi.source(publicationCandidate!, signal), enabled: open && owner && !!publicationCandidate });
  const sourceReady = !publicationCandidate || (original.isSuccess && !original.isFetching);
  const applications = useQuery({ ...query, queryKey: [...key, "applications", destination], queryFn: ({ signal }) => platformChangesApi.applications(destination, signal), enabled: open && owner && destinationReady && !application });
  const choices = application ? [application] : applications.isSuccess && !applications.isFetching ? applications.data.applications : [];
  const selected = choices.find(item => item.id === applicationId && item.kind === "platform" && item.stage !== "archived");
  const workspaces = useQuery({ ...query, queryKey: [...key, "workspaces", destination, selected?.homeProjectId], queryFn: ({ signal }) => platformChangesApi.workspaces(destination, selected!.homeProjectId, signal), enabled: open && owner && destinationReady && !!selected });
  const repositories = workspaces.isSuccess && !workspaces.isFetching ? workspaces.data.filter(workspace => workspace.repoUrl) : [];
  const employees = useQuery({ ...query, queryKey: [...key, "employees", destination], queryFn: ({ signal }) => platformChangesApi.employees(destination, signal), enabled: open && owner && destinationReady });
  const eligible = employees.isSuccess && !employees.isFetching ? employees.data.filter(agent => agent.lifecycleState === "ready" && !["terminated", "pending_approval", "paused"].includes(agent.status)) : [];
  const request = useMutation({ mutationFn: (input: RequestPlatformChange) => platformChangesApi.request(destination, input), onError: error => {
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) setAuthorityLost(true);
  } });
  const retryAccess = async () => {
    // A lost response may already have committed. Keep the submitted key across
    // access rechecks; changed content still gets a new key in onSubmit.
    // Keep the owner's redactions in this same immutable source scope. They
    // stay hidden until access is fresh; resetting would reintroduce private text.
    request.reset();
    const fresh = await access.refetch();
    if (!fresh.isSuccess) return;
    if (publicationCandidate) {
      const [destinations, source] = await Promise.all([companies.refetch(), original.refetch()]);
      if (!destinations.isSuccess || !source.isSuccess) return;
    }
    setAuthorityLost(false);
  };
  if (access.isError || authorityLost) return <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{request.error?.message ?? access.error?.message ?? "Access must be checked again."}</p><Button variant="outline" onClick={() => void retryAccess()}>Check access again</Button></div>;
  if (!owner) return null;
  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{publicationCandidate ? "Publish component for reuse" : source ? "Request component reuse" : "Request platform change"}</Button>;
  const selectedText = sourceReady ? editedText ?? original.data?.text ?? "" : "";
  const textValid = !publicationCandidate || (!!selectedText.trim() && !selectedText.includes("\u0000") && new TextEncoder().encode(selectedText).length <= componentTextLimit);
  const valid = destinationReady && sourceReady && textValid && selected && repositories.some(workspace => workspace.id === workspaceId)
    && eligible.some(agent => agent.id === lead) && eligible.some(agent => agent.id === reviewer) && lead !== reviewer && title.trim() && scope.trim();
  const close = () => { setOpen(false); request.reset(); receipt.current = null; setEditedText(undefined); };
  const changeDestination = (id: string) => { setDestination(id); setApplicationId(""); setWorkspaceId(""); setLead(""); setReviewer(""); };
  return <form className="space-y-3 rounded-lg border p-4" aria-label="Platform change request" onSubmit={event => {
    event.preventDefault(); if (!valid || request.isPending) return;
    const content = { applicationId, projectWorkspaceId: workspaceId, leadAgentId: lead, reviewerAgentId: reviewer, title: title.trim(), scope: scope.trim(),
      ...(source ? { source } : {}), ...(publicationCandidate && original.data ? { publication: { sourceCompanyId: publicationCandidate.companyId, source: publicationCandidate.source, expectedSourceSha256: original.data.sha256, selectedText } } : {}) };
    const fingerprint = JSON.stringify([destination, content]);
    if (receipt.current?.fingerprint !== fingerprint) receipt.current = { fingerprint, key: crypto.randomUUID() };
    request.mutate({ requestKey: receipt.current.key, ...content });
  }}>
    <h3 className="text-sm font-semibold">{publicationCandidate ? "Publish a reusable component copy" : source ? "Request reusable component" : "Request platform change"}</h3>
    {request.data && destinationReady ? <><p role="status" className="text-sm">{publicationCandidate ? "Published the selected text into the destination task for implementation and independent review." : "Prepared a task with your request, source references and independent reviewer."}</p><Link className="text-sm text-primary" to={applyCompanyPrefix(`/issues/${request.data.task.identifier ?? request.data.task.id}`, destinationPrefix)}>Open prepared task →</Link><div><Button type="button" variant="outline" onClick={close}>Close</Button></div></> : <>
      <p className="text-sm text-muted-foreground">Prepare implementation and independent review in the internal platform project. Start the saved task when ready. Deployment follows its separate release policy.</p>
      <fieldset disabled={request.isPending} className="space-y-3">
        {publicationCandidate && <>
          <p className="text-sm text-muted-foreground">Review and edit the text below. Only this text is copied into the destination company, where it remains available independently of the original file. Remove private details you do not intend to share. The original company, task and conversation remain separate.</p>
          {sourceReady ? <label className="block space-y-1 text-sm"><span>Selected text to publish</span><Textarea aria-label="Selected text to publish" rows={12} value={selectedText} onChange={event => setEditedText(event.target.value)} /><span className="text-xs text-muted-foreground">{new TextEncoder().encode(selectedText).length.toLocaleString()} of {componentTextLimit.toLocaleString()} bytes</span></label> : <p role="status">Reading the selected saved source…</p>}
          {sourceReady && !textValid && <p role="alert" className="text-sm text-destructive">Choose nonempty text up to 64 KiB without null characters.</p>}
          <label className="block space-y-1 text-sm"><span>Destination company</span><select aria-label="Destination company" className="w-full rounded-md border bg-background px-3 py-2" value={destination} onChange={event => changeDestination(event.target.value)}><option value="">Choose destination</option>{destinations.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        </>}
        {source && <p className="text-xs text-muted-foreground">The selected saved source is pinned to this request. Its access rules and sandboxed preview remain in place.</p>}
        {!application && <label className="block space-y-1 text-sm"><span>Internal platform</span><select aria-label="Internal platform" className="w-full rounded-md border bg-background px-3 py-2" value={applicationId} onChange={event => { setApplicationId(event.target.value); setWorkspaceId(""); }}><option value="">Choose platform</option>{choices.filter(item => item.kind === "platform" && item.stage !== "archived").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {destinationReady && applications.isSuccess && !application && !choices.length && <p role="status" className="text-sm text-muted-foreground">This company has no available internal platform application.</p>}
        <label className="block space-y-1 text-sm"><span>Repository</span><select aria-label="Repository" className="w-full rounded-md border bg-background px-3 py-2" value={workspaceId} onChange={event => setWorkspaceId(event.target.value)}><option value="">Choose repository</option>{repositories.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
        <label className="block space-y-1 text-sm"><span>Implementation lead</span><select aria-label="Implementation lead" className="w-full rounded-md border bg-background px-3 py-2" value={lead} onChange={event => setLead(event.target.value)}><option value="">Choose lead</option>{eligible.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        <label className="block space-y-1 text-sm"><span>Independent reviewer</span><select aria-label="Independent reviewer" className="w-full rounded-md border bg-background px-3 py-2" value={reviewer} onChange={event => setReviewer(event.target.value)}><option value="">Choose reviewer</option>{eligible.filter(agent => agent.id !== lead).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        <label className="block space-y-1 text-sm"><span>Change title</span><Input aria-label="Change title" value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label>
        <label className="block space-y-1 text-sm"><span>Requested outcome and scope</span><Textarea aria-label="Requested outcome and scope" value={scope} maxLength={12000} onChange={event => setScope(event.target.value)} /></label>
      </fieldset>
      {[original, companies, applications, workspaces, employees].filter(query => query.isError).map((query, index) => <div key={index} className="space-y-2"><p role="alert" className="text-sm text-destructive">{query.error!.message}</p><Button type="button" variant="outline" onClick={() => void query.refetch()}>Try again</Button></div>)}
      {request.error && <p role="alert" className="text-sm text-destructive">{request.error.message}</p>}
      <div className="flex items-center justify-between gap-3"><Button type="button" variant="outline" disabled={request.isPending} onClick={close}>Cancel</Button><Button type="submit" disabled={!valid || request.isPending}>{request.isPending ? "Saving…" : publicationCandidate ? "Publish copy and prepare task" : "Prepare task"}</Button></div>
    </>}
  </form>;
}
