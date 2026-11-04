import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight, File, FileText, Folder, Globe, Image, Video } from "lucide-react";
import type { CompanyArtifact } from "@paperclipai/shared";
import { artifactsApi } from "@/api/artifacts";
import { fridayKey } from "@/api/friday";
import { AgentOSArtifactDetail } from "./AgentOSArtifactDetail";
import { Button } from "./ui/button";

const folders = ["Research & sources", "Documents", "Images", "Videos", "Files & links"] as const;
type FolderName = typeof folders[number];
const icons = { "Research & sources": Globe, Documents: FileText, Images: Image, Videos: Video, "Files & links": File };

export function artifactFolder(artifact: CompanyArtifact): FolderName {
  if (artifact.collection === "research") return "Research & sources";
  if (artifact.mediaKind === "image") return "Images";
  if (artifact.mediaKind === "video") return "Videos";
  if (artifact.source === "document" || ["text", "document"].includes(artifact.mediaKind)) return "Documents";
  return "Files & links";
}

/** A projection of saved outputs, not a second filesystem or execution log. */
export function AgentOSArtifactBrowser({ companyId, projectId, agentId }: { companyId: string; projectId?: string; agentId?: string }) {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CompanyArtifact | null>(null);
  useEffect(() => { const timer = setTimeout(() => setSearch(draft.trim()), 250); return () => clearTimeout(timer); }, [draft]);
  const query = useInfiniteQuery({
    queryKey: [...fridayKey(companyId), "artifact-files", projectId, agentId, search],
    queryFn: ({ pageParam }) => artifactsApi.list(companyId, { projectId, agentId, q: search || undefined, cursor: pageParam, limit: 100 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor ?? undefined,
  });
  const projects = useMemo(() => {
    const seen = new Set<string>();
    const result = new Map<string, { name: string; artifacts: CompanyArtifact[] }>();
    for (const artifact of query.data?.pages.flatMap(page => page.artifacts) ?? []) {
      if (seen.has(artifact.id)) continue;
      seen.add(artifact.id);
      const key = artifact.project?.id ?? "__company__";
      const project = result.get(key) ?? { name: artifact.project?.name ?? "Company files", artifacts: [] };
      project.artifacts.push(artifact); result.set(key, project);
    }
    return [...result.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name));
  }, [query.data]);
  if (selected) return <AgentOSArtifactDetail key={selected.id} artifact={selected} onClose={() => setSelected(null)} />;
  return <section className="space-y-4" aria-label="Project files and folders">
    <p className="text-sm text-muted-foreground">Project outputs, documents and saved research, organised into folders. Open a file for its contents, versions and source task.</p>
    <label className="block text-sm">Search files and research<input className="mt-2 w-full rounded-lg border bg-background p-3" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Find a file, document or saved source…" /></label>
    {query.isPending && <p role="status">Loading project files…</p>}
    {query.error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{query.error.message}</p><Button variant="outline" onClick={() => void query.refetch()}>Try again</Button></div>}
    {projects.map(([id, project]) => <details key={id} open className="rounded-xl border p-4">
      <summary className="flex cursor-pointer items-center gap-2 font-medium"><Folder className="size-4" /><span>{project.name}</span><span className="ml-auto text-xs text-muted-foreground">{project.artifacts.length} loaded</span></summary>
      <div className="mt-3 space-y-2">{folders.map(folder => {
        const rows = project.artifacts.filter(artifact => artifactFolder(artifact) === folder);
        if (!rows.length) return null;
        const Icon = icons[folder];
        return <details key={folder} className="rounded-lg border" open={!!search}>
          <summary className="flex cursor-pointer items-center gap-2 p-3 text-sm"><ChevronRight className="size-4" /><Folder className="size-4" /><span>{folder}</span><span className="ml-auto text-muted-foreground">{rows.length}</span></summary>
          <ul className="divide-y border-t">{rows.map(artifact => <li key={artifact.id}><button type="button" onClick={() => setSelected(artifact)} className="flex w-full items-start gap-3 p-3 text-left hover:bg-muted/40"><Icon className="mt-1 size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{artifact.title}</span><span className="mt-1 block text-xs text-muted-foreground">{artifact.issue.identifier} · {artifact.createdByAgent?.name ?? "Saved output"} · {new Date(artifact.updatedAt).toLocaleDateString()}</span>{artifact.previewText && <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">{artifact.previewText}</span>}</span><ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" /></button></li>)}</ul>
        </details>;
      })}</div>
    </details>)}
    {!query.isPending && !query.error && !projects.length && <p className="agentos-empty">{search ? "No saved files match this search." : "No files or saved research in this scope yet. Outputs attached to tasks appear here."}</p>}
    {query.hasNextPage && <div className="space-y-2"><p className="text-xs text-muted-foreground">More saved files are available. Folder counts include the files loaded so far.</p><Button variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? "Loading…" : "Load more files"}</Button></div>}
  </section>;
}
