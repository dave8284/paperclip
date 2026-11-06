import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CompanyArtifact } from "@paperclipai/shared";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { MarkdownBody } from "./MarkdownBody";
import { TaskAttachmentPanel } from "./task-side-panel/TaskAttachmentPanel";
import { Button } from "./ui/button";
import { PlatformChangeRequest } from "./PlatformChangeRequest";
import { isComponentText } from "../api/platform-changes";

function artifactLink(value: string | null) {
  if (!value) return null;
  try { const url = new URL(value, window.location.origin); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}

export function AgentOSArtifactDetail({ artifact, onClose }: { artifact: CompanyArtifact; onClose: () => void }) {
  const documents = useQuery({ queryKey: queryKeys.issues.documents(artifact.issue.id), queryFn: () => issuesApi.listDocuments(artifact.issue.id), enabled: artifact.source === "document" });
  const document = documents.isSuccess ? documents.data.find(row => `document:${row.id}` === artifact.id) : undefined;
  const versions = useQuery({ queryKey: queryKeys.issues.documentRevisions(artifact.issue.id, document?.key ?? ""), queryFn: () => issuesApi.listDocumentRevisions(artifact.issue.id, document!.key), enabled: !!document });
  const attachments = useQuery({ queryKey: queryKeys.issues.attachments(artifact.issue.id), queryFn: () => issuesApi.listAttachments(artifact.issue.id), enabled: artifact.source !== "document" });
  const [version, setVersion] = useState<string | null>(null), [file, setFile] = useState<string | null>(artifact.source === "attachment" ? artifact.id.slice("attachment:".length) : null);
  const selected = versions.isSuccess && document ? (version ? versions.data.find(row => row.id === version) : versions.data[0]) : undefined;
  const openLink = artifactLink(artifact.openPath);
  const downloadLink = artifactLink(artifact.downloadPath);
  const download = () => { if (!selected) return; const url = URL.createObjectURL(new Blob([selected.body], { type: "text/markdown" })); const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = `${document?.key ?? "document"}-v${selected.revisionNumber}.md`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const source = artifact.source === "document" ? documents : attachments;
  const revisionError = artifact.source === "document" && document ? versions.error : null;
  const error = source.error ?? revisionError;
  if (error) return <section className="space-y-3" aria-label="Artefact history"><p role="alert" className="text-destructive">{error.message}</p><div className="flex gap-3"><Button variant="outline" onClick={onClose}>Back to artefacts</Button><Button variant="outline" onClick={() => { if (source.isError) void source.refetch(); else void versions.refetch(); }}>Try again</Button></div></section>;
  if (!source.isSuccess || (document && !versions.isSuccess)) return <section className="space-y-3" aria-label="Artefact history"><p role="status">Loading file history…</p><Button variant="outline" onClick={onClose}>Back to artefacts</Button></section>;
  const attachmentId = artifact.source === "attachment" ? artifact.id.slice("attachment:".length) : null;
  if ((artifact.source === "document" && !document) || (attachmentId && !attachments.data?.some(row => row.id === attachmentId))) return <section className="space-y-3" aria-label="Artefact history"><p role="status">This file is no longer available.</p><Button variant="outline" onClick={onClose}>Back to artefacts</Button></section>;
  // Work products deduplicate their backing attachment from the browser list.
  // Resolve that file against this task's authorized list, never a stored URL.
  const linkedFile = artifact.source === "work_product" && artifact.contentPath
    ? attachments.data?.find(row => row.contentPath === artifact.contentPath) : undefined;
  if (artifact.source === "work_product" && artifact.contentPath && !linkedFile) return <section className="space-y-3" aria-label="Artefact history"><p role="status">The linked file is no longer available in this task.</p><Button variant="outline" onClick={onClose}>Back to artefacts</Button><Link className="block text-sm text-primary" to={artifact.href}>Source task, review and provenance →</Link></section>;
  const selectedFile = (file ?? linkedFile?.id) && attachments.data?.find(row => row.id === (file ?? linkedFile?.id));
  return <section className="space-y-4" aria-label="Artefact history"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="agentos-eyebrow">{artifact.issue.identifier} · {artifact.project?.name ?? "Company work"}</p><h2 className="mt-2 text-lg font-semibold">{artifact.title}</h2></div><Button variant="outline" onClick={onClose}>Back to artefacts</Button></div>{[documents.error, versions.error, attachments.error].filter(Boolean).map((error, i) => <p role="alert" className="text-destructive" key={i}>{error!.message}</p>)}
    {artifact.source === "document" ? <><label className="block text-sm">Saved version<select className="ml-3 rounded-lg border bg-background p-2" value={selected?.id ?? ""} onChange={event => setVersion(event.target.value)}>{versions.data?.map(row => <option key={row.id} value={row.id}>Version {row.revisionNumber} · {new Date(row.createdAt).toLocaleString()}</option>)}</select></label>{selected && <><p className="text-sm text-muted-foreground">{selected.changeSummary ?? "Saved document revision"}</p><Button variant="outline" size="sm" onClick={download}>Download this version</Button><MarkdownBody>{selected.body}</MarkdownBody></>}{versions.isPending && document && <p role="status">Loading saved versions…</p>}</> : <><p className="text-sm text-muted-foreground">Files are immutable snapshots stored with the task. Each published revision remains a separate file.</p>{selectedFile && <TaskAttachmentPanel key={selectedFile.id} issueId={artifact.issue.id} attachmentId={selectedFile.id} />}<h3 className="text-sm font-semibold">Task output history</h3><div className="overflow-x-auto"><table className="agentos-data-table"><thead><tr><th>File</th><th>Recorded</th><th>Preview</th></tr></thead><tbody>{attachments.data?.map(row => <tr key={row.id}><td>{row.originalFilename ?? row.id}</td><td>{new Date(row.createdAt).toLocaleString()}</td><td><Button size="sm" variant="ghost" onClick={() => setFile(row.id)}>View file</Button></td></tr>)}</tbody></table></div>{!attachments.isPending && !attachments.data?.length && <p className="text-sm text-muted-foreground">This output has no attached file. Open its source task for the linked work product.</p>}</>}
    {(openLink || downloadLink) && <div className="flex flex-wrap gap-3">{openLink && <Button asChild variant="outline"><a href={openLink} target="_blank" rel="noopener noreferrer">Open file or source</a></Button>}{downloadLink && <Button asChild variant="outline"><a href={downloadLink} target="_blank" rel="noopener noreferrer">Download file</a></Button>}</div>}
    {document && selected && <PlatformChangeRequest companyId={document.companyId} publicationCandidate={{ companyId: document.companyId, source: { kind: "document", issueId: artifact.issue.id, documentId: document.id, revisionId: selected.id } }} />}
    {selectedFile && isComponentText(selectedFile.contentType) && selectedFile.byteSize <= 262_144 && <PlatformChangeRequest companyId={selectedFile.companyId} publicationCandidate={{ companyId: selectedFile.companyId, source: { kind: "attachment", issueId: artifact.issue.id, attachmentId: selectedFile.id } }} />}
    <Link className="text-sm text-primary" to={artifact.href}>Source task, review and provenance →</Link>
  </section>;
}
