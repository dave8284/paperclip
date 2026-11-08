import { and, eq, or, sql } from "drizzle-orm";
import { environmentLeases, type Db } from "@paperclipai/db";

/** The lease owns provider write-back even after its heartbeat is terminal or
 * deleted. A capacity receipt alone cannot prove that refresh material saved. */
export async function hasPendingAiCredentialHandoff(db: Db, bindings: readonly {
  companyId: string; grantId: string;
}[]): Promise<boolean> {
  if (!bindings.length) return false;
  const [pending] = await db.select({ id: environmentLeases.id }).from(environmentLeases).where(and(
    or(...bindings.map(binding => and(eq(environmentLeases.companyId, binding.companyId),
      sql`${environmentLeases.metadata} #>> '{runnerTaskCredentialHandoff,binding,grantId}' = ${binding.grantId}`))),
    sql`${environmentLeases.metadata} #>> '{runnerTaskCredentialHandoff,state}' = 'pending'`,
  )).limit(1);
  return Boolean(pending);
}
