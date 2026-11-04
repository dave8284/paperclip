/** The initial AgentOS catalog. This controls discovery, never stored access. */
export const AGENTOS_CONNECTORS = [
  { slug: "openai", name: "OpenAI" },
  { slug: "anthropic", name: "Anthropic" },
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
    return app ? [{ ...app, name: connector.name }] : [];
  });
}

export function isInitialAgentOSConnector(slug: string) {
  return AGENTOS_CONNECTORS.some(connector => connector.slug === slug)
    || slug === "google" || slug.startsWith("google-");
}
