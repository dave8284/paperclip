import { useEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { Agent, FridayWork } from "@paperclipai/shared";
import { fridayGraph, type FridayGraphNode } from "../lib/friday-graph";
import { Button } from "./ui/button";

export function FridayWorkGraph({ data, agents, running, onSelect }: { data: FridayWork; agents: Agent[]; running: ReadonlySet<string>; onSelect: (node: FridayGraphNode) => void }) {
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [evidence, setEvidence] = useState(true);
  const [quiet, setQuiet] = useState(document.hidden);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { const update = () => setQuiet(document.hidden); document.addEventListener("visibilitychange", update); return () => document.removeEventListener("visibilitychange", update); }, []);
  const graph = fridayGraph(evidence ? data : { ...data, evidence: [] }, agents, running);
  const positions = new Map(graph.nodes.map(node => [node.id, node]));
  const width = 1100 / view.zoom, height = 700 / view.zoom;
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={evidence} onChange={event => setEvidence(event.target.checked)} />Messages and outputs</label><div className="flex gap-1">
      <Button size="icon-sm" variant="outline" aria-label="Zoom out" onClick={() => setView(value => ({ ...value, zoom: Math.max(0.5, value.zoom / 1.3) }))}><Minus /></Button>
      <Button size="icon-sm" variant="outline" aria-label="Zoom in" onClick={() => setView(value => ({ ...value, zoom: Math.min(8, value.zoom * 1.3) }))}><Plus /></Button>
      <Button size="icon-sm" variant="outline" aria-label="Fit work graph" onClick={() => setView({ x: 0, y: 0, zoom: 1 })}><Maximize /></Button>
    </div></div>
    <svg className="friday-work-graph" data-quiet={quiet} role="group" aria-label="Project and agent work graph" viewBox={`${500 - width / 2 + view.x} ${300 - height / 2 + view.y} ${width} ${height}`}
      onPointerDown={event => { if ((event.target as Element).closest('[role="button"]')) return; drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (!drag.current) return; const rect = event.currentTarget.getBoundingClientRect(); if (!rect.width || !rect.height) return; const dx = (event.clientX - drag.current.x) * width / rect.width, dy = (event.clientY - drag.current.y) * height / rect.height; drag.current = { x: event.clientX, y: event.clientY }; setView(value => ({ ...value, x: value.x - dx, y: value.y - dy })); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onWheel={event => { if (!event.ctrlKey) return; event.preventDefault(); setView(value => ({ ...value, zoom: Math.max(0.5, Math.min(8, value.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15))) })); }}>
      {graph.edges.map(edge => { const from = positions.get(edge.from)!, to = positions.get(edge.to)!; return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="friday-graph-edge" data-kind={edge.kind} data-active={edge.active} role={edge.kind === "handoff" ? "button" : undefined} tabIndex={edge.kind === "handoff" ? 0 : undefined}
        onClick={() => { if (edge.taskId) { const task = positions.get(`task:${edge.taskId}`); if (task) onSelect(task); } }} onKeyDown={event => { if (event.key === "Enter" && edge.taskId) { const task = positions.get(`task:${edge.taskId}`); if (task) onSelect(task); } }}><title>{edge.label}</title></line>; })}
      {graph.nodes.map(node => <g key={node.id} role="button" tabIndex={0} aria-label={`${node.kind}: ${node.title}${node.status ? ` · ${node.status}` : ""}`} className="friday-graph-node" data-kind={node.kind} data-status={node.status} data-running={node.running}
        onClick={() => onSelect(node)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node); } }}>
        <circle cx={node.x} cy={node.y} /><title>{node.title}{node.status ? ` · ${node.status}` : ""}</title>
        {["application", "project", "agent"].includes(node.kind) && <text x={node.x} y={node.y + 23} textAnchor="middle">{node.title}</text>}
      </g>)}
    </svg>
    <p className="text-xs text-muted-foreground">{graph.nodes.length} real records · circles: applications, projects, agents and work · small dots: messages and outputs. Solid links show membership and project leads; dashed links show assignments; purple links are recorded handoffs. Motion requires observed running work or a pending handoff.</p>
  </div>;
}
