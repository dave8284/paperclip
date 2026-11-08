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

On 7 November the owner selected planning a full database migration. The
[migration plan](../../doc/plans/2026-11-07-agentos-supabase-full-migration.md)
covers native PostgreSQL, Model Intelligence SQLite, files/keys, access gates,
rehearsal, cutover and rollback. No data has moved. Generic agent SQL access must
be restricted before this project holds private application data.

`migration-preflight.sql` is a read-only destination metadata inventory for the
linked AgentOS project. It reads versions, schemas, extensions, estimated table
sizes and access grants; it reads no user rows or credentials and performs no
migration. Keep its output private. Data API settings, native connector policy,
source inventory and restore acceptance remain separate checks.

Run `bash scripts/agentos-supabase-preflight.sh` from the `paperclip/` repository or
use the script's absolute path. An optional first argument selects the private
report path. The default is `/private/tmp/agentos-supabase-preflight-20261108.json`.
The helper verifies the linked project, validates the returned report, preserves
the CLI's untrusted-data envelope, and publishes a complete mode-0600 file without
overwriting an existing report. Driver diagnostics and partial results are never
published. Its seven controlled CLI tests exercise failures and file handling;
they do not prove destination connectivity or SQL execution.

On 8 November the owner's terminal returned login-role status 544 with a
connection timeout before this query ran. CLI 2.90.0 initializes database
credentials before dispatching even a linked Management API query; the generic
`SUPABASE_DB_PASSWORD` suggestion is not evidence of an incorrect password.
Confirm the project's current health before retrying. No password, token, project
restart or credential reset is required by this helper.
