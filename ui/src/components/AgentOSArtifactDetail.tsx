import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CompanyArtifact } from "@paperclipai/shared";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { MarkdownBody } from "./MarkdownBody";
import { TaskAttachmentPanel } from "./task-side-panel/TaskAttachmentPanel";
import { Button } from "./ui/button";

export function AgentOSArtifactDetail({ artifact, onClose }: { artifact: CompanyArtifact; onClose: () => void }) {
  const documents = useQuery({ queryKey: queryKeys.issues.documents(artifact.issue.id), queryFn: () => issuesApi.listDocuments(artifact.issue.id), enabled: artifact.source === "document" });
  const document = documents.data?.find(row => `document:${row.id}` === artifact.id);
  const versions = useQuery({ queryKey: queryKeys.issues.documentRevisions(artifact.issue.id, document?.key ?? ""), queryFn: () => issuesApi.listDocumentRevisions(artifact.issue.id, document!.key), enabled: !!document });
  const attachments = useQuery({ queryKey: queryKeys.issues.attachments(artifact.issue.id), queryFn: () => issuesApi.listAttachments(artifact.issue.id), enabled: artifact.source !== "document" });
  const [version, setVersion] = useState<string | null>(null), [file, setFile] = useState<string | null>(artifact.source === "attachment" ? artifact.id.slice("attachment:".length) : null);
  const selected = versions.data?.find(row => row.id === version) ?? versions.data?.[0];
  const download = () => { if (!selected) return; const url = URL.createObjectURL(new Blob([selected.body], { type: "text/markdown" })); const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = `${document?.key ?? "document"}-v${selected.revisionNumber}.md`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  return <section className="space-y-4" aria-label="Artefact history"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="agentos-eyebrow">{artifact.issue.identifier} · {artifact.project?.name ?? "Company work"}</p><h2 className="mt-2 text-lg font-semibold">{artifact.title}</h2></div><Button variant="outline" onClick={onClose}>Back to artefacts</Button></div>{[documents.error, versions.error, attachments.error].filter(Boolean).map((error, i) => <p role="alert" className="text-destructive" key={i}>{error!.message}</p>)}
    {artifact.source === "document" ? <><label className="block text-sm">Saved version<select className="ml-3 rounded-lg border bg-background p-2" value={selected?.id ?? ""} onChange={event => setVersion(event.target.value)}>{versions.data?.map(row => <option key={row.id} value={row.id}>Version {row.revisionNumber} · {new Date(row.createdAt).toLocaleString()}</option>)}</select></label>{selected && <><p className="text-sm text-muted-foreground">{selected.changeSummary ?? "Saved document revision"}</p><Button variant="outline" size="sm" onClick={download}>Download this version</Button><MarkdownBody>{selected.body}</MarkdownBody></>}{versions.isPending && document && <p role="status">Loading saved versions…</p>}</> : <><p className="text-sm text-muted-foreground">Files are immutable snapshots stored with the task. Each published revision remains a separate file.</p>{file && <TaskAttachmentPanel key={file} issueId={artifact.issue.id} attachmentId={file} />}<h3 className="text-sm font-semibold">Task output history</h3><div className="overflow-x-auto"><table className="agentos-data-table"><thead><tr><th>File</th><th>Recorded</th><th>Preview</th></tr></thead><tbody>{attachments.data?.map(row => <tr key={row.id}><td>{row.originalFilename ?? row.id}</td><td>{new Date(row.createdAt).toLocaleString()}</td><td><Button size="sm" variant="ghost" onClick={() => setFile(row.id)}>View file</Button></td></tr>)}</tbody></table></div>{!attachments.isPending && !attachments.data?.length && <p className="text-sm text-muted-foreground">This output has no attached file. Open its source task for the linked work product.</p>}</>}
    <Link className="text-sm text-primary" to={artifact.href}>Source task, review and provenance →</Link>
  </section>;
}
