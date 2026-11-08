import { and, eq, sql } from "drizzle-orm";
import { aiWorkspaceAccounts, aiWorkspaceAccountLinks, toolConnections, type Db } from "@paperclipai/db";
import { unprocessable } from "../errors.js";
import { assertAiCapacityBindingsSettled } from "./ai-execution-capacity.js";

/** Caller holds the enrollment/mutation fence. Removal archives before its
 * retryable cleanup; no reconnect or status edit may revive it mid-cleanup. */
export async function assertAiConnectionNotRemoved(db: Db, companyId: string, connectionId: string) {
  const [connection] = await db.select({ status: toolConnections.status }).from(toolConnections)
    .where(and(eq(toolConnections.companyId, companyId), eq(toolConnections.id, connectionId))).for("update");
  if (!connection || connection.status === "archived") {
    throw unprocessable("This AI connection was removed. Connect a new account instead of restoring the removed connection", {
      code: "ai_connection_removed",
    });
  }
}

/** Caller holds the native credential replacement transaction. The canonical
 * account cannot reconnect over another company's unsaved provider refresh. */
export async function assertWorkspaceAccountCredentialMutationSettled(db: Db, companyId: string, connectionId: string) {
  // Fence the absence of a registry row too: enrollment must not commit
  // between this check and replacement of the formerly company-only token.
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('ai_execution_capacity_configuration'))`);
  const [account] = await db.select().from(aiWorkspaceAccounts)
    .where(and(eq(aiWorkspaceAccounts.sourceCompanyId, companyId), eq(aiWorkspaceAccounts.sourceConnectionId, connectionId))).for("share", { noWait: true });
  if (!account) return;
  const links = await db.select().from(aiWorkspaceAccountLinks).where(eq(aiWorkspaceAccountLinks.accountId, account.id));
  await assertAiCapacityBindingsSettled(db, [{ companyId, connectionId, grantId: account.sourceGrantId }, ...links]);
}

/** Registered provider accounts have one lifecycle owner. Generic company
 * connection controls must not delete its canonical credential or detach a
 * company while native credential cleanup is still pending. */
export async function assertNotWorkspaceAccountConnection(db: Db, companyId: string, connectionId: string, options?: { mutation: true }) {
  // Enrollment and generic mutations must share the same transaction fence:
  // checking before the mutation transaction permits enrollment in the gap.
  if (options?.mutation) await db.execute(sql`select pg_advisory_xact_lock(hashtext('ai_execution_capacity_configuration'))`);
  const [account] = await db.select({ id: aiWorkspaceAccounts.id }).from(aiWorkspaceAccounts)
    .where(and(eq(aiWorkspaceAccounts.sourceCompanyId, companyId), eq(aiWorkspaceAccounts.sourceConnectionId, connectionId))).limit(1);
  const [link] = await db.select({ id: aiWorkspaceAccountLinks.id }).from(aiWorkspaceAccountLinks)
    .where(and(eq(aiWorkspaceAccountLinks.companyId, companyId), eq(aiWorkspaceAccountLinks.connectionId, connectionId))).limit(1);
  if (account || link) throw unprocessable("Manage this connected account and its company access in AgentOS account settings", {
    code: "workspace_ai_account_managed",
  });
}
