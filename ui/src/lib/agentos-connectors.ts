/** The initial AgentOS catalog. This controls discovery, never stored access. */
export const AGENTOS_CONNECTORS = [
  { slug: "openai", name: "OpenAI", description: "Connect an OpenAI subscription for Codex work. Access follows the account and employee permissions." },
  { slug: "anthropic", name: "Anthropic", description: "Connect a Claude subscription for Claude work. Access follows the account and employee permissions." },
  { slug: "stripe", name: "Stripe" },
  { slug: "higgsfield", name: "Higgsfield" },
  { slug: "supabase", name: "Supabase" },
  { slug: "vercel", name: "Vercel" },
  { slug: "google-workspace", name: "Google" },
  { slug: "calendly", name: "Calendly" },
] as const;

export function agentosConnectorCatalog<T extends { slug: string; name: string }>(apps: T[]): T[] {
  return AGENTOS_CONNECTORS.flatMap(connector => {
    const app = apps.find(item => item.slug === connector.slug);
    return app ? [{ ...app, name: connector.name, ...("description" in connector ? { description: connector.description } : {}) }] : [];
  });
}

export function isInitialAgentOSConnector(slug: string) {
  return AGENTOS_CONNECTORS.some(connector => connector.slug === slug)
    || slug === "google" || slug.startsWith("google-");
}
