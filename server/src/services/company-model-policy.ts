import { and, eq } from "drizzle-orm";
import { agents, companyOperatingProfiles, type Db } from "@paperclipai/db";
import { aiConnectionConfigurationFailure } from "./ai-connection-configuration-failure.js";
import { isAiConnectionCompatible, type AiConnectionBinding } from "@paperclipai/shared";
import { defaultAiConnectionForHire } from "./agent-ai-connection-default.js";

/** Profile-managed agents without an explicit account inherit Friday's compatible
 * managed choice, or use the responsible user's native default. Selection still enforces membership, grants,
 * installations, credential health and the subscription-only policy. */
export async function defaultCompanyModelBinding(db: Db, companyId: string, adapterType: string, config: Record<string, unknown>): Promise<AiConnectionBinding | undefined> {
  const [profile] = await db.select({ runtime: agents.runtimeConfig })
    .from(companyOperatingProfiles)
    .leftJoin(agents, and(eq(agents.id, companyOperatingProfiles.fridayAgentId), eq(agents.companyId, companyOperatingProfiles.companyId)))
    .where(eq(companyOperatingProfiles.companyId, companyId)).limit(1);
  if (!profile) return undefined;
  const inherited = defaultAiConnectionForHire(adapterType, config, profile.runtime?.aiConnection);
  // Pool selection owns task pinning earlier in admission. Never select a pool
  // here or reuse another person's explicitly delegated credential.
  if (inherited && inherited.mode !== "router") return inherited;
  if (inherited?.mode === "router") throw aiConnectionConfigurationFailure("ai_connection_incompatible", "Assign Friday’s account pool in this agent’s Runtime settings before running it.");
  const candidates = (["openai", "anthropic"] as const).map(provider => ({ provider, method: "subscription", mode: "responsible_user" } as const))
    .filter(binding => isAiConnectionCompatible(binding, adapterType, config.model, config.provider, config.acpxAgent));
  if (candidates.length === 1) return candidates[0];
  throw aiConnectionConfigurationFailure("ai_connection_incompatible", "Select a managed subscription connection compatible with this agent in its Runtime settings.");
}

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
    ? "This agent needs a managed subscription connection assigned in its Runtime settings. Connecting an account alone does not assign it to the agent."
    : "This organization uses subscription seats only. The selected credential uses API billing; choose a subscription connection. Paid fallback is disabled.");
}
