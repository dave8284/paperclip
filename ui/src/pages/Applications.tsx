import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers, Plus, ArrowUpRight } from "lucide-react";
import { Link, useNavigate } from "../lib/router";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { managedApplicationsApi } from "../api/managed-applications";
import { projectsApi } from "../api/projects";
import { ApiError } from "../api/client";
import { applicationQueryKey, useApplicationUpdates } from "../hooks/useApplicationUpdates";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

type Draft = { key: string; name: string; brief: string; source: "existing" | "new"; repositoryUrl: string; submitted?: boolean; homeProjectId?: string };
const newDraft = (): Draft => ({ key: crypto.randomUUID(), name: "", brief: "", source: "existing", repositoryUrl: "" });

function ApplicationForm({ companyId, onCancel }: { companyId: string; onCancel: () => void }) {
  const storageKey = `agentos:application-draft:${companyId}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (saved && typeof saved.key === "string" && typeof saved.name === "string" && typeof saved.brief === "string"
        && typeof saved.repositoryUrl === "string" && ["existing", "new"].includes(saved.source)) return saved;
    } catch { /* A corrupt draft must not block creating an application. */ }
    return newDraft();
  });
  const navigate = useNavigate();
  const client = useQueryClient();
  const [storageError, setStorageError] = useState(false);
  const persist = (next: Draft) => {
    setDraft(next);
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(false); }
    catch { setStorageError(true); }
  };
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(draft)); }
    catch { setStorageError(true); }
  }, [draft, storageKey]);
  const create = useMutation({
    mutationFn: async () => {
      // Keep the exact intent across a lost response or a page reload. Both
      // mutations use stable server idempotency keys; retry never invents a key.
      persist({ ...draft, submitted: true });
      let homeProjectId = draft.homeProjectId;
      try {
      const project = homeProjectId ? { id: homeProjectId } : await projectsApi.create(companyId, {
        name: draft.name.trim(), description: draft.brief.trim(), status: "planned",
        idempotencyKey: `agentos:${draft.key}:home`,
        ...(draft.repositoryUrl.trim() ? { repositoryUrls: [draft.repositoryUrl.trim()] } : {}),
      });
      homeProjectId = project.id;
      persist({ ...draft, submitted: true, homeProjectId });
      return managedApplicationsApi.create(companyId, {
        idempotencyKey: draft.key, name: draft.name.trim(), brief: draft.brief.trim(),
        source: draft.source, homeProjectId,
      });
      } catch (error) {
        // A validation/permission rejection before project creation is safe to
        // correct. Unknown outcomes stay frozen until their replay reconciles.
        if (!homeProjectId && error instanceof ApiError && [400, 401, 403, 422].includes(error.status)) persist({ ...draft, submitted: false });
        throw error;
      }
    },
    onSuccess: async application => {
      try { sessionStorage.removeItem(storageKey); } catch { /* Registration is already saved on the server. */ }
      await client.invalidateQueries({ queryKey: applicationQueryKey(companyId) });
      navigate(`/applications/${application.id}`);
    },
  });
  return <Card>
    <CardHeader><CardTitle>Add an application</CardTitle></CardHeader>
    <CardContent>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); create.mutate(); }}>
        <fieldset disabled={create.isPending || draft.submitted} className="space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Starting point">
            <Button type="button" variant={draft.source === "existing" ? "default" : "outline"} onClick={() => setDraft({ ...draft, source: "existing" })}>Existing application</Button>
            <Button type="button" variant={draft.source === "new" ? "default" : "outline"} onClick={() => setDraft({ ...draft, source: "new" })}>Start from an idea</Button>
          </div>
          <label className="block space-y-2"><span className="text-sm font-medium">Application name</span><Input required maxLength={160} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className="block space-y-2"><span className="text-sm font-medium">{draft.source === "existing" ? "GitHub repository" : "GitHub repository, if one exists"}</span><Input type="url" required={draft.source === "existing"} placeholder="https://github.com/owner/repository" value={draft.repositoryUrl} onChange={event => setDraft({ ...draft, repositoryUrl: event.target.value })} /></label>
          <label className="block space-y-2"><span className="text-sm font-medium">What should the team achieve?</span><Textarea required maxLength={20000} rows={5} placeholder="Describe the application, its current state, goals, and constraints." value={draft.brief} onChange={event => setDraft({ ...draft, brief: event.target.value })} /></label>
          <p className="text-sm text-muted-foreground">Creates a shared home project in this organization. Manage its audience through project access. Repository access and agent connections are configured through Paperclip.</p>
        </fieldset>
        {storageError && <p role="alert" className="text-sm text-destructive">This browser could not save your draft. Keep this page open until registration finishes.</p>}
        {create.error && <div role="alert" className="text-sm text-destructive">{create.error.message}{draft.homeProjectId && " Your home project is saved. Retry to finish registering the application."}</div>}
        {draft.submitted && !create.isPending && <p className="text-sm text-muted-foreground">Resume this registration to recover its saved result.</p>}
        <div className="flex items-center justify-between gap-4"><Button type="button" variant="ghost" onClick={onCancel} disabled={create.isPending}>Close</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : draft.submitted ? "Resume registration" : "Create application"}</Button></div>
      </form>
    </CardContent>
  </Card>;
}

export function Applications() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [creating, setCreating] = useState(false);
  useApplicationUpdates(selectedCompanyId);
  useEffect(() => setBreadcrumbs([{ label: "Applications" }]), [setBreadcrumbs]);
  useEffect(() => setCreating(false), [selectedCompanyId]);
  const query = useInfiniteQuery({
    queryKey: [...applicationQueryKey(selectedCompanyId), "list"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => managedApplicationsApi.list(selectedCompanyId!, pageParam),
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: !!selectedCompanyId,
  });
  if (!selectedCompanyId) return <EmptyState icon={Layers} message="Select an organization to view applications." />;
  const applications = query.data?.pages.flatMap(page => page.applications) ?? [];
  const summaries = Object.assign({}, ...(query.data?.pages.map(page => page.summaries) ?? []));
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">Application portfolio</h1><p className="text-sm text-muted-foreground">Your products, projects, and the work moving them forward.</p></div>
      <Button onClick={() => setCreating(true)}><Plus className="size-4" />Add application</Button>
    </div>
    <div className="flex flex-wrap gap-4 text-sm"><Link to="/dashboard/live" className="text-primary">Live agents</Link><Link to="/agents" className="text-primary">Agent pool</Link><Link to="/teams-catalog?search=AgentOS" className="text-primary">Install operating team</Link><Link to="/routines" className="text-primary">Recurring work</Link><Link to="/operating-connections" className="text-primary">Operating connections</Link></div>
    {creating && <ApplicationForm key={selectedCompanyId} companyId={selectedCompanyId} onCancel={() => setCreating(false)} />}
    {query.isLoading && <PageSkeleton variant="list" />}
    {query.error && <p role="alert" className="text-sm text-destructive">{query.error.message} <Button variant="ghost" onClick={() => void query.refetch()}>Retry</Button></p>}
    {!query.isLoading && !query.error && applications.length === 0 && !creating && <EmptyState icon={Layers} message="Add an existing GitHub application or start from an idea." action="Add application" onAction={() => setCreating(true)} />}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {applications.map(application => {
        const summary = summaries[application.id];
        const counts = summary?.taskCounts ?? {};
        return <Card key={application.id}>
          <CardHeader><div className="flex items-center justify-between gap-3"><CardTitle><Link to={`/applications/${application.id}`}>{application.name}</Link></CardTitle><ArrowUpRight className="size-4 text-muted-foreground" /></div><p className="text-xs uppercase tracking-wide text-muted-foreground">{application.stage} · {application.source === "existing" ? "Existing application" : "New application"}</p></CardHeader>
          <CardContent className="space-y-4"><p className="line-clamp-3 text-sm text-muted-foreground">{application.brief}</p>
            <div className="grid grid-cols-4 gap-2 text-sm"><div><strong>{summary?.projectCount ?? 0}</strong><p className="text-xs text-muted-foreground">Projects</p></div><div><strong>{counts.in_progress ?? 0}</strong><p className="text-xs text-muted-foreground">In progress</p></div><div><strong>{counts.blocked ?? 0}</strong><p className="text-xs text-muted-foreground">Blocked</p></div><div><strong>{counts.done ?? 0}</strong><p className="text-xs text-muted-foreground">Done</p></div></div>
            <Link to={`/applications/${application.id}`} className="text-sm font-medium text-primary">Open application →</Link>
          </CardContent>
        </Card>;
      })}
    </div>
    {query.hasNextPage && <Button variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more applications</Button>}
  </div>;
}
