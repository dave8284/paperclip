import type { Agent, FridayWork } from "@paperclipai/shared";
import { galaxyPoint } from "./galaxy-layout";

export type FridayGraphNode = { id: string; recordId: string; kind: "company" | "application" | "project" | "agent" | "task" | "comment" | "artifact"; title: string;
  x: number; y: number; taskId?: string; status?: string; running?: boolean };
export type FridayGraphEdge = { id: string; from: string; to: string; kind: "contains" | "lead" | "assignment" | "creation" | "subtask" | "message" | "output" | "handoff"; label: string; active?: boolean; taskId?: string };

/** Every point and relationship comes from an authorized source record. */
export function fridayGraph(data: FridayWork, agents: Agent[], running: ReadonlySet<string>, companies: Array<{ id: string; name: string; projectIds: string[] }> = []) {
  const nodes = new Map<string, FridayGraphNode>();
  const edges: FridayGraphEdge[] = [];
  const add = (node: FridayGraphNode) => nodes.set(node.id, node);
  const connect = (edge: FridayGraphEdge) => edges.push(edge);
  const projectApps = new Map(data.applications.flatMap(app => app.projectIds.map(id => [id, app.id] as const)));
  const projectCompanies = new Map(companies.flatMap(company => company.projectIds.map(id => [id, company.id] as const)));
  for (const company of companies) add({ id: `company:${company.id}`, recordId: company.id, kind: "company", title: company.name, ...galaxyPoint(company.id, 250) });
  for (const app of data.applications) add({ id: `application:${app.id}`, recordId: app.id, kind: "application", title: app.name, ...galaxyPoint(app.id, 320) });
  for (const project of data.projects) {
    const app = nodes.get(`application:${projectApps.get(project.id)}`);
    const company = nodes.get(`company:${projectCompanies.get(project.id)}`);
    const position = company ? galaxyPoint(project.id, 90, company) : data.projects.length === 1 ? { x: 500, y: 300 } : galaxyPoint(project.id, app ? 95 : 230, app);
    add({ id: `project:${project.id}`, recordId: project.id, kind: "project", title: project.name, status: project.status, ...position });
    if (app) connect({ id: `contains:${app.id}:${project.id}`, from: app.id, to: `project:${project.id}`, kind: "contains", label: "Application initiative" });
    if (company) connect({ id: `company-project:${project.id}`, from: company.id, to: `project:${project.id}`, kind: "contains", label: "Company project" });
    if (project.leadAgentId) connect({ id: `lead:${project.id}`, from: `agent:${project.leadAgentId}`, to: `project:${project.id}`, kind: "lead", label: "Project lead" });
  }
  const involvedAgents = new Set([...data.assignments.map(row => row.agentId), ...data.projects.flatMap(project => project.leadAgentId ? [project.leadAgentId] : []),
    ...data.tasks.flatMap(task => [task.assigneeAgentId, task.createdByAgentId].filter((id): id is string => !!id)),
    ...data.evidence.flatMap(row => row.agentId ? [row.agentId] : []), ...data.handoffs.flatMap(row => [row.fromAgentId, row.toAgentId].filter((id): id is string => !!id))]);
  for (const id of involvedAgents) add({ id: `agent:${id}`, recordId: id, kind: "agent", title: agents.find(agent => agent.id === id)?.name ?? "Agent", running: data.tasks.some(task => task.assigneeAgentId === id && running.has(task.id)), ...galaxyPoint(`agent:${id}`, 430) });
  for (const task of data.tasks) {
    const parent = task.projectId ? nodes.get(`project:${task.projectId}`) : undefined;
    const position = galaxyPoint(task.id, parent ? data.projects.length === 1 ? 155 : 75 : 180, parent);
    add({ id: `task:${task.id}`, recordId: task.id, kind: "task", title: `${task.identifier ?? "Task"} · ${task.title}`, status: task.status, running: running.has(task.id), ...position });
    if (parent) connect({ id: `contains:${task.id}`, from: parent.id, to: `task:${task.id}`, kind: "contains", label: "Project task", taskId: task.id });
    if (task.assigneeAgentId) connect({ id: `assignment:${task.id}`, from: `agent:${task.assigneeAgentId}`, to: `task:${task.id}`, kind: "assignment", label: "Current assignment", active: running.has(task.id), taskId: task.id });
    if (task.createdByAgentId) connect({ id: `creation:${task.id}`, from: `agent:${task.createdByAgentId}`, to: `task:${task.id}`, kind: "creation", label: "Created this task", taskId: task.id });
    if (task.parentId) connect({ id: `subtask:${task.id}`, from: `task:${task.parentId}`, to: `task:${task.id}`, kind: "subtask", label: "Subtask", taskId: task.id });
  }
  for (const item of data.evidence) {
    const task = nodes.get(`task:${item.taskId}`); if (!task) continue;
    const id = `${item.kind}:${item.id}`;
    add({ id, recordId: item.id, taskId: item.taskId, kind: item.kind, title: item.title, ...galaxyPoint(id, 25, task) });
    connect({ id: `evidence:${id}`, from: id, to: task.id, kind: item.kind === "comment" ? "message" : "output", label: item.kind === "comment" ? "Message on task" : "Recorded output", taskId: item.taskId });
    if (item.agentId) connect({ id: `author:${id}`, from: `agent:${item.agentId}`, to: id, kind: "message", label: "Message author", taskId: item.taskId });
  }
  for (const handoff of data.handoffs) if (handoff.fromAgentId && handoff.toAgentId) {
    connect({ id: `handoff:${handoff.id}`, from: `agent:${handoff.fromAgentId}`, to: `agent:${handoff.toAgentId}`, kind: "handoff", label: `${handoff.phase} · ${handoff.state}`, taskId: handoff.taskId,
      active: handoff.state === "pending_dispatch" || handoff.state === "awaiting_release" });
  }
  return { nodes: [...nodes.values()], edges: edges.filter(edge => nodes.has(edge.from) && nodes.has(edge.to)) };
}
