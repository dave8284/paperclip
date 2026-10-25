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
The workforce view labels its snapshot with an absolute observation time; it
does not imply continuously streamed agent state while the page is idle.

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
The baseline backup was restored into a separate embedded PostgreSQL cluster
and migrated through 0383. Counts and sorted-ID hashes were unchanged for
companies (1), agents (8, including retained history), projects (3), tasks (15),
routines (2), work products (9) and audit records (255). The existing company and
Friday IDs survived and the newly added workforce tables began empty. The
temporary cluster was removed afterwards; the live database was untouched.
This verifies database restoration/migration for that backup, not restoration of
external artifact storage, working directories, provider sessions or a deployed host.

Native company-package exports remain company-scoped and do not export the
shared workforce registry. Preserve that registry with an instance backup.
Permanent deletion of a portfolio's home company is refused; archive it instead.
Deleting another company removes only its registry links and assignments, while
retaining the shared employee. Agents with retained workforce history cannot be
permanently deleted. Native board claiming transfers local-owned portfolios to
the authenticated claimant, without transferring another user's portfolios.

For a future archive, record the exact removed paths, last passing revision,
consumers, APIs, data migrations and outstanding scheduled obligations here.
Restore through a reviewed Git change, resolve dependencies and replay that
capability's feature/access-map verification. Friday can propose the work; core
platform edits still require the owner's explicit request.

## Foundation verification record

- Source checkout on macOS arm64, task-local Node 24.22.1 and pnpm 9.15.4.
- Backend implementation revision: `aa7699ca09a26091c10b6fb947954d5689662e01`
  on the pushed `agentos/platform` branch. `1c0324af7` corrects a theme-test
  parser without changing runtime code. `13f3b29b2` adds workforce regression
  coverage to fork CI. The final UI-only correction replaces a stale relative
  timestamp with an absolute snapshot time; its five relevant tests, UI
  typecheck and production build pass. Documentation edits do not affect runtime.
- Isolated real PostgreSQL HTTP tests cover owner grants, two-company identity,
  native termination, key revocation, duplicate retirement, revision conflicts,
  denied access and rollback when durable audit fails. All eight tests pass,
  including token-admitted company scope and replacement admission while a
  previous runtime stop remains unresolved. This is synthetic HTTP/database
  evidence; it does not certify remote runtime termination.
- UI component tests cover company-scoped links, one identity with two
  assignments, lost-response retry, read-only views and account switching.
- Native lifecycle/deletion regression: 64 tests pass. Board-claim/bootstrap:
  13 tests pass, including a prior viewer becoming the authenticated owner and
  retention of unrelated portfolio ownership. OpenAPI parity and focused Friday
  navigation, workforce UI and activity-format tests pass.
- Repository-wide typecheck and build pass with the task-local Node/pnpm/Rust
  toolchain. A first typecheck invocation could not find Cargo; supplying the
  already-installed task-local Rust path resolved that tooling failure. The
  subsequent changed server/UI packages also compile. Final token gates are
  clean; map structure checks pass for 37 areas and 197 capability IDs.
- Initial database tests failed because the fixture omitted the native
  `users:manage_permissions` grant. The fixture now provisions it; route policy
  remains unchanged. Initial UI typecheck found an optional lifecycle value;
  the availability filter now handles it. OpenAPI parity identified the new
  route file missing from its source-file index; the index was added.
- The first full test invocation was interrupted in favor of the repository's
  supported isolated shards. It is not recorded as a pass. The broad general
  server run then found two board-claim failures while that implementation was
  being edited, and 13 queue/repository/planning failures, mostly timeouts.
  The source was frozen and those five suites rerun with one worker: all 115
  tests pass. This recovery result does not erase the initial failures or prove
  their cause. The passing focused ownership run independently covers the final
  board-claim source.
- One general-server shard was stopped after its Git-workspace expiration test
  left an idle transaction blocking company truncation and later fixtures for
  over 30 minutes. Read-only inspection of that isolated test database recorded
  the blocking chain before interruption. The live application database was
  unaffected. All 89 cases of that suite passed in a separate one-worker run.
  The complete shard then passed with one worker: 279 files / 6,046 tests, with
  2 files / 89 tests skipped. The interrupted run is not counted as a pass.
- The adapter-utils batch found the installed Claude CLI at 2.1.126, below its
  MCP isolation test's 2.1.207 minimum. A pinned 2.1.207 CLI was installed in a
  separate task-local verification directory; the normal CLI/runtime was not
  replaced. Its complete adapter-utils rerun passed 83 files / 1,901 tests,
  with 12 tests skipped. The original failed invocation remains part of the record.
- The continuation then found three Hermes environment-test failures because
  `python3` selected macOS Python 3.9.6, below the adapter's 3.10 minimum. A
  verification-only PATH binding to the already-installed Python 3.11.13
  resolved that prerequisite. Hermes and all remaining adapter/plugin projects
  passed in a separate invocation: 58 files / 1,031 tests, with 1 file / 14 tests
  skipped. These fixture checks do not qualify live Hermes/provider execution.
- The broad UI run passed 801 files / 9,133 tests and failed one test that looked
  for destructive-colour tokens only in the first `:root` block. The stylesheet
  already had multiple blocks and is unchanged from the baseline. The test now
  reads all matching blocks and the final token declaration; both light and dark
  contrast checks pass. No colour or contrast threshold was changed. The CLI
  workspace then passed all 65 files / 537 tests in an isolated invocation.
- All three serialized-server shards passed: 162 files / 3,490 tests. The
  database workspace passed all 57 files / 239 tests. General-server shard 4
  passed 283 files / 6,143 tests with 4 files / 25 tests skipped. All local test
  groups are now covered across the original batches and their recorded
  recoveries. There is no single clean full-suite invocation: retain the earlier
  failures and skips rather than treating reruns as equivalent release proof.
- GitHub's existing fork workflow passed for `1c0324af7` (run
  [40191975776](https://github.com/dave8284/paperclip/actions/runs/40191975776)),
  including typecheck, migrations, catalog checks, prior product regressions and
  build. The workflow now also runs workforce authorization, retirement, native
  lifecycle, board claiming, UI and theme checks. The final branch CI rerun is
  pending at delivery; consult the branch's latest workflow run for its result.
- The existing local instance restarted with migrations 0382/0383 applied,
  no pending migrations and zero active runs interrupted. Readback confirms an
  Agent OS portfolio, Platform Operations company and six shared specialists
  with six preserved native bindings. The 13 audited setup mutations comprise
  one portfolio, six employees and six assignments. No live provider work was
  launched by this bootstrap.
- Browser automation is currently blocked before connection by the host tool's
  `codex/sandbox-state-meta: missing field sandboxPolicy` error. It persists after
  the user's reconnect attempt. Installed system CLI is 0.164.0; the desktop
  bundle reports 0.137.0-alpha.4 / app 26.602.40724. A version compatibility issue
  is a hypothesis, not an established diagnosis. Component/API checks do not
  certify visual layout, microphone input or audible playback.
- Local logs are under `/tmp/agentos-*.log`; the Git-lock inspection is
  `/tmp/agentos-test-lock-evidence.txt`. These are diagnostic files, not portable
  release evidence. The results and limits above are the durable delivery record.
