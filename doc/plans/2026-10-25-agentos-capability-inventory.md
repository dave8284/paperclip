# Agent OS foundation inventory

Baseline: `a908847549e436c21b525040456857cfd36e841d`, branch `agentos/platform`.
The approved [operating model](2026-10-25-agentos-operating-model.md) controls scope.
This inventory records retention decisions; nothing listed as a later archive
candidate has been deleted or disabled by this foundation change.

## Retained capabilities and ownership

| Capability | Owner / entry point | Data and execution dependencies | Treatment |
| --- | --- | --- | --- |
| Friday conversation and orb | `ui/src/pages/Friday.tsx`, `FridayWorkspace.tsx` | Native agent chat, operating profile, browser voice | Keep; move persistent conversation to shell in Friday phase |
| Company profile and membership | `server/src/routes/companies.ts`, native access service | Company, member, grant and operating-policy records | Keep; companies remain ventures |
| Shared workforce | `server/src/services/agentos-workforce.ts`, `/workforce` | Portfolio, employee, company assignment and native agent | New owner-scoped identity layer; no new executor |
| Agents, harnesses and account seats | `server/src/routes/agents.ts`, adapter/runner packages | Native lifecycle, explicit model accounts, subscription policy | Keep; qualify observable contracts before autonomous admission |
| Skills and instructions | Agent/company skill APIs, instruction revisions and catalogs | Agent/company scope, source sync and revision history | Keep; add central publication/adoption references later |
| Native staffing and lifecycle | `server/src/modules/agent-lifecycle` | Company accounting lock, durable lifecycle obligations, runner cleanup | Keep; shared retirement calls this owner transactionally |
| Projects and tasks | Native projects/issues services and APIs | Single assignee, checkout, privacy and task mode | Keep; no second task engine |
| Applications and onboarding | `managed-applications.ts`, Applications pages | Native home/initiative projects and existing/new source fields | Keep; application is an asset within a company |
| Routines and recursive loops | Native routines service/routes | Persisted triggers, routine runs, shared scheduler | Keep; agents own loops under scoped grants |
| Artefacts and reusable displays | Native attachments, work products, documents | Source task, revision history, preview isolation | Keep; snapshot displays do not gain parent-app credentials |
| Decisions and approvals | Attention, approvals, issue interactions | Native revision/authority and responsible-user checks | Keep; add authorized portfolio projection |
| Direct agent chat | Agent chat and issue conversation surfaces | User/agent/company identity and native runs | Keep; shared identity aggregation must filter each company |
| Audit and run log | Activity log and heartbeat run events | Durable local DB, source actors and run IDs | Keep; distinguish operational events from inferred reasoning |
| Search and knowledge | Native search/documents/project resources | Company, project and private-task ACLs | Keep; add portfolio scope without weakening source ACLs |
| Spend and capacity | Budgets/accounting, native admission and account bindings | Reservations, hard stops and native lifecycle holds | Keep; subscription-wide capacity qualification remains planned |
| Tool/cloud connections | Native Apps/tools/connections/environment services | Vault, per-agent grants, receipts and approvals | Keep; configured capability is distinct from verified provider operation |
| Recovery, backup and migration | Native startup recovery, database backup/migrations | Durable obligations, external runtime ownership and schema journal | Keep; never hide recovery controls without another route |

## Simplification candidates

Keep the feature and agent-access maps as the detailed index. Sidebar-only
simplification can happen after Friday can surface the equivalent views.
Conference rooms, experimental cases/workflow editors, optional plugin launchers,
advanced runtime administration and individual provider management panels are
candidates to hide behind Explore/settings. They retain their APIs, tables and
native triggers while hidden. No background job is disabled just because its
navigation link is hidden. Native cases/handoffs already provide delegation
evidence and must not be removed as apparent UI clutter.

## Trigger inventory

The new workforce layer has **no timer, scheduler or periodic worker**. Its reads
occur on navigation, focus or explicit refresh. Mutations commit activity and
publish existing live-event hints. Retirement registers work through native
agent lifecycle effects; the lifecycle coordinator owns retries, cleanup,
restart reconstruction and pending-stop state. Unchanged routine, runner,
connection and catalog workers retain their original owners.

## Restore and change procedure

Before the schema update, a compressed native database backup was created in the
existing instance's configured backup directory with prefix
`agentos-before-workforce-20261025-234026`. The backup remains local and is not
committed. Keep executable migration history and the five newest generated
schema snapshots. The baseline Git tag is `agentos-before-shared-workforce`.

For a code rollback, stop affected admissions, check active run ownership and use
the baseline checkout in an isolated worktree. New tables are additive; do not
drop them to roll code back. If a data rollback is required, restore the native
backup into an isolated instance first and validate the original companies,
agent bindings, routine definitions, tasks and outputs before replacing data.
This procedure is documented; a full backup restoration rehearsal has not yet
been executed for this change.

For a future archive, record the exact removed paths, last passing revision,
consumers, APIs, data migrations and outstanding scheduled obligations here.
Restore through a reviewed Git change, resolve dependencies and replay that
capability's feature/access-map verification. Friday can propose the work; core
platform edits still require the owner's explicit request.

## Foundation verification record

- Source checkout on macOS arm64, task-local Node 24.22.1 and pnpm 9.15.4.
- Isolated real PostgreSQL HTTP tests cover owner grants, two-company identity,
  native termination, key revocation, duplicate retirement, revision conflicts,
  denied access and rollback when durable audit fails.
- UI component tests cover company-scoped links, one identity with two
  assignments, lost-response retry, read-only views and account switching.
- Initial database tests failed because the fixture omitted the native
  `users:manage_permissions` grant. The fixture now provisions it; route policy
  remains unchanged. Initial UI typecheck found an optional lifecycle value;
  the availability filter now handles it. OpenAPI parity identified the new
  route file missing from its source-file index; the index was added.
- Browser automation is currently blocked before connection by the host tool's
  missing sandbox metadata. Component/API checks do not certify visual layout,
  microphone input or audible playback.
- Expanded suite, build, migration and local-server results are recorded in the
  delivery update after they run. No live model/provider execution is claimed.
