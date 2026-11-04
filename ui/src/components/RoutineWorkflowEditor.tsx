import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Agent, RoutineDetail, RoutineTrigger } from "@paperclipai/shared";
import { routinesApi } from "@/api/routines";
import { fridayKey } from "@/api/friday";
import { Link } from "@/lib/router";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

export function RoutineWorkflowEditor({ routine, agents, triggerId, onClose }: { routine: RoutineDetail; agents: Agent[]; triggerId?: string; onClose: () => void }) {
  const client = useQueryClient();
  const returnFocus = useRef(document.activeElement);
  const [title, setTitle] = useState(routine.title), [description, setDescription] = useState(routine.description ?? "");
  const [lead, setLead] = useState(routine.assigneeAgentId ?? ""), [policy, setPolicy] = useState(routine.concurrencyPolicy);
  const [baseRevisionId] = useState(routine.latestRevisionId);
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: fridayKey(routine.companyId) }), client.invalidateQueries({ queryKey: ["routines"] })]); };
  const save = useMutation({ mutationFn: () => routinesApi.update(routine.id, { title, description, assigneeAgentId: lead || null, concurrencyPolicy: policy, baseRevisionId }), onSuccess: async () => { await refresh(); onClose(); } });
  const trigger = routine.triggers.find(row => row.id === triggerId);
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose(); }}><DialogContent className="max-h-(--sz-85vh) overflow-y-auto sm:max-w-2xl" onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current instanceof HTMLElement && returnFocus.current.isConnected) returnFocus.current.focus(); }}><DialogTitle>Edit workflow</DialogTitle><DialogDescription>Update the next cycle’s instructions, lead and triggers. Existing cycle history is preserved.</DialogDescription>
    {trigger ? <TriggerEditor key={trigger.id} trigger={trigger} onSaved={refresh} /> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
      <label className="block text-sm">Name<input required maxLength={200} className="mt-2 w-full rounded-lg border bg-background p-3" value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label className="block text-sm">Objective, steps, inputs and acceptance criteria<textarea className="mt-2 w-full rounded-lg border bg-background p-3" rows={7} value={description} onChange={event => setDescription(event.target.value)} /></label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Accountable lead<select className="mt-2 w-full rounded-lg border bg-background p-3" value={lead} onChange={event => setLead(event.target.value)}><option value="">Unassigned</option>{agents.filter(agent => agent.status !== "terminated" || agent.id === lead).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><label className="text-sm">When a cycle is already running<select className="mt-2 w-full rounded-lg border bg-background p-3" value={policy} onChange={event => setPolicy(event.target.value)}><option value="coalesce_if_active">Combine with active work</option><option value="skip_if_active">Skip this trigger</option><option value="always_enqueue">Queue another cycle</option></select></label></div>
      <p className="text-xs text-muted-foreground">Changes create a new routine revision for future cycles. Existing tasks retain their original instructions and evidence.</p>
      {save.error && <p role="alert" className="text-destructive">{save.error.message}</p>}<div className="flex justify-between"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={save.isPending || !title.trim()}>Save revision</Button></div>
    </form>}
    {!trigger && routine.triggers.map(item => <TriggerEditor key={item.id} trigger={item} onSaved={refresh} />)}
    <Button asChild variant="outline"><Link to={`/routines/${routine.id}/triggers`}>Add triggers or configure advanced inputs</Link></Button>
  </DialogContent></Dialog>;
}
function TriggerEditor({ trigger, onSaved }: { trigger: RoutineTrigger; onSaved: () => Promise<void> }) {
  const [label, setLabel] = useState(trigger.label ?? ""), [enabled, setEnabled] = useState(trigger.enabled);
  const [cron, setCron] = useState(trigger.cronExpression ?? "0 9 * * *"), [zone, setZone] = useState(trigger.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const save = useMutation({ mutationFn: () => routinesApi.updateTrigger(trigger.id, { label: label || null, enabled, ...(trigger.kind === "schedule" ? { cronExpression: cron, timezone: zone } : {}) }), onSuccess: onSaved });
  return <form className="space-y-4 rounded-lg border p-4" onSubmit={event => { event.preventDefault(); save.mutate(); }}><h4 className="font-medium">{trigger.kind} trigger</h4><label className="block text-sm">Label<input className="mt-2 w-full rounded-lg border bg-background p-3" maxLength={120} value={label} onChange={event => setLabel(event.target.value)} /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Enabled</label>
    {trigger.kind === "schedule" && <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Schedule (cron)<input required className="mt-2 w-full rounded-lg border bg-background p-3" value={cron} onChange={event => setCron(event.target.value)} /></label><label className="text-sm">Timezone<input required className="mt-2 w-full rounded-lg border bg-background p-3" value={zone} onChange={event => setZone(event.target.value)} /></label></div>}
    {save.error && <p role="alert" className="text-destructive">{save.error.message}</p>}{save.isSuccess && <p role="status" className="text-sm">Trigger saved.</p>}<div className="flex justify-end"><Button type="submit" variant="outline" disabled={save.isPending}>Save trigger</Button></div>
  </form>;
}
