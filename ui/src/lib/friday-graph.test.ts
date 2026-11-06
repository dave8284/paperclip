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
  it("keeps configured access separate from recorded actions and does not infer reads or writes from tool names", () => {
    const recorded = { ...data, dataAccess: { configuredAccess: "available" as const, observedAccess: "available" as const,
      resources: [{ id: "catalog:records", companyId: "company", name: "Records tool", kind: "catalog" as const }],
      permissions: [{ agentId: "worker", resourceId: "catalog:records" }],
      actions: [
        { id: "read", taskId: "task", agentId: "worker", resourceId: "catalog:records", toolName: "fetch_records", operation: "read" as const, status: "succeeded", completedAt: "2026-11-06T00:00:00Z", observedAt: "2026-11-06T00:00:00Z" },
        { id: "unknown", taskId: "task", agentId: "worker", resourceId: null, toolName: "write_something", operation: "unknown" as const, status: "authorized", completedAt: null, observedAt: "2026-11-06T00:00:00Z" },
        { id: "outside-page", taskId: "private-task", agentId: "worker", resourceId: null, toolName: "unavailable", operation: "write" as const, status: "succeeded", completedAt: "2026-11-06T00:00:00Z", observedAt: "2026-11-06T00:00:00Z" },
      ], permissionsTruncated: false, actionsTruncated: false } };
    const graph = fridayGraph(recorded, agents, new Set());
    expect(graph.nodes.filter(node => node.kind === "resource")).toHaveLength(1);
    expect(graph.nodes.filter(node => node.kind === "action")).toHaveLength(2);
    expect(graph.nodes.find(node => node.id === "action:read")).toMatchObject({ taskId: "task", title: "Read tool · succeeded · fetch_records", status: "succeeded" });
    expect(graph.nodes.find(node => node.id === "action:unknown")).toMatchObject({ title: "Tool action · authorized · write_something", status: "authorized" });
    expect(graph.nodes.some(node => node.running)).toBe(false);
    expect(graph.edges.find(edge => edge.kind === "configured-access")).toMatchObject({ active: false, label: expect.stringContaining("execution still requires") });
    expect(graph.edges.filter(edge => edge.kind === "observed-action").every(edge => !edge.active)).toBe(true);
    expect(graph.nodes.find(node => node.id === "resource:catalog:records")?.details).toContain("Specific datasets and files are not identified by these records.");
    const configuredOnly = fridayGraph({ ...recorded, dataAccess: { ...recorded.dataAccess, actions: [] } }, agents, new Set());
    expect(configuredOnly.nodes.some(node => node.kind === "action")).toBe(false);
    expect(configuredOnly.edges.some(edge => edge.kind === "observed-action")).toBe(false);
  });
});
