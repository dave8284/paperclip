# AgentOS full database migration to Supabase

Date: 7 November 2026. **C05 — Not fixed** in the
[existing worksheet](2026-11-03-agentos-requirements-reconciliation.md).
The owner selected **“Plan a full database migration.”** This plan does not
authorize production data movement or cutover. Cloud/public hosting stays deferred.

## Destination and completion boundary

Use the dedicated **AgentOS** Supabase project in Sydney, reference
`rxcykzhtkspsonntirhi`, linked by `integrations/agentos-data`. Read-only
`supabase projects list --workdir integrations/agentos-data` confirmed the project
and link on 7 November. Other projects are outside scope. Local
`supabase/config.toml` is not evidence of remote settings.

The proposed end state stores application records and Model Intelligence evidence
in this project's PostgreSQL database. AgentOS retains authentication, company
permissions, private-resource checks, execution, audit and recovery. Existing
Google/Better Auth accounts and sessions remain. Supabase Auth and direct browser
database access are not needed.

Completion requires both database stores migrated, attached files readable,
backups restored successfully and native privacy/recovery acceptance passed.
PostgreSQL alone is an intermediate milestone. Remote storage does not make
local agents, speech services or workers run while the Mac is off.

## Inventory

| Source | Destination / handling | Verification |
| --- | --- | --- |
| Application PostgreSQL | Existing application schemas; retain names, UUIDs, relations and encrypted values | Exact row counts/content digests; tables, views, functions, triggers, constraints, indexes, sequences and grants |
| Drizzle history | Actual `__drizzle_migrations` table in its detected schema | Preserve hashes/timestamps; no manual journal changes or regenerated historical SQL |
| Better Auth `user`, `account`, `session`, `verification` | Same application tables, separate from Supabase-managed `auth` | Owner login/admin rights, sign-out/in, company isolation |
| Model Intelligence SQLite | Private `agentos_model_intelligence` schema via a new independent-package PostgreSQL implementation | All receipts, evaluations, policy events, datasets, comparisons, versioned routing policies/releases, canary assignments/outcomes/deadlines and audit events; namespace and replay parity |
| Credentials/runtime identities | Retain ciphertext and securely preserve the same master key/configuration | Native credential resolution; no secrets in logs or checkout |
| Attachments, artifacts, run logs, workspaces outside DB | Consistent backup/manifest; retain current paths/provider during DB cutover | Checksums and app-level reads; missing referenced objects block acceptance |
| Supabase managed schemas | Preserve `auth`, `storage`, platform and extension ownership | Collision review; no broad clean/drop restore |

The 7 November source inventory contained 320 Drizzle tables and migration head
0393; 0394 was subsequently generated and remains unapplied. These are checkout
observations, not a live database count or proof of activation.
Inventory the actual source/target at execution time. The native client detects
the journal schema; do not assume `drizzle` or `public`. Source migrations require
`pg_trgm` and `fuzzystrmatch`; compare installed versions and all other actual
extensions before rehearsal.

## Required implementation

1. Add PostgreSQL storage inside `packages/model-intelligence`, retaining its
   independence and SQLite support. Its synchronous `DatabaseSync` implementation
   cannot take a PostgreSQL URL. Introduce an explicit async PostgreSQL factory/
   contract and await it in host/HTTP consumers; do not block the server to
   simulate synchronous remote queries.
2. Preserve transaction, conflict/replay and namespace behavior with bounded
   serialization retries. Import SQLite `rowid` as explicit immutable sequence
   values: comparison receipt cutoffs and policy tie-breaking depend on order.
   Preserve JSON payloads, request hashes, null measurements and current source
   **v5** semantics, including immutable release versions, pending/retired
   observations and their original deadlines. Detect the actual deployed source
   version during preflight; source code does not establish its loaded version.
   Advance destination sequences before new writes.
3. Build a resumable importer from a consistent SQLite backup, bound to its
   manifest. Reject source changes, conflicting destination rows and incompatible
   schemas. Identical replays must add no duplicates. Verify report/selection/
   policy parity before enabling writes. The resumable staging importer and
   private PostgreSQL target are now implemented in source; their real PostgreSQL
   acceptance remains unfinished. The async runtime factory, shared policy programs,
   separate activation and native host/HTTP awaits are now implemented in source.
4. Back up both database schemas plus external files. The current native
   PostgreSQL backup includes `--clean`: keep it for source recovery, but do not
   restore it directly into Supabase. Generate a separate scoped migration
   archive without clean/owner/privilege statements; inspect its restore list.

Owners: [database client](../../packages/db/src/client.ts),
[backup service](../../packages/db/src/backup-lib.ts),
[model package](../../packages/model-intelligence/src/index.mjs),
[comparison store](../../packages/model-intelligence/src/comparisons.mjs),
[host integration](../../server/src/services/model-intelligence.ts).

## Private-data gates

