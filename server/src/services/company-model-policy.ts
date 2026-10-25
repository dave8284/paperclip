import { eq } from "drizzle-orm";
import { companyOperatingProfiles, type Db } from "@paperclipai/db";
import { aiConnectionConfigurationFailure } from "./ai-connection-configuration-failure.js";

/** AgentOS operating profiles use subscription seats. Check the resolved
 * credential method, never the agent's legacy method hint. Other Paperclip
 * companies retain their existing connection policy. This runs at admission or
 * credential use, with no background polling or extra work for subscriptions. */
export async function assertCompanyModelPolicy(db: Db, companyId: string, method: string | null) {
  if (method === "subscription") return;
  const [profile] = await db.select({ companyId: companyOperatingProfiles.companyId })
    .from(companyOperatingProfiles).where(eq(companyOperatingProfiles.companyId, companyId)).limit(1);
  if (!profile) return;
  throw aiConnectionConfigurationFailure("ai_connection_incompatible", method === null
    ? "This organization requires a managed subscription connection. Connect your subscription before running Friday or its agents."
    : "This organization uses subscription seats only. The selected credential uses API billing; choose a subscription connection. Paid fallback is disabled.");
}
