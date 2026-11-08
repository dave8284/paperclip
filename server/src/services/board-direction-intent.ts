import { createHash } from "node:crypto";
import type { agentosBoardDirections, issues } from "@paperclipai/db";
import { createBoardDirectionSchema, type CreateBoardDirection } from "@paperclipai/shared";

export function boardDirectionFingerprint(input: CreateBoardDirection) {
  return createHash("sha256").update(JSON.stringify(createBoardDirectionSchema.parse(input))).digest("hex");
}
export function boardDirectionMatchesTask(row: typeof agentosBoardDirections.$inferSelect,
  task: Pick<typeof issues.$inferSelect, "id" | "companyId" | "projectId" | "title" | "description" | "priority" | "responsibleUserId" | "assigneeAgentId" | "assigneeUserId">) {
  if (task.id !== row.issueId || task.companyId !== row.targetCompanyId || task.assigneeAgentId !== row.executiveAgentId
    || task.assigneeUserId || task.responsibleUserId !== row.ownerUserId) return false;
  const intent = createBoardDirectionSchema.safeParse({ mandateId: row.mandateId, revision: row.mandateRevision, grantId: row.grantId,
    targetCompanyId: row.targetCompanyId, executiveAgentId: row.executiveAgentId, idempotencyKey: row.idempotencyKey,
    projectId: task.projectId, title: task.title, description: task.description, priority: task.priority });
  return intent.success && boardDirectionFingerprint(intent.data) === row.inputFingerprint;
}
