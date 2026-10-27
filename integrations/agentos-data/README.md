# Agent OS data connection

This Supabase CLI work directory is separate from the local Agent OS database.
Its generated `supabase/config.toml` describes optional local Supabase services;
it is not evidence that remote Auth or other project settings were deployed.

The operator created a dedicated **AgentOS** project in Sydney on the existing
organization's Free plan. Its project reference is `rxcykzhtkspsonntirhi`.
The machine's CLI is linked with:

```sh
supabase projects list --workdir integrations/agentos-data
supabase link --project-ref rxcykzhtkspsonntirhi --workdir integrations/agentos-data
```

Sign in with the intended account first. CLI credentials stay in the operating
system keychain; link state under `supabase/.temp/` is ignored. Database
credentials are stored privately outside this checkout and must not be copied
into source control, task text or browser code.

In Agent OS, Settings → Connectors contains **AgentOS data and services** using
the existing Supabase personal-token MCP connector. Its endpoint is pinned to
this project, and explicitly enables database, documentation, diagnostics,
development, functions and storage tools. Native encrypted secrets, company
grants and per-action policies govern every agent invocation. The connection
is installed for the owning company's employees. Reads are allowed; SQL,
migrations, deployment and storage-configuration changes require review.

Setup verification: provider authentication and discovery returned 17 tools;
a native governed storage-bucket read as Friday returned an empty list. No
existing application records were copied, no remote schema/data was seeded,
and no automatic replication is enabled. Agent OS itself still runs locally.
New data ingestion should be a scoped native task/routine with source records,
company/project ownership, retention and versioned output rules.
