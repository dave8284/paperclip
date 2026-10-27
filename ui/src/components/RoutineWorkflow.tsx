import { useEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { Agent, Issue, IssueWorkProduct, RoutineDetail, RoutineRunSummary } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { Button } from "./ui/button";
import { MarkdownBody } from "./MarkdownBody";
import { ApplicationTaskInspector } from "./ApplicationTaskInspector";
import { TaskAttachmentPanel } from "./task-side-panel/TaskAttachmentPanel";
import { agentCategory } from "@/lib/agent-category";
import { AgentMapSphere } from "./AgentMapSphere";

type Node = { id: string; title: string; kind: "trigger" | "agent" | "task" | "output" | "next"; status: string; x: number; y: number; task?: Issue; output?: IssueWorkProduct; agent?: Agent };
export function RoutineWorkflow({ routine, cycle, task, tasks, outputs, agents, onEdit }: {
  routine: RoutineDetail; cycle?: RoutineRunSummary; task?: Issue; tasks: Issue[]; outputs: IssueWorkProduct[]; agents: Agent[]; onEdit: (triggerId?: string) => void;
}) {
  const [quiet, setQuiet] = useState(document.hidden);
  useEffect(() => { const update = () => setQuiet(document.hidden); document.addEventListener("visibilitychange", update); return () => document.removeEventListener("visibilitychange", update); }, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const nodes: Node[] = [], edges: Array<{ from: string; to: string; active: boolean }> = [];
  const lead = agents.find(agent => agent.id === (task?.assigneeAgentId ?? routine.assigneeAgentId));
  const childTasks = tasks.slice(0, 30), visibleOutputs = outputs.slice(0, 30);
  const height = Math.max(560, Math.max(childTasks.length, visibleOutputs.length, routine.triggers.length) * 105 + 170);
  const middle = Math.min(height / 2, 320);
  const connect = (from: string, to: string, active = false) => edges.push({ from, to, active });
  const triggers = routine.triggers.length ? routine.triggers : [{ id: "manual", kind: "manual", label: "Manual request", enabled: true }];
  triggers.forEach((trigger, index) => { nodes.push({ id: trigger.id, title: trigger.label ?? trigger.kind, kind: "trigger", status: trigger.enabled ? trigger.kind : "Disabled", x: 30, y: 100 + index * 105 }); connect(trigger.id, "lead", cycle?.triggerId === trigger.id && task?.status === "in_progress"); });
  nodes.push({ id: "lead", title: lead?.name ?? "Unassigned", agent: lead, kind: "agent", status: task ? "Cycle owner" : "Configured lead", x: 270, y: middle });
  nodes.push({ id: "cycle", title: task?.title ?? "Next cycle task", kind: "task", status: task?.status.replaceAll("_", " ") ?? "Not dispatched", task, x: 510, y: middle });
  connect("lead", "cycle", task?.status === "in_progress");
  childTasks.forEach((child, index) => { nodes.push({ id: child.id, title: child.title, kind: "task", task: child, status: `${agents.find(agent => agent.id === child.assigneeAgentId)?.name ?? "Unassigned"} · ${child.status.replaceAll("_", " ")}`, x: 750, y: 100 + index * 105 }); connect("cycle", child.id, child.status === "in_progress"); });
  visibleOutputs.forEach((output, index) => { const parent = output.issueId === task?.id ? "cycle" : childTasks.find(child => child.id === output.issueId)?.id; if (!parent) return; nodes.push({ id: output.id, title: output.title, output, kind: "output", status: `${output.status} · ${output.reviewState}`, x: 1000, y: 100 + index * 105 }); connect(parent, output.id); });
  nodes.push({ id: "next", title: "Return at next trigger", kind: "next", status: routine.status === "active" ? "Schedule / event driven" : routine.status, x: 510, y: height - 100 });
  connect("cycle", "next");
  triggers.filter(trigger => trigger.enabled).forEach(trigger => connect("next", trigger.id));
  const positions = new Map(nodes.map(node => [node.id, node]));
  const chosen = selected ? positions.get(selected) : undefined;
  const zoom = (factor: number) => setView(current => ({ ...current, zoom: Math.max(.15, Math.min(3, current.zoom * factor)) }));
  return <section className="agentos-workflow" aria-label="Routine workflow"><div className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h3 className="font-semibold">Workflow</h3><p className="text-xs text-muted-foreground">Drag to explore; select a step to inspect work and outputs. Triggers and next cycle show the current definition.</p></div><div className="flex items-center gap-2"><Button size="icon-sm" variant="ghost" aria-label="Zoom out workflow" onClick={() => zoom(1 / 1.25)}><Minus /></Button><span className="text-xs">{Math.round(view.zoom * 100)}%</span><Button size="icon-sm" variant="ghost" aria-label="Zoom in workflow" onClick={() => zoom(1.25)}><Plus /></Button><Button size="icon-sm" variant="ghost" aria-label="Fit workflow" onClick={() => setView({ x: 0, y: 0, zoom: Math.min(1, 700 / height) })}><Maximize /></Button><Button size="sm" variant="outline" onClick={() => onEdit()}>Edit loop</Button></div></div>
    <div className="agentos-workflow-body"><svg className="agentos-workflow-canvas" data-quiet={quiet} viewBox={`${view.x} ${view.y} ${1240 / view.zoom} ${700 / view.zoom}`} aria-label="Connected routine steps" role="group"
      onPointerDown={event => { if ((event.target as Element).closest('[role="button"]')) return; drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (!drag.current) return; const box = event.currentTarget.getBoundingClientRect(); if (!box.width || !box.height) return; const dx = (event.clientX - drag.current.x) * 1240 / view.zoom / box.width, dy = (event.clientY - drag.current.y) * 700 / view.zoom / box.height; drag.current = { x: event.clientX, y: event.clientY }; setView(current => ({ ...current, x: current.x - dx, y: current.y - dy })); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {edges.map(edge => { const from = positions.get(edge.from)!, to = positions.get(edge.to)!; return <path key={`${edge.from}:${edge.to}`} className="agentos-workflow-edge" data-active={edge.active} d={`M ${from.x + 190} ${from.y + 40} C ${from.x + 220} ${from.y + 40}, ${to.x - 30} ${to.y + 40}, ${to.x} ${to.y + 40}`} />; })}
      {nodes.map(node => <g key={node.id} role="button" tabIndex={0} className="agentos-workflow-node" data-kind={node.kind} data-selected={chosen?.id === node.id} aria-label={`${node.kind}: ${node.title} · ${node.status}`} aria-pressed={chosen?.id === node.id} onClick={() => setSelected(node.id)} onKeyDown={event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); setSelected(node.id); } }}>
        <rect x={node.x} y={node.y} width={190} height={80} rx={14} /><text x={node.x + 14} y={node.y + 20} className="agentos-workflow-kind">{node.kind === "next" ? "↻ Next cycle" : node.kind}</text>
        {node.kind === "agent" && <g data-category={agentCategory(node.agent)}><AgentMapSphere x={node.x + 160} y={node.y + 40} /></g>}
        <text x={node.x + 14} y={node.y + 41} className="agentos-workflow-title">{node.title.length > (node.kind === "agent" ? 17 : 25) ? `${node.title.slice(0, node.kind === "agent" ? 16 : 24)}…` : node.title}</text><text x={node.x + 14} y={node.y + 62} className="agentos-workflow-status">{node.status.slice(0, 29)}</text><title>{node.title} · {node.status}</title>
      </g>)}
    </svg>
    {chosen && <aside className="agentos-workflow-inspector"><div className="flex justify-between gap-2"><h3 className="font-semibold">{chosen.title}</h3><Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Close</Button></div><p className="text-sm text-muted-foreground">{chosen.status}</p>
      {chosen.kind === "trigger" && <><p className="text-sm">{routine.triggers.find(trigger => trigger.id === chosen.id)?.cronExpression ?? "This event dispatches the loop under its saved access and approval rules."}</p><Button variant="outline" onClick={() => onEdit(chosen.id)}>Edit trigger</Button></>}
      {chosen.kind === "agent" && <><p className="text-sm">{chosen.agent?.capabilities ?? "Coordinates the cycle and assigns work to other employees."}</p>{chosen.agent && <Button asChild variant="outline"><Link to={`/agents/${chosen.agent.id}`}>Employee profile</Link></Button>}</>}
      {chosen.task && <><Button asChild variant="outline"><Link to={`/issues/${chosen.task.id}`}>Open task and triage</Link></Button><ApplicationTaskInspector task={chosen.task} /></>}
      {chosen.output && <><MarkdownBody>{chosen.output.summary ?? "No output summary recorded."}</MarkdownBody>{typeof chosen.output.metadata?.attachmentId === "string" ? <TaskAttachmentPanel issueId={chosen.output.issueId} attachmentId={chosen.output.metadata.attachmentId} /> : <Button asChild variant="outline"><Link to={`/issues/${chosen.output.issueId}`}>Inspect output and versions</Link></Button>}</>}
      {chosen.kind === "next" && <><p className="text-sm">The scheduler follows the saved triggers and concurrency policy. A completed output is evidence, not an automatic publishing approval.</p><Button variant="outline" onClick={() => onEdit()}>Edit recurrence</Button></>}
    </aside>}
    </div>{(tasks.length > 30 || outputs.length > 30) && <p className="p-4 text-xs text-muted-foreground">Showing the first 30 child tasks and outputs in this cycle. Open the cycle task for its complete history.</p>}
  </section>;
}