Authorization currently lives in the application server. Before real-data
restore, disable the project's Data API, remove `anon`/`authenticated` grants on
application objects and remove automatic grants for the actual restore/migration
roles. Verify anonymous and authenticated Data API access is denied. Supabase
documents existing-project automatic `public` grants and the Data API disable
control; inspect real settings instead of assuming platform defaults.
[API security](https://supabase.com/docs/guides/api/securing-your-api).

The existing **AgentOS data and services** connector can issue SQL. Project
pinning cannot protect private company rows once they share this database.
Before loading them, disable generic SQL/data-reading grants for agents or
replace them with native company-authorized tools. Review diagnostics and other
operations for private-data output too. Friday's explicit portfolio mandate
does not authorize other employees to query arbitrary records. Test denied
connector paths alongside native allowed reads. Keep migration credentials out
of agent tools.

Use separate runtime/migration credentials with privileges validated by rehearsal.
Keep secrets in existing protected configuration. Never print connection URLs,
passwords, dumps or master keys. Preserve object ownership and restrict runtime
access to application objects.

## Connection and capacity

Use actual Dashboard connection details and verified TLS. Rehearse native
postgres.js on direct PostgreSQL or the session pooler when IPv4 is required.
Use session mode for dump/restore. Transaction pooling needs separate proof of
prepared statements, session locks and dedicated-connection behavior before use.
Supabase distinguishes these modes and their session/prepared-statement support.
[Connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres),
[migration guide](https://supabase.com/kb/guides/migrate-from-postgres).

Keep native idle disconnect behavior. Set `DATABASE_POOL_MAX`, timeouts and
lifetime from measured capacity, including dedicated locks, Model Intelligence
and backups. Agent concurrency and connection count are different limits. The
owner's reliability/accuracy policy retains bounded admission and backoff.

## Execution and stop conditions

1. **Read-only preflight:** pin source/package versions; record source/target
   PostgreSQL versions, sizes, schemas, row counts, extensions, ownership,
   journal, active runs and delivery obligations. Inventory SQLite and files.
   Confirm target collisions, API settings, connector grants, free space,
   connection limit, current plan and backups. Missing evidence stops the move;
   no guessed credentials or silent paid upgrade.
2. **Recovery baseline:** create encrypted verified PostgreSQL, consistent
   SQLite (including committed WAL state), file and key/configuration backups.
   Restore them to an isolated source-compatible environment. Bind manifests
   to exact source/destination identities to prevent wrong-target restores.
3. **Rehearsal:** use an isolated private staging database/project with no
   production dispatch. Apply access gates, restore only application objects
   and the journal, then import SQLite. Exclude source roles/ownership and
   Supabase-managed schemas. Run the pinned native migration command and compare
   history. Collisions, missing objects or unexpected migrations stop the run.
4. **Acceptance:** compare every table's deterministic content digest/count,
   constraints, sequences and model report/import parity. Exercise privacy,
   portfolio revocation, Google-owner login, secret resolution, artifacts,
   outbox replay, atomic checkout, capacity waits, rollback, reconnect and
   backup/restore. Use controlled non-billable restart/delivery fixtures. Measure
   latency and peak connections with representative work; no business effects.
5. **Cutover review:** supply rehearsal results, measured downtime, any required
   plan/cost, exact target, manifests, rollback artifacts and exceptions. Obtain
   owner cutover approval then; planning is not production-move authorization.
6. **Cutover:** use native maintenance/admission controls to hold new work and
   inbound mutations, drain execution/delivery and confirm both stores have no
   writer. Take final backups and repeat the proven restore/import. Keep one
   writer; never admit work against old and new databases simultaneously. Update
   protected connection configuration and use guarded native preparation/restart.
   Require its matching report with no lost/skipped/missing runs. Hold dispatch
   until owner, data, privacy and artifact checks pass.
7. **Release:** resume native admission, verify a bounded real task with
   independent review, durable outcomes, retry and interactive responsiveness.
   Restore a new off-site backup. Retain immutable original backups for the
   agreed recovery period; do not immediately delete local data.

Downtime includes final drain, backup, restore/import and verification. Set the
window from measured sizes/rehearsal times. Dump/restore is the initial approach;
logical replication is a separate option only if that measured interruption is
unacceptable and its additional requirements are implemented and rehearsed.

## Rollback and backup

Before the first destination write, retain the admission hold, restore previous
protected configuration and restart against untouched local stores and matching
files. Validate recovery before resuming.

After destination writes begin, switching to stale local stores loses data.
Freeze writers, back up both destination schemas/files, and reverse-restore or
reconcile into an isolated local target first. Preserve new IDs, grants, audits,
outputs and delivery obligations. Record the write boundary/manifests; resume
only one writer. If safe reverse recovery is unproven, hold for repair.

Keep encrypted off-site backups and verify scheduled execution plus an actual
restore. Supabase database backups omit Storage objects; Free-project guidance
recommends regular off-site exports. Files need independent backup.
[Backup documentation](https://supabase.com/docs/guides/platform/backups).

At the 7 November planning checkpoint, no data was exported, permissions changed,
adapter built, staging project created or production cutover performed. Exact live sizes/versions,
permissions, capacity/cost, rehearsal and downtime remain preflight evidence.
The 8 November source continuation adds an offline Model Intelligence backup
inventory in `packages/model-intelligence/src/migration-manifest.mjs`, exposed by
`scripts/agentos-model-backup-manifest.mjs`. It checks an existing standalone v5
backup read-only, preserving all twelve tables' content identities, exact rowids,
nullable evidence and original pending deadlines. Source/manifest changes,
WAL/sidecars, unknown objects/versions, integrity failures and bounds fail closed.
The private manifest omits row payloads and source paths. Seven real SQLite/CLI
fixture checks pass; an initial JSON replay check exposed SQLite's null-prototype
metadata, corrected by projecting ordinary JSON records. The inspector creates
neither a consistent source backup nor a PostgreSQL destination, and proves no
import, semantic report parity, runtime acceptance or live data inventory.
Logs: `/private/tmp/agentos-model-backup-manifest-tests{,-r2}-20261108.log`.

The next 8 November source slice adds `@agentos/model-intelligence/migration`:
an explicit async PostgreSQL staging target, immutable format-1 schema and a
manifest-bound resumable importer. Company namespaces, source rowids, JSON text,
null evidence and original deadlines are retained. Each bounded batch and its
cursor commit together; conflicts stop instead of replacing history. Final
ordered content verification precedes sequence advancement and records only
`imported_unaccepted`, never runtime activation. Destination UUID/schema identity
and public-role access are checked repeatedly. Only confirmed database rollback
errors are retried automatically; unknown commits recover through saved progress.
The independent package's 68 overlapping store/handler/inventory/import/error
checks pass; native semantic checks pass. The six importer cases use real SQLite
with a controlled destination, not PostgreSQL. Five actual PostgreSQL integration
cases are authored but unrun. A standalone PostgreSQL attempt also failed at
shared-memory creation before SQL execution. No live source was read or exported,
no Supabase schema was created and no destination was initialized outside fixtures.
Logs: `/private/tmp/agentos-model-migration-{host,host-r2,regression,build,tsc}-20261108.log`
and `/private/tmp/agentos-postgres-standalone-probe-20261108.log`.

The subsequent source slice adds `@agentos/model-intelligence/postgres`, with
one shared policy owner for synchronous SQLite and asynchronous PostgreSQL.
Each public operation commits evidence and derived changes together; notifications
follow commit. Int64 receipt order stays exact. Namespace mutations serialize;
reports use repeatable-read snapshots. A separate operator activation re-verifies
the import under locks and records reviewed acceptance; startup never activates.
Revoked or exposed destinations fail closed, and active runtimes reject imports.
Final import verification inspects cell lengths and bounds payload pages by bytes.
The host initializes/closes a bounded shared-client pool, awaits storage before
native delivery acknowledgements and refreshes real deadlines only during existing
reconciliation. No new idle polling or generic authority bypass was introduced.

Seventy-eight focused package/CLI checks, 71 focused host checks, 40 startup checks
and 18 coordinator checks pass. Application type checking and server build pass;
new test files also have a separate semantic check. The independently packed
package passes its 77 package checks, syntax build and public export imports.
Initial startup fixtures lacked the new delivery subscription boundary and capacity
reconciliation method; corrected fixtures now pass, including accounting wake and
unsubscribe wiring. Logs retain those failures. Ten actual PostgreSQL cases are
authored but unrun, covering import, lifecycle, namespaces, replay, full routing,
revocation and large payloads. None of these controlled checks proves PostgreSQL
locking/performance or production acceptance. No live migration, activation or
runtime configuration change occurred. The standalone command still uses SQLite;
remote use is explicit through the async factory. Multiple writers/replicas need
an external wake/recovery contract before production use.
Logs: `/private/tmp/agentos-model-postgres-{regression,host-tests,host-tsc-r2,host-build,startup-tests-r3,test-types-r3,packed-tests,gates}-20261108.log`.

Next: execute real importer/report/selection/locking parity and recovery, complete
source/target/file/key preflight and backup/restore rehearsal, then present concrete
cutover review. **C05 remains Not fixed.**

## Live destination preflight — 8 November 2026

The owner restored the paused AgentOS project. CLI project metadata now reports
ACTIVE_HEALTHY; two read-only catalog queries executed successfully as postgres
at 03:31:20 and 03:34:24 UTC. Target version is PostgreSQL 17.11, UTF8/UTC,
10,925,747 bytes, with 46 catalog relations and no relations in public. Neither
the native application tables nor the Model Intelligence schema exist there.

The native migration extensions pg_trgm and fuzzystrmatch are available, but
not yet installed; existing migrations 0051 and 0080 own their creation during
rehearsal. max_connections is 60, with three superuser-reserved slots. Account
for managed services and both application pools before sizing capacity; this
does not qualify subscription concurrency.

Public-table default privileges currently grant anon, authenticated and
service_role broad access for the database owners. API exposure/default grants
must be restricted before application tables or private data are loaded. No
authenticator PostgREST role overrides were found. That absence does not prove
the effective provider API configuration; verify it separately.

Private mode-0600 reports are at
`/private/tmp/agentos-supabase-{preflight,readiness}-live-20261108.json`. This is
executed destination evidence only: source versions/sizes, current plan/backups,
connector access, importer/restore parity and cutover approval remain outstanding.
No application records were read or migrated, and no database settings changed.
