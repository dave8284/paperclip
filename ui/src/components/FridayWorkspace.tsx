import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Expand, Minimize2, X } from "lucide-react";
import type { AgentConversationFocusData } from "@/lib/conversation-focus";
import { fridayCanvases, fridayCanvasKey, savedFridayCanvases, type FridayCanvas } from "@/lib/friday-canvas";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { Button } from "./ui/button";
import { FridayOrb } from "./FridayOrb";
import { FridayVoiceControls, spokenReply } from "./FridayVoiceControls";
import { PortfolioGalaxy } from "./PortfolioGalaxy";
import { TaskAttachmentPanel } from "./task-side-panel/TaskAttachmentPanel";

export type FridayPanel = "portfolio" | "library" | "canvas" | null;
export function FridayWorkspace({ companyId, data, panel, setPanel, compact, connected }: {
  companyId: string; data: AgentConversationFocusData; panel: FridayPanel;
  setPanel: (panel: FridayPanel) => void; compact: boolean; connected: boolean;
}) {
  const client = useQueryClient();
  const canvases = fridayCanvases(data.issueId, data.attachments, data.workProducts);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [previewStopped, setPreviewStopped] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const arrivalKey = canvases.map(canvas => canvas.attachment.id).sort().join(",");
  useEffect(() => {
    if (data.loading || data.unavailable) return;
    const next = new Set(canvases.map(canvas => canvas.attachment.id));
    const arrival = seen.current && canvases.find(canvas => !seen.current!.has(canvas.attachment.id));
    seen.current = next;
    if (arrival) { setSelected(arrival.attachment.id); setPreviewStopped(false); setPanel("canvas"); }
  }, [arrivalKey, data.loading, data.unavailable]);
  const documents = useQuery({ queryKey: queryKeys.issues.documents(data.issueId ?? ""), queryFn: () => issuesApi.listDocuments(data.issueId!), enabled: !!data.issueId });
  const saved = savedFridayCanvases(documents.isError ? [] : documents.data ?? [], canvases);
  const save = useMutation({
    mutationFn: (canvas: FridayCanvas) => issuesApi.upsertDocument(data.issueId!, fridayCanvasKey(canvas.attachment.id), {
      title: `Saved display: ${canvas.product.title}`.slice(0, 200), format: "markdown",
      body: JSON.stringify({ version: 1, attachmentId: canvas.attachment.id, workProductId: canvas.product.id }),
      baseRevisionId: null, changeSummary: "Save this display for Friday to reuse. The attachment remains the immutable source.",
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.issues.documents(data.issueId!) }),
    onError: () => { void client.invalidateQueries({ queryKey: queryKeys.issues.documents(data.issueId!) }); },
  });
  const chosen = canvases.find(canvas => canvas.attachment.id === selected);
  const selectCanvas = (canvas: FridayCanvas) => { setSelected(canvas.attachment.id); setPreviewStopped(false); setPanel("canvas"); };
  const unavailable = data.unavailable || !connected;
  return <div className="friday-stage" data-panel={!!panel} data-expanded={expanded && !!panel}>
    <div className="friday-presence">
      <FridayVoiceControls compact speakReplies reply={data.reply} onTranscript={data.onTranscript} onVoiceMessage={data.onVoiceMessage} disabled={data.voiceDisabled || data.loading || data.unavailable}
        renderPresence={voice => {
          const state = voice.listening ? "listening" : voice.speaking ? "speaking" : data.awaitingInput ? "waiting" : unavailable ? "offline" : data.runStatus === "running" ? "thinking" : data.runStatus === "queued" ? "waiting" : "idle";
          const status = voice.listening ? "Listening" : voice.speaking ? "Speaking" : voice.starting ? "Opening microphone" : data.awaitingInput ? "Your decision is needed below" : data.loading ? "Loading conversation" : data.unavailable ? "Connection interrupted" : !connected ? "Connect a subscription to begin" : data.runStatus === "running" ? "Working on your request" : data.runStatus === "queued" ? "Waiting to start" : "Ready when you are";
          return <div className="friday-presence-identity">
            <FridayOrb state={state} compact={compact || !!panel} label={voice.listening ? "Send voice message" : voice.starting ? "Cancel microphone" : "Talk to Friday"} onActivate={voice.toggleListening} disabled={!voice.canListen} />
            <div className="space-y-2 text-center"><p className="friday-wordmark">FRIDAY</p><p className="text-sm text-muted-foreground" role="status">{status}</p></div>
          </div>;
        }} />
      {!compact && !data.unavailable && data.reply && <div className="friday-latest-reply"><p className="text-sm">{spokenReply(data.reply.body).slice(0, 440)}{spokenReply(data.reply.body).length > 440 ? "…" : ""}</p><p className="mt-2 text-xs text-muted-foreground">Latest reply · open Conversation for the full response and links</p></div>}
      {!compact && !data.reply && <p className="friday-prompt text-sm text-muted-foreground">Bring me a repository, an idea, or something that needs attention.</p>}
    </div>
    {panel && <section className="friday-workspace" aria-label="Friday workspace">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{panel === "portfolio" ? "Your applications and agents" : panel === "library" ? "Reusable displays" : chosen?.product.title ?? "Canvas"}</h2>
        <Button size="icon-sm" variant="ghost" aria-label={expanded ? "Reduce workspace" : "Expand workspace"} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 /> : <Expand />}</Button>
        <Button size="icon-sm" variant="ghost" aria-label="Close workspace" onClick={() => { setPanel(null); setExpanded(false); }}><X /></Button>
      </header>
      {data.unavailable ? <p role="alert" className="p-4 text-sm">Refresh the conversation before displaying its content.</p> : panel === "portfolio" ? <div className="min-h-0 flex-1 overflow-auto p-4"><PortfolioGalaxy companyId={companyId} /></div>
        : panel === "canvas" && chosen && data.issueId ? <>
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
            <Button size="sm" variant="ghost" disabled={saved.has(chosen.attachment.id) || save.isPending || documents.isPending || documents.isError} onClick={() => save.mutate(chosen)}><Bookmark />{saved.has(chosen.attachment.id) ? "Saved for reuse" : "Save for reuse"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setPreviewStopped(value => !value)}>{previewStopped ? "Resume preview" : "Stop preview"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel("library")}>All displays</Button>
            <span className="text-xs text-muted-foreground">Isolated preview · {new Date(chosen.attachment.createdAt).toLocaleString()}</span>
          </div>
          {previewStopped ? <p className="p-4 text-sm">Preview stopped.</p> : <TaskAttachmentPanel key={chosen.attachment.id} issueId={data.issueId} attachmentId={chosen.attachment.id} />}
        </> : <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          <p className="text-sm text-muted-foreground">Ask Friday for a chart, report, calculator, or interactive view. It appears here when she publishes it. Saved displays stay available in this conversation.</p>
          {canvases.length === 0 && <p className="text-sm">No displays published yet.</p>}
          {canvases.map(canvas => <button type="button" key={canvas.product.id} onClick={() => selectCanvas(canvas)} className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-accent"><span className="text-sm">{canvas.product.title}</span><span className="text-xs text-muted-foreground">{saved.has(canvas.attachment.id) ? "Saved" : "Open"}</span></button>)}
          <Link to="/projects" className="block text-sm text-primary">Open all projects →</Link>
        </div>}
      {(save.error || documents.error) && <p role="alert" className="p-3 text-sm text-destructive">{save.error?.message ?? documents.error?.message}</p>}
    </section>}
  </div>;
}
