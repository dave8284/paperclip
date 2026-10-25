import { describe, expect, it } from "vitest";
import type { Agent, FridayWork } from "@paperclipai/shared";
import { fridayGraph } from "./friday-graph";
import { fridayConversationView, fridayNavigationSearch, parseFridayView, readFridayNavigation } from "./friday-navigation";

const projectId = "00000000-0000-4000-8000-000000000001";
const agentId = "00000000-0000-4000-8000-000000000002";
describe("Friday contextual views", () => {
  it("opens the portfolio workforce alongside the current conversation", () => {
    const view = fridayConversationView({ panel: "workforce" }, agentId);
    expect(readFridayNavigation(fridayNavigationSearch(view))).toEqual({ panel: "workforce", speakerId: agentId });
    expect(parseFridayView('{"version":1,"panel":"workforce"}')).toEqual({ version: 1, panel: "workforce" });
  });
  it("round trips scoped links and preserves a specialist conversation when opening its output", () => {
    const view = fridayConversationView({ panel: "work", projectId, mode: "combined" }, agentId);
    expect(readFridayNavigation(fridayNavigationSearch(view))).toEqual({ ...view, speakerId: agentId });
    expect(readFridayNavigation(fridayNavigationSearch(fridayConversationView({ panel: "canvas" }, agentId)))).toEqual({ panel: "canvas", speakerId: agentId });
    expect(fridayConversationView({ panel: null }, agentId)).toEqual({ panel: null });
    expect(fridayConversationView({ panel: "chat", agentId: projectId }, agentId)).toEqual({ panel: "chat", agentId: projectId });
  });
  it("accepts only typed view requests, never executable actions or arbitrary destinations", () => {
    expect(parseFridayView(JSON.stringify({ version: 1, panel: "work", projectId, mode: "combined" }))).toMatchObject({ projectId });
    for (const body of ["<script>alert(1)</script>", '{"version":1,"panel":"deploy"}', '{"version":1,"panel":"work","projectId":"all"}', '{"version":1,"panel":"work","url":"https://untrusted.invalid"}']) expect(parseFridayView(body)).toBeNull();
    expect(readFridayNavigation("panel=work&projectId=invalid")).toEqual({ panel: null });
    expect(readFridayNavigation("panel=canvas&speakerId=invalid")).toEqual({ panel: "canvas" });
  });
});

describe("Friday record graph", () => {
  const data: FridayWork = { observedAt: "2026-10-25T00:00:00Z", projects: [{ id: "p", name: "Project", status: "in_progress", leadAgentId: "lead" }], projectCount: 1, nextProjectOffset: null, applications: [],
    tasks: [{ id: "task", title: "Build", identifier: "AGE-1", status: "in_progress", priority: "medium", projectId: "p", assigneeAgentId: "worker", assigneeUserId: null, parentId: null, createdByAgentId: "lead", updatedAt: new Date() }], counts: { in_progress: 1 }, nextOffset: null,
    assignments: [{ agentId: "worker", projectId: "p", status: "in_progress", count: 1 }], assignmentsTruncated: false,
    evidence: [{ id: "message", taskId: "task", kind: "comment", title: "Message", agentId: "lead", createdAt: new Date() }, { id: "output", taskId: "task", kind: "artifact", title: "Release", agentId: null, createdAt: new Date() }], evidenceTruncated: false,
    handoffs: [], handoffsTruncated: false };
  const agents = [{ id: "lead", name: "Friday" }, { id: "worker", name: "Engineer" }, { id: "unused", name: "Unused" }] as Agent[];
  it("builds only record-backed nodes and distinguishes assignment from actual coordination", () => {
    const graph = fridayGraph(data, agents, new Set());
    expect(graph.nodes.map(node => node.id).sort()).toEqual(["project:p", "agent:lead", "agent:worker", "task:task", "comment:message", "artifact:output"].sort());
    expect(graph.edges.filter(edge => edge.kind === "handoff")).toEqual([]);
    expect(graph.edges.find(edge => edge.kind === "assignment")?.active).toBe(false);
    expect(graph.edges.find(edge => edge.kind === "lead")).toMatchObject({ from: "agent:lead", to: "project:p" });
    expect(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.from) && graph.nodes.some(node => node.id === edge.to))).toBe(true);
    expect(fridayGraph(data, agents, new Set())).toEqual(graph);
  });
  it("animates observed running work and pending native handoffs, then stops when they complete", () => {
    const handoff = { id: "handoff", taskId: "task", fromAgentId: "lead", toAgentId: "worker", phase: "review", state: "pending_dispatch", createdAt: new Date() };
    const active = fridayGraph({ ...data, handoffs: [handoff] }, agents, new Set(["task"]));
    expect(active.nodes.find(node => node.id === "task:task")?.running).toBe(true);
    expect(active.edges.filter(edge => edge.active).map(edge => edge.kind).sort()).toEqual(["assignment", "handoff"]);
    const finished = fridayGraph({ ...data, tasks: data.tasks.map(task => ({ ...task, status: "done" })), handoffs: [{ ...handoff, state: "delivered" }] }, agents, new Set());
    expect(finished.edges.some(edge => edge.active)).toBe(false);
    expect(finished.nodes.find(node => node.id === "task:task")?.status).toBe("done");
  });
});
