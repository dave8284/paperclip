import { useRef, useState } from "react";
import type { ApplicationWork } from "@paperclipai/shared";
import { Minus, Plus, Maximize } from "lucide-react";
import { Button } from "./ui/button";

export function ApplicationWorkMap({ projects, tasks, selectedTaskId, runningTaskIds, onSelectTask, onSelectProject }: {
  projects: ApplicationWork["projects"];
  tasks: ApplicationWork["tasks"];
  selectedTaskId: string | null;
  runningTaskIds: ReadonlySet<string>;
  onSelectTask: (id: string) => void;
  onSelectProject: (id: string) => void;
}) {
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const width = 1000 / view.zoom;
  const height = 540 / view.zoom;
  const layout = projects.map((project, index) => {
    const angle = index / Math.max(projects.length, 1) * Math.PI * 2 - Math.PI / 2;
    return { project, x: projects.length === 1 ? 500 : 500 + Math.cos(angle) * 300,
      y: projects.length === 1 ? 270 : 270 + Math.sin(angle) * 155,
      tasks: tasks.filter(task => task.projectId === project.id) };
  });
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">Each dot is a saved task. Select it to inspect the work. Drag the background to pan.</p>
      <div className="flex gap-1">
        <Button variant="outline" size="icon" aria-label="Zoom out" onClick={() => setView(v => ({ ...v, zoom: Math.max(0.5, v.zoom / 1.25) }))}><Minus /></Button>
        <Button variant="outline" size="icon" aria-label="Zoom in" onClick={() => setView(v => ({ ...v, zoom: Math.min(4, v.zoom * 1.25) }))}><Plus /></Button>
        <Button variant="outline" size="icon" aria-label="Fit work map" onClick={() => setView({ x: 0, y: 0, zoom: 1 })}><Maximize /></Button>
      </div>
    </div>
    <svg className="agentos-work-map rounded-xl border bg-card" viewBox={`${500 - width / 2 + view.x} ${270 - height / 2 + view.y} ${width} ${height}`}
      aria-label="Application work map" role="group"
      onPointerDown={event => {
        if ((event.target as Element).closest("a")) return;
        drag.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!drag.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const dx = (event.clientX - drag.current.x) * width / rect.width;
        const dy = (event.clientY - drag.current.y) * height / rect.height;
        drag.current = { x: event.clientX, y: event.clientY };
        setView(v => ({ ...v, x: v.x - dx, y: v.y - dy }));
      }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {layout.map(({ project, x, y, tasks: projectTasks }) => <g key={project.id}>
        {projectTasks.map((task, index) => {
          const angle = index * 2.399963;
          const radius = 36 + Math.sqrt(index) * 11;
          const tx = x + Math.cos(angle) * radius;
          const ty = y + Math.sin(angle) * radius;
          return <g key={task.id}>
            <line x1={x} y1={y} x2={tx} y2={ty} className="agentos-map-edge" />
            <a href={`#task-${task.id}`} aria-label={`${task.title}: ${task.status.replaceAll("_", " ")}`} onClick={event => { event.preventDefault(); onSelectTask(task.id); }}>
              <circle cx={tx} cy={ty} className="agentos-map-task" data-status={task.status} data-selected={task.id === selectedTaskId} data-running={runningTaskIds.has(task.id)} />
              <title>{task.identifier}: {task.title} · {task.status.replaceAll("_", " ")}</title>
            </a>
          </g>;
        })}
        <a href={`#project-${project.id}`} aria-label={`Focus project ${project.name}`} onClick={event => { event.preventDefault(); onSelectProject(project.id); }}>
          <circle cx={x} cy={y} className="agentos-map-project" />
          <text x={x} y={y + 24} className="agentos-map-label" textAnchor="middle">{project.name}</text>
        </a>
      </g>)}
    </svg>
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground"><span>Filled: in progress</span><span>Green: completed</span><span>Red: blocked</span><span>Outlined: queued or in review</span><span>Pulse: observed running execution</span></div>
  </div>;
}
