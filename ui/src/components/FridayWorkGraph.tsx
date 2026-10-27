import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Maximize, Minus, Plus, X } from "lucide-react";
import type { Agent, FridayWork } from "@paperclipai/shared";
import { fridayGraph, type FridayGraphNode } from "../lib/friday-graph";
import { AgentMapSphere } from "./AgentMapSphere";
import { agentCategories, agentCategory } from "@/lib/agent-category";
import { Button } from "./ui/button";

export function FridayWorkGraph({ data, agents, running, onSelect, companies }: { data: FridayWork; agents: Agent[]; running: ReadonlySet<string>; onSelect: (node: FridayGraphNode) => void; companies?: Array<{ id: string; name: string; projectIds: string[] }> }) {
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [evidence, setEvidence] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [quiet, setQuiet] = useState(document.hidden);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { const update = () => setQuiet(document.hidden); document.addEventListener("visibilitychange", update); return () => document.removeEventListener("visibilitychange", update); }, []);
  const graph = useMemo(() => fridayGraph(evidence ? data : { ...data, evidence: [] }, agents, running, companies), [data, agents, running, companies, evidence]);
  const employees = new Map(agents.map(agent => [agent.id, agent]));
  const bounds = useMemo(() => {
    if (!graph.nodes.length) return { x: 500, y: 300, width: 1100, height: 700 };
    const xs = graph.nodes.map(node => node.x), ys = graph.nodes.map(node => node.y);
    const left = Math.min(...xs) - 100, right = Math.max(...xs) + 100;
    const top = Math.min(...ys) - 100, bottom = Math.max(...ys) + 110;
    const width = Math.max(900, right - left, (bottom - top) * 11 / 7);
    return { x: (left + right) / 2, y: (top + bottom) / 2, width, height: width * 7 / 11 };
  }, [graph]);
  const positions = new Map(graph.nodes.map(node => [node.id, node]));
  const selected = selectedId ? positions.get(selectedId) : undefined;
  const focusId = hovered ?? selected?.id;
  const connections = graph.edges.filter(edge => edge.from === focusId || edge.to === focusId);
  const related = new Set([focusId, ...connections.flatMap(edge => [edge.from, edge.to])]);
  const width = bounds.width / view.zoom, height = bounds.height / view.zoom;
  const zoom = (factor: number) => setView(value => ({ ...value, zoom: Math.max(.5, Math.min(8, value.zoom * factor)) }));
  return <div className="friday-map-shell agentos-map-constellation">
    <div className="friday-map-toolbar"><div><p className="agentos-eyebrow">A living view of your work</p><span>{graph.nodes.length} records · {graph.nodes.filter(node => node.running && node.kind === "task").length} running tasks</span></div><div className="friday-map-controls"><label><input type="checkbox" checked={evidence} onChange={event => setEvidence(event.target.checked)} />Evidence</label>
      <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => zoom(1 / 1.3)}><Minus /></Button><span className="friday-map-zoom">{Math.round(view.zoom * 100)}%</span>
      <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => zoom(1.3)}><Plus /></Button>
      <Button size="icon-sm" variant="ghost" aria-label="Fit work graph" onClick={() => setView({ x: 0, y: 0, zoom: 1 })}><Maximize /></Button>
    </div></div>
    <div className="friday-map-stage">
      <svg className="friday-work-graph" data-quiet={quiet} role="group" aria-label="Project and agent work graph" viewBox={`${bounds.x - width / 2 + view.x} ${bounds.y - height / 2 + view.y} ${width} ${height}`}
        onPointerDown={event => { if ((event.target as Element).closest('[role="button"]')) return; drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (!drag.current) return; const rect = event.currentTarget.getBoundingClientRect(); if (!rect.width || !rect.height) return; const dx = (event.clientX - drag.current.x) * width / rect.width, dy = (event.clientY - drag.current.y) * height / rect.height; drag.current = { x: event.clientX, y: event.clientY }; setView(value => ({ ...value, x: value.x - dx, y: value.y - dy })); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onWheel={event => { if (!event.ctrlKey) return; event.preventDefault(); zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15); }}>
        {graph.edges.map(edge => {
          const from = positions.get(edge.from)!, to = positions.get(edge.to)!;
          const bend = edge.kind === "handoff" ? .2 : .08;
          const path = `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2 - (to.y - from.y) * bend} ${(from.y + to.y) / 2 + (to.x - from.x) * bend} ${to.x} ${to.y}`;
          const employee = from.kind === "agent" ? from : to.kind === "agent" ? to : undefined;
          return <path key={edge.id} d={path} className="friday-graph-edge" data-kind={edge.kind} data-category={employee ? agentCategory(employees.get(employee.recordId)) : undefined} data-active={edge.active} data-dimmed={!!focusId && edge.from !== focusId && edge.to !== focusId}><title>{edge.label}{edge.taskId ? ` · ${positions.get(`task:${edge.taskId}`)?.title ?? edge.taskId}` : ""}</title></path>;
        })}
        {graph.nodes.map(node => {
          const anchor = ["company", "application", "project", "agent"].includes(node.kind);
          const focused = node.id === focusId;
          const category = node.kind === "agent" ? agentCategory(employees.get(node.recordId)) : undefined;
          const taskCount = node.kind === "agent" ? data.tasks.filter(task => task.assigneeAgentId === node.recordId).length : 0;
          return <g key={node.id} role="button" tabIndex={0} aria-label={`${node.kind}: ${node.title}${node.status ? ` · ${node.status}` : ""}`} aria-pressed={selected?.id === node.id} className="friday-graph-node" data-kind={node.kind} data-category={category} data-status={node.status} data-running={node.running} data-dimmed={!!focusId && !related.has(node.id)} data-focused={focused}
            onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(node.id)} onBlur={() => setHovered(null)} onClick={() => setSelectedId(node.id)} onDoubleClick={() => onSelect(node)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(node.id); } }}>
            <circle className="agentos-map-hit" cx={node.x} cy={node.y} r={node.kind === "agent" ? 49 : anchor ? 28 : 14} aria-hidden="true" />
            {anchor && node.kind !== "agent" && <circle className="friday-graph-halo" cx={node.x} cy={node.y} aria-hidden="true" />}
            {node.kind === "agent" ? <AgentMapSphere x={node.x} y={node.y} size={132} running={node.running} quiet={quiet} /> : <circle className="friday-graph-core" cx={node.x} cy={node.y} />}
            {node.kind === "task" && node.status === "done" && <path className="agentos-map-completed" d={`M ${node.x - 3} ${node.y} l 2 2 l 4 -4`} aria-hidden="true" />}
            <title>{node.title}{node.status ? ` · ${node.status}` : ""}</title>
            {(anchor || focused || view.zoom > 1.6) && <text className="friday-graph-label" x={node.x} y={node.y + (node.kind === "agent" ? 57 : anchor ? 34 : 23)} textAnchor="middle">{node.title.length > 24 ? `${node.title.slice(0, 23)}…` : node.title}</text>}
            {node.kind === "agent" && <text className="agentos-map-employee-status" x={node.x} y={node.y + 72} textAnchor="middle">{node.running ? "Working now" : category} · {taskCount} {taskCount === 1 ? "task" : "tasks"}</text>}
          </g>;
        })}
      </svg>
      {!graph.nodes.length && <div className="friday-map-empty"><p>Room for what comes next.</p><span>Projects, people and their work appear here as they are created.</span></div>}
      {selected && <aside className="friday-map-inspector" aria-label="Selected map record"><div className="flex items-center justify-between"><span className="agentos-eyebrow">{selected.kind}</span><Button variant="ghost" size="icon-sm" aria-label="Clear map selection" onClick={() => { setSelectedId(null); setHovered(null); }}><X /></Button></div><h3>{selected.title}</h3>{selected.kind === "agent" && <p>{agentCategory(employees.get(selected.recordId))}</p>}<p>{selected.running ? "Working now" : selected.status?.replaceAll("_", " ") ?? "Recorded in your workspace"}</p><p>{graph.edges.filter(edge => edge.from === selected.id || edge.to === selected.id).length} recorded connections</p><div className="agentos-map-record-actions"><Button variant="outline" size="sm" onClick={() => onSelect(selected)}>Open {selected.taskId ? "task" : selected.kind}<ArrowUpRight /></Button><Button variant="ghost" size="sm" onClick={() => setView({ x: selected.x - bounds.x, y: selected.y - bounds.y, zoom: 2.2 })}>Focus here</Button></div>{selected.kind === "agent" && <ul className="agentos-map-assigned-tasks">{data.tasks.filter(task => task.assigneeAgentId === selected.recordId).slice(0, 6).map(task => <li key={task.id}><button type="button" onClick={() => onSelect(positions.get(`task:${task.id}`)!)}>{task.identifier ?? "Task"} · {task.title}<span>{task.status.replaceAll("_", " ")}</span></button></li>)}</ul>}</aside>}
    </div>
    <div className="agentos-category-legend" aria-label="Employee categories">{agentCategories.map(category => <span key={category} data-category={category}><i />{category}</span>)}</div>
    <footer className="friday-map-footer"><div className="friday-map-legend">{["company", "project", "agent", "task", "artifact"].map(kind => <span key={kind} data-kind={kind}><i />{kind === "artifact" ? "Outputs" : `${kind[0].toUpperCase()}${kind.slice(1)}`}</span>)}</div><span>Dotted spheres are employees · solid points are records · motion follows running work</span></footer>
  </div>;
}
