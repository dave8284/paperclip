// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RoutineWorkflow } from "./RoutineWorkflow";
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
vi.mock("./ApplicationTaskInspector", () => ({ ApplicationTaskInspector: ({ task }: { task: { title: string } }) => <p>Task detail: {task.title}</p> }));
vi.mock("./MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: React.ReactNode }) => <p>{children}</p> }));
vi.mock("./task-side-panel/TaskAttachmentPanel", () => ({ TaskAttachmentPanel: ({ issueId, attachmentId }: { issueId: string; attachmentId: string }) => <p>Stored output {issueId}/{attachmentId}</p> }));
it("opens the actual cycle task, output and editable trigger with active work edges", async () => {
  const host = document.createElement("div"), root = createRoot(host), edit = vi.fn(); document.body.append(host);
  const click = async (label: string) => { const element = [...host.querySelectorAll('[role="button"], button')].find(node => node.getAttribute("aria-label")?.startsWith(label) || node.textContent === label)!; expect(element).toBeTruthy(); await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true }))); };
  try {
    await act(async () => root.render(<RoutineWorkflow
      routine={{ id: "routine", title: "Campaign loop", status: "active", assigneeAgentId: "configured", triggers: [{ id: "schedule", kind: "schedule", label: "Daily review", enabled: true, cronExpression: "0 9 * * *" }] } as never}
      cycle={{ id: "run", triggerId: "schedule" } as never}
      task={{ id: "cycle-task", title: "Review results", status: "in_progress", assigneeAgentId: "actual" } as never}
      tasks={[{ id: "child", title: "Make the next video", status: "done", assigneeAgentId: "actual" } as never]}
      outputs={[{ id: "asset", issueId: "child", title: "Video v2", status: "active", reviewState: "approved", metadata: { attachmentId: "attachment" } } as never]}
      agents={[{ id: "actual", name: "Marketing lead", role: "cmo" } as never]} onEdit={edit}
    />));
    expect(host.querySelector('[aria-label^="agent: Marketing lead"]')).toBeTruthy();
    expect(host.querySelectorAll('path[data-active="true"]').length).toBeGreaterThan(0);
    await click("task: Make the next video");
    expect(host.querySelector('a[href="/issues/child"]')?.textContent).toBe("Open task and triage");
    await click("output: Video v2");
    expect(host.textContent).toContain("Stored output child/attachment");
    await click("trigger: Daily review"); await click("Edit trigger");
    expect(edit).toHaveBeenCalledWith("schedule");
    await click("Zoom in workflow"); expect(host.textContent).toContain("125%");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
