import { describe, expect, it } from "vitest";
import type { Agent, FridayWork } from "@paperclipai/shared";
import { fridayGraph, fridayGraphAgents } from "./friday-graph";

const data = { projects: [{ id: "project", name: "Launch", status: "in_progress", leadAgentId: "lead" }], applications: [], tasks: [{ id: "task", projectId: "project", title: "Build the launch", status: "todo", assigneeAgentId: "worker" }], assignments: [], evidence: [], handoffs: [{ id: "handoff", fromAgentId: "lead", toAgentId: "worker", taskId: "task", phase: "execution", state: "pending_dispatch" }] } as unknown as FridayWork;
const agents = [{ id: "lead", name: "Lead" }, { id: "worker", name: "Worker" }, { id: "available", name: "Available employee" }] as Agent[];

describe("Friday graph records", () => {
  it("limits focused maps to employees connected to the work, retaining the full overview roster", () => {
    expect(fridayGraphAgents(data, agents, true).map(agent => agent.id)).toEqual(["lead", "worker"]);
    expect(fridayGraphAgents(data, agents, false).map(agent => agent.id)).toEqual(["lead", "worker", "available"]);
    const focused = fridayGraph(data, fridayGraphAgents(data, agents, true), new Set());
    expect(focused.nodes.filter(node => node.kind === "agent").map(node => node.recordId).sort()).toEqual(["lead", "worker"]);
  });
  it("shows authorized idle employees and animates only observed runs or pending handoffs", () => {
    const graph = fridayGraph(data, agents, new Set());
    expect(graph.nodes.filter(node => node.kind === "agent")).toHaveLength(3);
    expect(graph.nodes.some(node => node.running)).toBe(false);
    expect(graph.edges.filter(edge => edge.active).map(edge => edge.id)).toEqual(["handoff:handoff"]);
    expect(graph.nodes.find(node => node.id === "task:task")?.taskId).toBe("task");
  });
  it("spaces employee glyphs apart and retains identity positions when work starts", () => {
    const first = fridayGraph(data, agents, new Set());
    const active = fridayGraph(data, agents, new Set(["task"]));
    expect(first.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(active.nodes.map(({ id, x, y }) => ({ id, x, y })));
    const employees = first.nodes.filter(node => node.kind === "agent");
    for (let i = 0; i < employees.length; i++) for (let j = i + 1; j < employees.length; j++) expect(Math.hypot(employees[i].x - employees[j].x, employees[i].y - employees[j].y)).toBeGreaterThan(140);
    expect(active.nodes.find(node => node.id === "agent:worker")?.running).toBe(true);
  });
});
