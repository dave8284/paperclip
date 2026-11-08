# AgentOS remaining-work execution — 6 November 2026

The owner requested completion of the remaining work, correct verification, and
questions instead of assumptions. This continues the full
[requirements reconciliation](2026-11-03-agentos-requirements-reconciliation.md),
[remaining-work list](2026-11-05-agentos-landing-and-remaining-work.md) and
[latest implementation backlog](2026-11-05-agentos-navigation-response-model-backlog.md).
Those requirements remain in scope; the rows below do not replace or erase them.

## Resume here — 8 November 2026

The owner requested simple **Fixed / Not fixed** tracking in the existing
[93-item worksheet](2026-11-03-agentos-requirements-reconciliation.md).
Update those rows as work completes; do not create another backlog.
**Current total: 37 Fixed / 56 Not fixed.** Partial implementation and unverified
live acceptance remain Not fixed. This checkpoint was refreshed at the owner's
request on 7 November; the tables below the current checkpoint are historical.

- **8 November — C05 import/runtime source continuation, still Not fixed:**
  independent manifest-bound staging/import and the async PostgreSQL runtime are
  implemented. SQLite and PostgreSQL share policy programs; public operations
  retain atomic evidence/derived changes, exact int64 order and commit-only wakes.
  Acceptance/revocation is separate from importing/startup. Active runtimes reject
  import; schema/activation identities and private access are rechecked. Native
  callers await storage before acknowledgement; existing reconciliation refreshes
  actual deadlines without remote scheduler polling. Import verification bounds
  payload bytes after inspecting lengths. No live migration/activation occurred.
  **78 package/CLI checks, 71 focused host checks, 40 startup checks and 18
  coordinator checks pass**, with application semantic checks/build. The packed
  independent package passes 77 checks, build and export loading. Startup fixtures
  initially lacked new subscriptions/capacity reconciliation; those are corrected
  and the failed logs retained. Ten real PostgreSQL cases are authored, unrun;
  socket and standalone shared-memory EPERM remain actual blockers. Multiple
  writers still require external wake/recovery qualification. Next: real PG
  import/report/selection/locking/recovery parity, preflight, restore rehearsal
  and concrete cutover review. No requirement is closed by source checks.
  Logs: `/private/tmp/agentos-model-postgres-{regression,host-tests,host-tsc-r2,host-build,startup-tests-r3,test-types-r3,packed-tests,gates}-20261108.log`;
  earlier failures: `agentos-model-postgres-startup-tests{,-r2}-20261108.log` and
  `/private/tmp/agentos-postgres-standalone-probe-20261108.log`.
- **C05 live destination connection unblocked — 8 November:** the CLI now
  confirms linked AgentOS Sydney `rxcykzhtkspsonntirhi` is `ACTIVE_HEALTHY`, after
  `INACTIVE` → `COMING_UP` → `RESTORING`; the owner restored it in the dashboard.
  Both read-only metadata queries executed successfully as `postgres` at
  03:31:20 and 03:34:24 UTC. Actual target: PostgreSQL **17.11**, UTF8/UTC,
  10,925,747 bytes, 46 catalog relations, no public relations and no Model
  Intelligence schema. `pg_trgm` and `fuzzystrmatch` are available but uninstalled;
  native migrations 0051/0080 own their eventual creation. Capacity is 60 total
  connections with three superuser-reserved slots, not an agent-job limit.
  Existing public-table default ACLs grant anon/authenticated/service-role access;
  restrict API exposure/grants before loading private application tables.
  No PostgREST role overrides were found; effective provider API configuration,
  current plan/backups, source inventory, restore rehearsal and cutover remain open.
  Private evidence: `/private/tmp/agentos-supabase-{preflight,readiness}-live-20261108.json`
  (mode 0600). No application rows, migration or cutover were performed.
  Earlier login-role 544 is accounted for by the paused project. A shell-redirected
  query and the backup-list invocation could not see a token; the direct permitted
  `supabase db query` invocation succeeds. Do not generalize that limitation to
  all CLI calls or request another login. Direct restore API attempts found no
  accessible credential and sent no restore request. The older blocked interactive
  login session `66241` was never completed; do not resume it to bypass restrictions.
- **R05 live setup and backend activation — 8 November:** owner approved the
  native CLI session; `/api/cli-auth/me` verifies approved instance-admin identity.
  Orbit Test Company `feecec6a-df39-4274-9362-748220a44ff7`, planned goal
  `bd63a3ce-ffaf-4c8d-a509-924d0dfa0b15` and project
  `1da15d43-279d-4c18-84f6-09bfdfc3d25f` now exist and match qualification
  `735c2387-09b0-4325-a32b-62c66ecad426`. Two initial curl company POSTs failed
  before connection (exit 7 / HTTP 000); retained command evidence established
  nonexecution before resetting intent. The owner ran the prepared private
  Terminal helper; native GETs independently verify all three records. Orbit has
  no agents or provider runs yet. Native POSTs with JSON now work directly; do
  not generalize the earlier request failures to all writes.
  Native guarded restart `8cfb0d17-8358-4c64-a8e2-4eab61b67fda` was accepted at
  03:52:41 UTC. Migrations 0393/0394 applied, matching recovery completed at
  03:53:04, and fresh authenticated health has startup ready, zero pending
  migrations, no required restart and zero active runs. No runs were lost;
  this proves idle activation, not live-work recovery. Orbit is portfolio-linked.
  Friday's owner-private read mandate `dd588f8f-9c81-4557-8828-250dd2eda049`
  revision 1 covers both business companies; no board-direction grant or
  delegated run has yet been created. Private setup evidence is retained in
  `/private/tmp/agentos-delegation-{state,live-preparation}-20261108.{json,log}`;
  the native recovery report is under `.runtime/instances/default/`.
- **R03 owner correction — connect once:** the owner explicitly rejected a
  second subscription login for Orbit. AgentOS must reuse the once-connected
  owner account across authorized companies while preserving company-local work,
  grants and attribution. Current AI connections/credential rotation are bound to
  one company; capacity grouping alone does not implement account reuse. Fix this
  native account lifecycle, rather than copying rotating tokens, relabeling the
  source company, or asking for one login per company. The unnecessary Orbit
  login attempt was cancelled through the native API. Existing Platform
  Operations subscription remains connected. Next: implement and verify native
  account reuse, then qualify bounded capacity and resume the CEO-led journey.
- **R03 account reuse source continuation — verification in progress:** an owner
  registry now references the existing canonical connection and vault identity;
  company aliases contain no copied credentials. Runtime, quota/rotation, pending
  lease write-back, profile qualification and subscription accounting use the
  canonical credential while preserving target-company authority and attribution.
  Central controls reuse the account without a new login. Native mutations share
  enrollment's transaction fence; manual probes pin the selected account across
  the credential-lock wait. Disabled accounts retain one capacity group, and
  durable credential handoffs block account changes even after run termination.
  Account source is now loaded (see activation below); the real delegation
  journey has not run.
  Generated 0395 initially ordered its referenced unique constraint after the
  foreign keys. Two authenticated health reads proved 0395 pending, automatic
  restart off and the same pre-generation process; only this new unapplied SQL's
  statement order was corrected before activation. No applied migration changed.
  The normal generation wrapper hit its tsx IPC listener restriction; the same
  numbering/safety/compile/generate/prune stages ran with Node's tsx loader.
  Source checks and focused tests are still being integrated. Four OpenAPI HTTP
  cases hit retained listener EPERM; route registration coverage is corrected and
  all 26 non-listener OpenAPI checks pass. Initial guard fixtures had an incorrect
  factory call and omitted the existing Slack endpoint read; corrected, rerun
  pending. Earlier failed logs remain under `/private/tmp/agentos-ai-accounts-*`.
- **R03 verification and activation — 8 November:** 146 combined canonical
  owner/runtime/cleanup/setup/authority/capacity checks pass. Additional onboarding
  and provider UI coverage passes 213 checks; focused setup UI and owner-switch
  tests also pass. Server/shared/UI builds and semantic checks, migration
  numbering/safety, module/map/token and diff gates pass. The owner ran the real
  disposable database script: **239 passed, two failed**. Its refresh failure
  exposed an unintended change to existing company-only same-account reconnect
  merging; shared-account epoch fencing is now limited to registered accounts,
  retaining the existing provider freshness merge for ordinary connections. The
  second failure was a fixture's unremoved secret row; fixture cleanup is fixed.
  The failed log remains `/private/tmp/agentos-account-reuse-database.XXXXXXXX.log`.
  Twelve account-management DB cases now include actual canonical resolution and
  concurrent alias admission; the later added cases are not claimed passed.
  The owner asked the agent to run reruns unless absolutely unable. Direct rerun
  again encounters `listen EPERM` in this session; do not repeatedly hand over
  Terminal work or treat owner authorization as removal of sandbox restrictions.
  Guarded runtime restart `35dd79c5-a13c-4349-a351-edd08f393c06` was accepted after
  healthy startup, backup status OK and zero active runs. Matching recovery
  completed at 04:40:12 UTC, startup is ready, migration 0395 applied, and fresh
  health reports no pending migration/restart or active run. This proves idle
  activation only. Enrolling the existing subscription then exposed historical
  successful native runs without capacity settlement receipts. Their runner
  identities are intentionally retained for later turns. The fix checks exact
  local process-stop and cleanup evidence under lifecycle locks without clearing
  reusable session state; verification is in progress. Provider acceptance and
  real delegation remain open.
- **R03 live account reuse verified — 8 November:** the retained successful-run
  compatibility fix preserves warm-session identities and checks exact host,
  process birth, newest native launch, process/group exit and cleanup under
  lifecycle locks. Active ownership, uncertain stop and credential handoff remain
  blocked. **65 combined process/capacity checks pass**, with server build,
  semantic checks and module/diff gates. Guarded restart
  `59f4e2f5-d2e0-47bc-ada0-dbf43766fab7` completed recovery at 04:53:16 UTC;
  fresh health is ready with zero pending migrations/restart or active runs.
  Existing account `63cf588b-22b6-4a65-98c9-69461ba6b003` enrolled successfully,
  and native automatic setup installed Northstar and Orbit without another login.
  All three bindings share capacity group `237b6d5c-eab6-4f95-bc25-641106336731`
  at the initial bounded concurrency of one. Orbit's native Codex environment
  probe passed at 04:54:16 with model `gpt-6.1-sol`, using the shared subscription.
  This establishes actual account reuse, not qualified multi-job throughput.
  Logs: `/private/tmp/agentos-retained-capacity-{final,build,tsc,final-compile}-20261108.log`.
- **R05 live delegation started — 8 November:** Orbit CEO
  `46a30242-1c03-421f-a46f-0311c9fd9761` was created with the Orbit alias,
  managed company instructions and native CEO grants; lifecycle reached ready.
  Two inline request attempts failed before connection; fresh native reads
  established no agent existed before the successful JSON-file request.
  Friday's separate board-direction grant is now enabled under mandate revision
  1. The owner-authorized fictional brief was posted once in the actual owner's
  Friday chat (comment `ecc3b8f6-6fcc-4ec4-b4da-471f7e138b93`, request key
  `d7181460-40ae-454e-a31d-c91564d3c4e2`). Friday's native run
  `633e3fd5-ef3b-4175-b0be-05155bda0286` is running. The CEO must staff and
  delegate, a separate reviewer must check exact outputs, and Friday must report
  evidence. No delivered/reviewed/owner-accepted outcome is claimed yet.
- **Git delivery:** owner asked whether completed changes are pushed with logs.
  Commit/push verified work with a reviewable validation summary and explicit
  unrun/live limits; exclude credentials/private payloads. **`57a5de0ae` is committed
  and pushed to `origin/agentos/platform`**: private metadata preflight/helper,
  seven controlled checks and a validation/blocker summary in the commit body.
  **`fa5bdf7c1` is also pushed**: destination extension/capacity/default-grant
  checks, verified against the real Supabase destination; evidence paths and
  remaining limits are in its commit body.
  The remaining application continuation is still uncommitted; preserve that
  working tree and review/test each coherent slice before delivery.

- **8 November — continued after owner correction:** keep progressing through
  unblocked source work when runtime acceptance is blocked; a source checkpoint
  is not a reason to end the full task. The owner chose a dedicated **test company
  and test objective before any real company** for R05. Prepare a fictional service
  launch-plan exercise with CEO-led delegation, independent review and Friday's
  evidence report. This does not waive the retained environment restrictions,
  subscription-only execution, company isolation or explicit provider deferrals.
- **O03 case-file continuation — source checked, acceptance open:** private
  discovery now lists readable case identities and case-owned attachment versions;
  byte reads require exactly one task or case owner. The native case service owns
  the shared retained-source predicate and feature gate. The mandate gateway
  retains its source-company actor/trust/key checks and strict owner/authorizer
  ceilings, checks current case task/project ownership and original upload case,
  and repeats authorization/identity checks after cancellable storage. No case
  fields, credentials, arbitrary storage selectors or API captures are exposed.
  **46 focused host checks, 26 OpenAPI checks, 11 catalog checks and ten UI checks
  pass**, as do server semantic checks/build and module/map/token/diff gates.
  Test semantic checking found two older project-access fixtures still using
  `userId` instead of `subjectType/subjectId`, and an incorrect `agent_api_key`
  actor-source spelling; corrected to the actual contracts. The seven authority
  checks pass again. The initial UI command used the wrong working directory;
  rerunning from `ui/` passes. Both failed logs are retained. A PostgreSQL/HTTP
  case covers retained-source privacy/relinking/change-during-storage and disabled
  Cases, authored but unrun under retained restrictions. Source remains
  uncommitted with the parent portfolio implementation; no runtime was activated.
  Logs: `/private/tmp/agentos-portfolio-cases-{focused,tsc,test-types-r2,authority-final,openapi,catalog,ui-r2,build,gates}-20261108.log`;
  initial failures: `agentos-portfolio-cases-{ui,test-types}-20261108.log`.
- **O03 private task-file continuation — source checked, acceptance open:**
  private mandate discovery now includes ordinary task attachments. The byte
  endpoint binds attachment/task/hash, preserves original upload-task privacy,
  excludes API captures and case-owned files, and reauthorizes after storage.
  Reads are capped at 64 KiB, cancel on disconnection/deadline, return no storage
  keys and never become plaintext tool-response artifacts. Whole-file integrity
  is asserted only after all bytes have actually been verified. No authority
  locks span storage. The storage service now forwards cancellation to existing
  local/S3 providers; other consumers retain their contract.
  **2,175 focused storage/projection/native API checks plus four controlled
  authority/reauthorization checks pass**; initial server semantic check passes.
  One PostgreSQL/HTTP privacy/revocation case is authored but unrun under retained
  restrictions. Logs: `/private/tmp/agentos-portfolio-files-{shared,host,authority,tsc}-20261108.log`.
  Final server semantic check/build, all 11 catalog checks, 25 OpenAPI checks
  (four listener cases excluded), ten UI checks and module/map/token gates pass.
  The initial UI run failed its old exact-copy assertion; the updated assertion
  passes. Logs: `/private/tmp/agentos-portfolio-files-{tsc-final,build,catalog,openapi,ui,ui-r2,gates}-20261108.log`.
  Case-owned files are covered by the later source continuation above; actual
  persisted/live acceptance remains open for both task and case files.
- **R05 earlier preparation blocker — superseded:** the fictional fixture and
  retry-safe setup command passed nine controlled checks. Earlier socket/browser
  limitations prevented setup; the live setup/restart entry above records their
  resolution. The current remaining dependency is qualified account reuse and
  actual CEO-led delivery, review and owner acceptance. No provider execution is
  implied by the prepared company or successful setup API calls.
- **C05 offline inventory — source checked, migration unperformed:** a separate
  Model Intelligence operator export/CLI checks a consistent standalone v5 backup
  read-only. The private manifest binds file/schema/table contents, all twelve
  tables, exact 64-bit rowids and retained deadlines without including row data.
  Changed sources/manifests, WAL/sidecars, unknown versions/objects, integrity
  errors and limits stop output. Seven real SQLite/CLI fixture checks pass. The
  first replay check found SQLite metadata prototypes differing after JSON load;
  normalized projected metadata fixes the failed case. No production backup,
  database read/export, adapter/import, restore, grant or cutover occurred.
  Logs: `/private/tmp/agentos-model-backup-manifest-tests{,-r2}-20261108.log`.
  Next: independent PostgreSQL store/importer parity, actual preflight/rehearsal
  and concrete cutover review; planning is not data-movement approval.
- **M05 receipt-order correction — source checked, context gap retained:** accepted
  input evidence must precede its native provider turn. A late receipt cannot
  backfill execution evidence, and session receipts after run termination are
  rejected. Seventy-eight context/measurement/comparison/routing checks and server
  semantic checks pass. Implicit/retrieved context and provider tool-result use
  remain unverified; `observedVariant` stays null and M05/M06 stay Not fixed.
  Logs: `/private/tmp/agentos-model-context-order-{tests,tsc}-20261108.log`.

  The migration package's 60 overlapping store/comparison/routing/handler/inventory
  checks pass. Its six standalone inventory checks and the separate repository
  CLI check also pass after moving the CLI test out of the independently packaged
  product. Logs: `/private/tmp/agentos-model-backup-regression-20261108.log` and
  `/private/tmp/agentos-model-backup-manifest-tests-final-20261108.log`.
  A final whitespace check found an extra catalog-instruction EOF blank line;
  corrected it and regenerated the catalog. Module/map and diff checks pass.
  Final context cleanup passes all 34 direct receipt checks and server compile;
  the server build passes with native Runner reuse verified. The separately
  packed/extracted Model Intelligence package passes its six inventory checks,
  syntax build and public inventory export import. No runtime was activated.
  Logs: `/private/tmp/agentos-model-context-order-{build,final-tests,final-compile}-20261108.log`,
  `/private/tmp/agentos-model-manifest-pack-tests-20261108.log` and
  `/private/tmp/agentos-model-backup-package-build-20261108.log`.
  The fictional objective now explicitly assigns `board-report.md` to the CEO's
  team; Friday reads it and briefs the owner in their native conversation. All
  nine preparation checks still pass. Only the confirmed empty local preparation
  state's fixture hash was refreshed; no native request or app write occurred.
  Log: `/private/tmp/agentos-delegation-preparation-tests-final-20261108.log`.

- **8 November — O03 company-owned direction handoff source (acceptance open):**
  separate `workforce:board_direct` authority now binds the exact current private
  read grant/revision/source/owner/target set/expiry. Owner controls explicitly
  grant/revoke it; changing the read mandate invalidates it. Native Friday owner
  conversations can persist one destination-company task for its actual CEO or
  responsible head. Unknown fields, foreign parents/workspaces/runtime inputs,
  identity substitution and altered retries are rejected. The source ledger
  retains actual Friday provenance; target work retains its native company and
  responsible owner. Native admission rechecks task contents, current authority
  and role inside its own transaction, with a stable receipt and normal native
  gates. The shared delivery coordinator retries unresolved work and reconstructs
  it at startup; receipt recovery distinguishes admission from task completion.
  Revocation cancels unaccepted handoffs without undoing company work already
  admitted. Current-resource reads report task/dispatch status without asserting
  successful review or business acceptance.
  **52 focused host checks and 10 UI checks pass; server semantic checks pass.**
  Four PostgreSQL transaction/isolation/revocation/recovery cases are authored,
  unrun under the retained socket restriction. Migration `0394_sudden_arclight`
  is generated, inspected and unapplied; five snapshots retained. The standard
  generator's tsx IPC listener failed with EPERM, then the same numbering/safety,
  compilation and generator steps ran through the non-listening Node loader.
  Review corrected a potential nested-transaction dispatch lock dependency before
  acceptance: authorization is repeated inside native admission, never held in
  an outer transaction across `wakeup`. Further checks are in progress.
  Logs: `/private/tmp/agentos-board-directions-{host,ui,server-tsc-r3,migration,generate,migration-check}-20261108.log`.
  The additional recovery/scheduler/migration-drift selection passes 51 overlapping
  checks. UI semantic checks and build pass; existing chunk/import warnings remain.
  Logs: `/private/tmp/agentos-board-directions-{recovery,ui-build}-20261108.log`.
  Final native protocol/intent checks pass 121 tests across five files; API
  discovery passes 25 checks with four listener cases excluded. The initial API
  assertion read `description` instead of this catalog's `summary`; its corrected
  assertion passes. Server build, module boundaries, 37-area/204-capability maps,
  UI design-token gates (1,468 files) and diff whitespace checks pass. The map
  checker initially required the new capability's missing `Gaps` field; fixed.
  A separately invoked npm forbidden-token scan flags existing fork-owner names
  and GitHub URLs; it is not the passing UI design-token gate and remains failed.
  No fork identity, gate or publication policy was changed to suppress it.
  Logs: `/private/tmp/agentos-board-directions-{admission-final,openapi,openapi-r2,server-build}-20261108.log`.
  **External-source follow-up:** the existing case-handoff binding validation now
  lives in a shared native authority owner. Board directions revalidate current
  Muse/Dot/Grok binding identity/generation, connection authority and every
  external authorizer/operator's destination read/project/assignment ceiling.
  Original agent, source company/run and responsible owner remain unchanged.
  Changed authorizers and revoked connections cannot replay old authority.
  Same-company case handoffs retain their existing native authorizer semantics.
  Thirty-eight focused real-contract/controlled-authority and delivery checks
  pass; persisted broker/admission races remain unrun. Logs:
  `/private/tmp/agentos-board-external-authority-{host,tsc,tsc-r2}-20261108.log`.
  **Outcome follow-up:** reads now report the latest native implementation run,
  exact historical independent native review and whether its frozen task inputs
  still match current scope. Missing/ambiguous/self reviews stay unverified;
  admission and process success never become business acceptance. Native review
  evidence has a shared owner reused by existing model consumers; bounded reads
  omit run output/provider context. Current task/project rights are rechecked
  after evidence collection. Retries use exact persisted retry/lease deadlines,
  while transient authority contention keeps the obligation instead of cancelling
  it. Ninety focused outcome/model/recovery checks pass. The first semantic check
  found the deliberately narrowed review payload still typed as a complete prompt;
  its input now correctly accepts unknown metadata and validates the target.
  Server build passes after that correction. Logs:
  `/private/tmp/agentos-board-outcomes-{shared,host,server-tsc,server-build}-20261108.log`.
  Refreshed catalog/semantic checks and all 11 catalog tests pass; 25 OpenAPI
  checks pass with four listener cases excluded. Logs:
  `/private/tmp/agentos-board-outcomes-{catalog-final,openapi-final}-20261108.log`.
  **Next:** persisted native admission/concurrency/privacy and the real executive-led
  delivery/review/board-report journey. No runtime activation, live grant,
  business job or database migration has been performed.

- **8 November — O03 role-switch source follow-up (acceptance open):** operating
  profile updates now consume the existing lifecycle stop/cleanup evidence before
  designating a different employee as Friday. The exclusive configuration lock
  matches final native provider entry, so admitted work is observed before the
  role changes. The check neither cancels work nor clears lifecycle ownership;
  existing lifecycle consumers retain their cleanup behavior. An unchanged Friday
  retains conversations. This is a user-triggered check of the selected employee's
  run/lease history, not background polling; it can include the existing bounded
  process-identity probe and fails closed on unavailable stop evidence.
  Thirty focused controlled-store/role checks pass. Three additional PostgreSQL
  designation/lock cases are authored but unrun under retained restrictions.
  API discovery no longer incorrectly advertises an automatic operational grant.
  Logs: `/private/tmp/agentos-friday-designation-{host,tsc}-20261108.log`.
  Final combined source verification passes **159 tests across nine files**
  (four listener cases excluded), server semantic checks and server build.
  A malformed historical review reference now remains unverified instead of
  reaching a PostgreSQL UUID cast; the follow-up outcome/model selection passes
  **47 overlapping tests**, including three new malformed-reference cases.
  Module boundaries, 37-area/204-capability maps, UI token gates and whitespace
  checks pass. The native Runner build was reused only after verifying unchanged
  inputs/outputs. Logs:
  `/private/tmp/agentos-board-source-final-{host,tsc,build,gates}-20261108.log` and
  `/private/tmp/agentos-board-source-review-final-20261108.log`.
  **Next:** run the authored PostgreSQL role/authority/concurrency cases, activate
  through the guarded native restart and complete real executive-led acceptance
  when the retained environment restrictions permit them. None of these source
  checks closes O03/O04/W03/R05 or authorizes Supabase cutover. Attached-binary
  portfolio reads, M05 implicit context evidence and the other worksheet gaps
  remain open; no checklist item was removed or silently deferred.

- **8 November — O03/O04/W03/R05 remain Not fixed:** current-Friday designation
  now excludes delivery/routine assignments and nonconversation execution. Native
  assignment directs Friday only to actual company CEOs or responsible heads.
  Preparation rechecks the role; final native dispatch holds the shared operating
  profile lock through synchronous provider entry. Friday's conversations,
  mentions, directory and company workforce reads remain available. CEOs/actual
  department heads own native staffing mutations; Friday cannot bind/retire staff
  or manage applications/departments/workspaces, even with legacy broad grants.
  Designation no longer grants operational management permissions. Existing
  grants are preserved and remain subject to the role ceiling. Restored task
  drafts naming Friday show a correction and cannot submit. The native role
  ceiling also blocks configuring other employees and waking specialists directly;
  self coordination and executive wakes still undergo normal native checks.
  **93 focused host/dispatch checks, 110 UI checks and 24 OpenAPI checks pass**;
  four OpenAPI listener cases are excluded. Shared/server/UI semantic checks,
  shared/server/UI builds and module/map/token gates pass for this role slice.
  The initial guard run exposed a real Drizzle correlated-column qualifier bug;
  explicit table identifiers fixed it. The initial typecheck found a transaction
  type mismatch; helpers now accept the narrow select contract. Both failures
  and corrected runs are retained. A UI command used the wrong root and ran zero
  tests; its correctly rooted rerun passes. An initial OpenAPI name filter matched
  zero tests; the corrected selection is the 24-pass result above.
  Four new PostgreSQL role/assignment cases and three final-dispatch designation/
  locking cases are authored but unrun; workforce/application regressions now
  reflect executive staffing and Friday read-only behavior. No runtime activation,
  live grant, business task dispatch or database mutation occurred.
  Logs: `/private/tmp/agentos-friday-role-{admission,ui,server-final,ui-tsc,openapi-r2,shared-build,server-build,ui-build}-20261108.log`.
  Final follow-up: 37 focused host checks and 125 UI checks pass, plus server/UI
  semantic checks and the UI build. The inbox-permission picker now uses the
  interaction filter so Friday remains selectable there. The requested dispatch
  test path in the final host command did not exist; that result covers its three
  reported files only (the earlier 70 dispatch cases are separate evidence).
  Logs: `/private/tmp/agentos-friday-role-final-{host,server-tsc}-20261108.log`,
  `/private/tmp/agentos-friday-role-ui-final{-build,}-20261108.log`.
  **Next source work:** finish executive outcome
  reporting beyond the new native handoff above. Read mandates remain read-only. The
  owner already settled company isolation and Friday's board role; no repeat
  scope question. Persisted concurrency/privacy and loaded acceptance stay open
  under the retained sandbox restrictions.
- **8 November — executive discovery source:** the exact private mandate's
  `portfolio-records` gateway now lists actual target-company CEOs/department
  heads, optionally narrowed to a currently readable project. Current Friday,
  title-only roles, credentials/configuration and unavailable lifecycle states
  are excluded. Owner/external project rights apply before pagination; shared
  read grants gain no additional scope and no write is authorized. Thirty-six
  overlapping host/contract/role checks and six UI checks pass; shared build and
  server typecheck pass. One PostgreSQL gateway/revocation/ceiling case is authored
  but unrun. See the [mandate record](2026-11-06-agentos-portfolio-read-mandates.md).
  Logs: `/private/tmp/agentos-executive-discovery-{shared,host,tsc,ui}-20261108.log`.
  The completed source slice also passes 14 chat/prompt checks (26 database cases
  excluded), all 11 catalog checks, shared/server/UI builds, UI typecheck and
  module/map/token gates. The Runner build was reused after its inputs were
  verified unchanged. Existing UI chunk/MarkdownEditor warnings remain.
  Logs: `agentos-executive-discovery-{chat,catalog,build,ui-build}-20261108.log`.

- **Fixed:** retained native features; company hierarchy/navigation; transcript,
  connected/setup drafts and home suggestions; single-dashboard landing and icons; graph
  navigation/style; local artifact history and scoped search; connector inventory;
  standalone model-service transport/persistence/isolation. Worksheet rows are
  authoritative and each carries its current binary status.
- Source checkpoints through model qualification `846613d4e`, migration
  repair `651e0b23a`, component publication `99277b71d` and its verified checkpoint
  `5caf81c0d` are pushed to the fork.
  Later active changes must be checked before starting another worker.
- **Not fixed:** full operating delivery, owner Google account acceptance, physical
  voice conversation, provider workflows, model qualification and evaluated learning.
- Local speech roundtrip and saved table/list/board refresh pass. Setup draft
  persistence/handoff passes in the actual browser, without sending a message.
- Backend model checkpoint `846613d4e` activated; matching native recovery reports
  no lost runs. Employee configuration and typed deletion journeys pass on the
  disposable instance. Dock overlap is fixed and desktop/mobile clicks pass.
- The earlier full UI regression passed 850 files / 9,440 checks. Subsequent
  slices have focused checks; this does not certify the unfinished M05 changes.
  The owner corrected
  the landing to one prominent dashboard screenshot, then requested the rounded
  overlay from the 11.06.25 AM reference in AgentOS colours. The charcoal panel
  and translucent frame are live; desktop/mobile and three landing checks pass.
- Account/profile qualification, actual provider identity, revocation/recovery
  and Models controls are implemented. Native evidence, runtime and UI checks
  pass; actual desktop/mobile Models empty-state acceptance passes. No production
  account has been qualified or model run launched by these checks.
  Comparative evidence is bound to its account/configuration/runtime and frozen
  standard task; review-only work cannot train implementation comparisons.
  Final checks: 42 host, 195 Runner, 13 UI; native identity metadata observed
  without inference. Integrated server/UI builds and loaded health pass.
- Activation exposed a regenerated migration that an earlier restart had already
  applied. Exact original `0391` SQL/hash/timestamp restored; additive `0392`
  applied normally. No data deletion or manual database-journal changes. Native
  recovery request `2026-11-06T22:26:37.601Z` completed with no lost runs.
  The disposable 3199 instance's superseded draft was reconciled through the
  existing native migration command; its fixture records are retained. Fresh
  migration/qualification checks pass all 11 cases; recovered landing checks pass.
- Local triage now rejects clipped questions before inference (11 checks pass).
  The original 12-case diagnostic failures remain valid; they do not qualify routing.
  OpenAPI discovery drift is corrected; all 27 catalog checks and 70 remaining
  contract checks pass.
  Real account, physical audio and business workflow acceptance remain open.
- Broader workspace regression remains incomplete. Initial concurrent failures
  are retained in `/private/tmp/agentos-workspaces-{b,c}-regression-20261107.log`.
  Isolated database checks (10) and the affected adapter cases pass except the
  Claude MCP prerequisite: installed CLI 2.1.126, test requires at least 2.1.207.
  Shared/skills checks passed 1,050 tests. Do not claim full backend regression.
- Packet-only review source/protocol checks pass; real account review and accepted
  output remain open. A04 owner-selected component publication is implemented:
  only reviewed text is copied into a locked destination document; original
  private references remain in the source audit. Source/destination authority,
  exact revisions, bounded previews and retry checks pass (13 database, 32 UI,
  27 API checks). Checkpoint `99277b71d` is active after native restart
  `2026-11-06T22:45:28.522Z`, with no lost runs. Desktop/mobile publication from
  an earlier saved file version passes: exact locked copy, source-only provenance,
  independent reviewer, destination link, duplicate-free retry and zero runs.
  Actual component implementation/release/recovery remains open.
  Browser evidence: `/private/tmp/agentos-platform-publication-browser-attempt6-20261107.log`
  and `agentos-platform-publication-browser-mobile-20261107.log`. Earlier fixture
  and selector failures are retained separately; no product guard was relaxed.
- **Not fixed — M05:** continued the saved working tree; earlier workers are no
  longer loaded. Native admission now claims the exact prepared assignment before
  selection, revalidates current authority/account/profile on dispatch and
  recovery, and refuses runtime/model substitution. Fixed the saved document API
  and audit-field mismatches. Native rows freeze an outcome outbox before SQLite
  delivery; historical selection lookup and idempotent replay cover either
  acknowledgement gap. Exact independent review remains distinct from exit
  success; public run responses omit private comparison provenance.
  Repair-iteration and end-to-end timing source now measures complete native
  provider-turn/finish histories and queue-through-independent-review latency,
  retaining failed attempts and inter-attempt delay without double counting.
  Provider turn IDs are distinct from the outer native invocation ID. Missing
  event identity, sequence continuity, terminals or timestamps remain null.
  Delivered context is **still unfinished** and prevents canary readiness. Pre-selection stops remain visible
  native gaps, with no invented receipt. No current account was run or qualified.
  SQLite schema **v3** retains v1/v2 records and protects nullable measurements
  from older readers; older package binaries must not open the upgraded store.
  **Checks:** 101 focused host/coordinator/redaction, 37 independent product/HTTP
  handler, 23 UI checks pass; server build, UI typecheck/build and token gates pass.
  The separate OpenAPI run has 27 passing catalog checks and four listener checks
  blocked by `listen EPERM`. PostgreSQL setup also fails with `listen EPERM`;
  its original six cases were skipped, and three added admission/outbox cases
  require that same unavailable boundary. These are not passing database tests.
  Process inspection is denied too, so no guarded restart or browser activation
  was attempted. Current source is uncommitted and not live-certified.
  **Next:** finish the actual context/resource receipts, run the twelve PostgreSQL
  preparation/admission/concurrent-delivery/recovery/privacy cases, verify native
  producer wakes and idle behavior with persisted work, then activate and verify
  the browser flow. Preserve the existing real-account and representative-corpus
  acceptance gates. Logs: `/private/tmp/agentos-m05-final-{tests,product,build}-20261107.log`,
  `agentos-m05-{native,focused,ui,ui-typecheck,ui-build,token-gates}-20261107.log`.
- **M05 accepted-context continuation:** native admission now freezes the full
  prepared execution digest. The Codex adapter emits instruction/input hashes
  only after the provider accepts its thread/turn; rejected requests retain the
  previous receipt. Recovery preserves the exact assignment/input. Delivery
  checks every provider turn against authenticated complete event history and
  records an initial-envelope match without copying private text. SQL projects
  only bounded identity/receipt fields; encoded/oversized metadata remains an
  explicit missing-evidence row. The new PostgreSQL projection case is authored
  but not executable under current restrictions. **45 host checks, 26 provider
  unit checks and the durable identity/recovery case pass; server typecheck
  passes after correcting a test fixture type.** Full provider integration ran
  102 passing / one failing / two ignored cases: the failing identity assertion
  had not included the new receipt field. Its corrected case passes separately;
  this is not a fresh whole-suite pass. Logs:
  `/private/tmp/agentos-m05-context-tests-r2-20261107.log`,
  `agentos-m05-context-tsc-r3-20261107.log`,
  `agentos-m05-provider-context-{regression,durable,integration}-20261107.log`.
  Provider implicit context and retrieved resources remain unbound, so
  `observedVariant` remains null and no canary is eligible. M05 stays Not fixed.
  The owner explicitly chose **“Keep the current restrictions for now”**;
  do not repeat the process/listener permission request or bypass the guards.
- **M05 tool-result continuation:** native result persistence is now distinct
  from the later successful provider transport write. Content-free actual-byte
  receipts bind original input/result/turn history, retain unknown acceptance,
  preserve failed/denied outcomes and do not multiply on exact replay. Settled
  results after turn closure remain undelivered. Receipt capacity is bounded;
  rollback must not open enlarged pending queues with an older Runner. Normal
  chats omit these audit-only informational receipts while retaining warnings.
  **74 host, 74 selected Rust backend, 12 provider-boundary, exact-byte/replay,
  73 app transcript and 14 package transcript checks pass** (overlapping counts).
  The broader initial Rust selection passed 97 and failed five: four ACPX port
  fixtures hit retained restrictions; the queue fixture omitted the new third
  receipt and passes after correction. A transcript test initially expected a
  warning from a surface that already omits diagnostics; the actual rendering
  adapter now verifies unchanged warning behavior. Logs:
  `/private/tmp/agentos-m05-tool-context-{host-final,backend,backend-r2,rust,replay,bytes,ui,ui-r2,browser-model}-20261107.log`.
  PostgreSQL receipt projection coverage is extended but unrun. Provider implicit
  context/retrieval and receipt acceptance/use remain unknown, so M05/M06 stay
  **Not fixed** and native canary readiness remains blocked.
- **Current combined verification — 7 November:** the current full UI suite passes
  **858 files / 9,486 checks**. The full Codex provider suite passes **103 checks,
  with two subprocess helper entries ignored by the parent invocation**; its
  parent tests exercise those helpers separately. This is the fresh suite after
  the earlier identity-assertion failure and new transport receipts. Targeted
  server/UI/Runner semantic checks, full Rust formatting, module boundaries,
  map structure and design-token gates pass. There is still no fresh full
  backend/database or whole-monorepo acceptance: retained loopback restrictions
  prevent isolated DB/HTTP fixtures and the canonical tsx migration check.
  Logs: `/private/tmp/agentos-current-ui-regression-r2-20261107.log`,
  `agentos-m05-tool-context-provider-final-20261107.log`,
  `agentos-final-{server-tsc,ui-tsc,runner-tsc,runner-fmt,modules,maps,token-gates,diff}-20261107.log`.
  Final server and UI builds also pass, including rebuilt Runner release assets
  and replay-golden/parity checks. Existing Rust dead-code/unused-import and UI
  chunk/MarkdownEditor warnings remain. Logs:
  `/private/tmp/agentos-final-{server,ui}-build-20261107.log`. No restart occurred.
  A browser skill/tool lookup could not expose the required browser-control tool;
  no browser/account state was read or changed. The requested owner Google
  sign-in/admin result remains unverified, without a repeated credential request.
- **7 November continuation checks:** 45 checks pass across measurement/outcome,
  private-mandate contracts/UI and migration snapshot drift. The same run's 11
  Friday database cases are skipped after fixture setup fails with `listen EPERM`;
  the suite is not a full pass. Separate native mandate discovery passes (one
  selected). Two new private-scope PostgreSQL cases also cannot start their
  isolated listener. No database-backed privacy or live activation claim is made.
  Logs: `/private/tmp/agentos-continuation-focused-20261107.log`,
  `agentos-private-mandates-{discovery,pg}-20261107.log`.
  The full `pnpm -r typecheck` attempt stops at the database migration check's
  tsx IPC `listen EPERM`; it is not a passing whole-repository check. Equivalent
  migration checks through `node --import tsx` and targeted compilation remain
  the applicable source evidence. Shared/database/server/UI typechecks and server/UI
  builds pass. UI build retains the existing large-chunk/MarkdownEditor import
  warnings. Design-token and module-boundary gates, map structure and six-team
  catalog validation pass. Logs: `agentos-continuation-{build,db-check,server-typecheck,ui-typecheck,token-gates}-20261107.log`.
  The existing PostgreSQL outbox case now asserts a fixed five-second failed
  attempt and immutable timing replay, while keeping missing iterations/context
  unknown; execution of that database case remains blocked.
- **Not fixed — O03/O07/O09:** explicit `owner_accessible_private` summary scope
  is implemented for current Friday only. It rechecks the exact mandate, owner
  rights/admin status and any external authorizer; old shared-only grants keep
  their scope. The first UI run exposed Save becoming available before agent
  choices loaded; fixed and 14 contract/UI checks pass on retry. UI, OpenAPI and
  coordinator/direct-chat instructions agree. Migration 0393 is generated;
  snapshots 0389–0393 and historical SQL/journal are retained. No live private
  grant or activation occurred. The next source slice adds bounded private task/
  project descriptions, comments, ordinary task documents and the owner's
  personal chats through the same exact mandate. Versioned Unicode body pages,
  no-store responses, protected native handling without plaintext artifacts and
  body-free audit are implemented. **24 contract/SQL/UI checks and four selected
  native checks pass; server semantic checks pass.** The initial UI copy assertion
  failed and passes after updating its expected text. An actual PostgreSQL case
  is authored but unrun under retained restrictions. Attached binaries, run/tool
  logs, task creation/delegation and live private access remain open. See the
  [updated mandate record](2026-11-06-agentos-portfolio-read-mandates.md).
- **Not fixed — C05:** the [full Supabase migration plan](2026-11-07-agentos-supabase-full-migration.md)
  is written. It includes PostgreSQL, the separate SQLite evidence store and its
  required independent PostgreSQL adapter/importer, file/key continuity, private
  API/connector access gates, rehearsal, measured cutover and lossless rollback.
  Read-only CLI confirms the linked AgentOS Sydney project. No data moved or
  remote permissions changed. Implementation/parity and rehearsal precede a
  concrete cutover approval; public hosting remains deferred.
- **Not fixed — M06, source checkpoint:** the independent SQLite owner now has
  immutable company/family policy revisions, bounded deterministic canary/control
  assignments, exact full-variant admission, complete outcome gates, automatic
  adoption and rollback, company pins/opt-out and restoration of a prior adopted
  version. Legacy observational scores no longer promote alternatives. Schema
  **v5** retains earlier records and reconstructs original observation deadlines;
  older binaries must not open an upgraded store. Native model-only preparation,
  committed policy audit/current owner gates, automatic qualified publication,
  frozen outcome delivery and company controls are now implemented. The shared
  worker wakes on committed changes and actual indexed deadlines, with no new
  idle polling. Native outcomes deliberately retain null observed variants while
  M05 implicit/retrieved context is unbound. No live company policy, canary or
  model inference was enabled; broader native prompt/context variants and real
  measured non-regression remain open.
  **Checks:** 53 independent-store/HTTP-handler tests, 92 host/UI checks and a
  separate overlapping 76-pass/one-skip native/worker suite pass. Actual SQLite
  restart, independent handles, a lock conflict and v4-to-v5 deadline migration
  are exercised. New PostgreSQL audit/revocation and two-acknowledgement recovery
  cases are authored but remain unrun under retained listener restrictions.
  Server/UI typechecks, server/UI builds and module/token gates pass. The first
  server build lacked Cargo on PATH; the explicit toolchain retry passes, including
  runner release compilation. Existing build warnings remain. Source details:
  [comparison/rollout evidence](2026-11-04-agentos-model-comparison-evidence.md).
  Logs: `/private/tmp/agentos-m06-{deadlines,host-ui-r2,native-delivery,server-build-r2,ui-build}-20261107.log`.
  Continue the native company-isolated task-creation/delegation boundary using
  the owner's clarification below. Runtime/database and genuine context/evaluation
  acceptance remain blocked or unfinished.
- **Other remaining work:** real owner + Friday → company CEO/department head →
  lead/specialist → independent review
  → accepted output, provider/business workflows, actual component release and
  independent recovery, physical microphone/reply/interruption, owner Google
  sign-in/admin acceptance and the current full backend/regression pass. Their
  individual next actions remain in the 93-item worksheet; no new list replaces it.
- **Owner clarification — company isolation:** work is never merged between
  companies. Friday has access to everything and everyone across the owner's
  companies; each task, project, assignment, workspace and execution remains
  owned by one company. Friday's portfolio visibility does not share private
  material or execution credentials with another company's employees. Multiple
  companies require separate company-owned work, not a shared task tree.
  This resolves the meaning of portfolio coordination; do not repeat the
  ambiguous “cross-company work” question. Implement delegation through the
  target company's native authority, budgets and applicable approval rules.
  Read mandates remain read-only; this clarification does not turn one into a
  write grant or waive an existing action approval. No task, agent message or
  model execution was started by this session.
- **Owner clarification — Friday's board role:** the owner and Friday act as the
  board for each company. Friday directs the company's CEO or department heads,
  sets outcomes/priorities/constraints, inspects evidence and reports back. Those
  executives own staffing, project leads, specialist delegation, execution and
  review. Friday never takes on company implementation or operational delivery.
  Reading records, recording board directions and presenting native views remain
  coordination. Custom deliverables are commissioned through company executives.
  This is a product role, not permission to substitute a board API actor. The
  coordinator catalog and direct-chat guidance now reflect it; enforcement and
  the real executive-to-team delivery journey remain open in O03/O04/R05.
  Fourteen existing chat/prompt checks and eleven catalog checks pass; six-team
  catalog, module and map validation pass. The chat selection excludes its 26
  database cases. Logs: `/private/tmp/agentos-friday-board-chat-20261107.log` and
  `agentos-friday-board-catalog-final-20261107.log`. No runtime activation occurred.
- **Company-isolation source continuation — O03/O07 remain Not fixed:** fixed
  the native parent guard so a missing/foreign company parent cannot pass task
  creation without workspace inheritance, reparenting or batch import. Parent
  checks repeat under the company tree lock before the write; row-lock order is
  retained, and ordinary parents within the same import batch remain supported.
  Updated direct-chat/coordinator instructions and rebuilt the six-team catalog:
  no merged company task trees or private cross-company handoff context.
  **Six service guard checks, 14 existing chat/prompt checks and 11 catalog
  checks pass; server semantic, module-boundary, map and catalog checks pass.**
  The chat selection excludes 26 database cases. Four new real PostgreSQL
  parent/create/update/import cases are authored but unrun under the retained
  restrictions; controlled dependencies do not prove locking or persistence.
  No restart, live permission grant, task dispatch or database mutation occurred.
  Logs: `/private/tmp/agentos-company-isolation-{guards-r2,chat,catalog,tsc-final}-20261107.log`.
  Next: implement the company-isolated board-direction handoff to each target
  CEO/department head through native authority, and qualify executive-led
  delegation, persisted privacy/concurrency and live operation when
  the existing environment blockers are removed. No repeated scope question.
- The designated owner’s interactive Google sign-in result has been requested;
  existing credentials are configured and must not be requested again.
- Cloud/public hosting and Higgsfield sign-in remain deferred.
- **Owner choices — 7 November continuation:** shared-seat concurrency should be
  as high as needed while preserving reliability and accuracy; qualify actual
  capacity and retain bounded admission, waiting and interactive responsiveness.
  Friday may access private information across all of the owner's companies,
  subject to current owner access and native authorization. Extend the existing
  read mandate explicitly; this does not grant private access to every employee.
  Prepare a **full Supabase database migration plan**. Planning is authorized;
  production cutover and data movement await the concrete plan. These choices
  replace the previously unanswered scope questions, not implementation proof.

The detailed sections below are historical reference, not additional checklists.

## Historical execution and acceptance — superseded by the checkpoint above

| Workstream | Required result | Current state |
| --- | --- | --- |
| Shared subscription capacity | Explicit account grouping, atomic shared admission, configurable concurrency, fair durable waits, interactive responsiveness and recovery through native execution | Source implemented and focused checks passed; real PostgreSQL/live activation remains. Owner's starting policy pending; no group configured. See [capacity evidence](2026-11-06-agentos-shared-execution-capacity.md) |
| Shared capability upgrades | Reviewed immutable publication, independent company adoption/refusal, effective native skill pins and rollback with audit | Source implemented and focused checks passed; native policy admission repaired during review; migration/database/browser/native delivery acceptance remains |
| Knowledge and reusable views | Explicit authorized conversation search, editable native routine relationships, useful saved live views | Source implemented; native routine/history/annotation privacy corrected; focused checks pass. See [knowledge evidence](2026-11-06-agentos-knowledge-routines.md). Generated-code promotion remains separate |
| Adaptive home suggestions (V10) | Introductory copy retires after interaction; suggestions reflect useful current work and user activity | Source implemented: voice/chat interaction dismisses intro; suggestions use current attention/work and authorized recent tasks. Sixteen focused checks, UI semantics and token gates pass; browser/audio acceptance remains |
| Graph and artefact provenance (G01/G04/A01) | Graph nodes/actions correspond to actual resources, permissions differ from observed reads/writes, and produced artefacts retain versions/provenance | Native record-backed graph and document/attachment histories exist. File access refresh failures now hide cached names/content/links, with seven focused checks passing. Complete operating coverage and live history acceptance remain open |
| Local System One qualification | Record real local-model behavior and failures on explicit tasks; promote only with qualified evidence | Offline 12-case diagnostic completed; every profile suggestion contradicted another answer and was rejected; no routing promotion justified |
| Landing screenshots | Current workspace, Agent Map and Decisions screenshots beside matching features | Browser/Chrome execution tool unavailable; reconnection requested |
| Backend activation | Native graceful restart, matching recovery report and retained runs; Google owner/admin behavior verified after activation | Graceful restart completed 7 November NZDT after process access became available; two pending migrations applied, health/recovery confirmed and no lost runs. Actual owner/admin sign-in remains unverified |
| Practical application acceptance | Navigation, loops, Decisions, Performance, admin, Google-only login, spheres and real voice in the running UI | Source checks previously pass; browser/audio and authenticated acceptance still open |
| Portfolio delegated authority (O03/O07/O09) | Explicit company grants and current owner intersection for portfolio coordination and employee awareness | Company-shared read mandates implemented and reviewed; focused checks pass. See [mandate evidence](2026-11-06-agentos-portfolio-read-mandates.md). Private scope question pending; no live grants. Cross-company write/delegation remains separate |
| Real EGM operating journey (A05/R05) | Friday → lead → specialist → independent reviewer → accepted output, evidence and reusable lesson | Frozen packet preparation and exact named-reviewer binding added. Actual packet-only execution, findings/resolution and the complete journey remain open |
| Durable operating and recovery proof (R01/R04/R05) | Actual delegation/tools/output are reconstructable; browser closure, Stop, resume and restart preserve ownership without duplicate effects | Native lifecycle and focused source checks exist; complete real operating/recovery journey remains open |
| Model-service learning and transport | Reviewed native outcomes, account qualification, controlled improvements/rollback and independent transport/upgrade/revocation proof | Existing package/handler checks; real operating and network acceptance remain open |
| Business/provider workflows | Existing/new app delivery, feedback repair, provider/tool access and performance collection | Qualification remains open; external live effects require their existing authority |
| Supabase operational storage | Implement the intended data workflow without silently migrating the local application database | Owner asked to specify events/metrics, generated files, or a planned full migration |
| Platform changes and recovery | Reviewed reusable-component promotion and eventual Friday platform-engineering/release workflow with independent recovery | Open; ordinary build work continues in this development session |
| Deferred stage | Higgsfield sign-in and public/cloud hosting with durable workers/storage/backup/recovery | Still explicitly deferred by the owner; this continuation does not silently activate them |

## Historical original interface and account requests

These rows preserve the earlier checkpoint, including statuses that have since
changed. Use the worksheet and Resume here section for current work. “Source
checked” means the recorded focused checks passed, not that the current running
application has passed the owner's final acceptance. Detailed evidence is in the
[fourteen-fix log](2026-11-04-agentos-platform-fixes.md) and
[navigation/voice/model log](2026-11-05-agentos-navigation-response-model-backlog.md).

| Request | Source status | Remaining acceptance |
| --- | --- | --- |
| Google sign-in only, correct callback, owner auto-approval/admin | Google-only UI, deployment password opt-out and verified-Google-owner provisioning implemented | Activate backend; sign in as the configured owner and test sign-out/sign-in; provider callback acceptance remains |
| Better waiting-list page and confetti | Thank-you copy, confetti and status-refresh behavior implemented and checked | Browser acceptance |
| New landing headline and feature copy | Copy changed; unwanted Whisper-powered positioning removed | Browser acceptance |
| Large reactive sphere right, centered copy left | Hero layout, hover/pointer motion and reduced-motion handling implemented and checked | Desktop/mobile visual acceptance |
| Current application screenshots on landing | Not delivered | Browser/Chrome capture access, inspect and add real current images |
| Artefacts as project files/folders and grouped saved research | Implemented and checked | Open actual file and saved research record |
| Working create/edit/save loops | Implemented; native project/parent relationships added in this continuation | Create paused loop, edit, save and reopen in running app |
| Performance `type` error | Malformed-data guards implemented and checked | Exact reported failure still unreproduced; browser retest needed |
| Matching map sphere/dot colors, no dark halos including Friday | Shared renderer corrected and checked | Visual acceptance |
| Collapsible Departments/Projects, correctly nested projects | Implemented and checked | Navigate/collapse both groups in running app |
| Stable bottom sidebar on Audit Trail | Viewport and scroll behavior corrected and checked | Browser acceptance on long content |
| Complete, faster audible Friday replies | Earlier playback, separate speech/transcription workers and warmup checked; interactive shadow wait removed here | Actual microphone, first-audio delay, completeness and interruption |
| Admin user edit/delete | Native actions exposed and checked | Inspect live controls; destructive acceptance only on a disposable account |
| Concise decision title/summary/actions and reversible expansion | Implemented and checked | Browser expand/collapse and real summary acceptance |
| Only eight starting connectors | OpenAI, Anthropic, Stripe, Higgsfield, Supabase, Vercel, Google and Calendly catalog checked | Live catalog acceptance; Higgsfield sign-in remains deferred |
| Friday self-diagnosis | Authorized, on-demand diagnostics implemented and checked | Ask live Friday to diagnose a company after activation |
| Model Intelligence route/task/outcome audit | Selected versus observed models, task cohorts, timing, shadow and review evidence implemented and checked | Activate and inspect real records; unknown quality remains unknown |
| Restart works | Native supervisor identity/retry fix and guarded helper checked; guarded local restart completed 7 November NZDT | Matching recovery report and healthy app confirmed with no lost runs; signed-in Restart button still needs browser acceptance |

## Execution evidence

- Starting revision: `6bb5ace83`, clean working tree. Local health returned
  `status: ok`, private authenticated mode, and healthy database backup status.
  The health Git SHA is checkout metadata, not proof of loaded backend code.
- `python3 scripts/restart-agentos-local.py --check` stopped before mutation:
  `[Errno 1] Operation not permitted: '/bin/ps'`. Native preflight is preserved.
- Browser/Chrome instructions were read, execution-tool discovery repeated and
  the plugin directory searched. No local Browser/Chrome control tool is exposed.
  No synthetic or older application screen is substituted.
- Standalone model HTTP test attempted in this session; child exited before
  readiness. Evidence: `/private/tmp/agentos-model-http-20261106.log`.
  An isolated socket probe confirmed `EPERM` on `listen` at `127.0.0.1`.
  This failure is not marked as transport acceptance.
- Integrated production UI build passed (2.51 seconds), retaining existing large
  chunk and mixed MarkdownEditor import warnings. Evidence:
  `/private/tmp/agentos-completion-ui-build-20261106.log`. Later UI changes still
  require their relevant checks; this is not a browser screenshot/acceptance run.

## Review corrections and pending choices

- Capacity recovery was initially attached to the existing periodic queue sweep.
  Review moved it to explicit startup and active-work events. A real heartbeat
  facade test verifies repeated idle resumes add no capacity scans.
- A queued execution now rechecks its original prepared AI account after both
  capacity and budget waits. Native membership, credential audience, installation,
  account identity, policy and secret generation must still match before dispatch.
- Capability adoption now uses the native skill-policy/platform owner for the
  actual import, update, edit, installation or rollback action. A create-only
  permission cannot be reused to overwrite an existing governed skill.
- Independent review also corrected approval/admin authority retained across
  mutation lock waits and cached capability evidence left visible after an
  authorization refresh fails. Current authority and readable evidence are
  checked separately; a prior successful read is not continuing permission.
- Routine relationships retain native revisions. Reads protect historical cycle
  scopes, annotation text and aggregate markers after a routine changes scope.
  Missing annotation provenance cannot be guessed from timestamps; historical
  annotation access requires complete readable scope history.
- The concurrency question was clarified: whether Friday can answer alongside
  a background agent on the same account. No answer/policy is inferred from time.
  Supabase data scope and Browser/Chrome access are also still awaiting input.
- A new question asks whether Friday's portfolio access includes owner-private
  work or only shared work plus explicitly shared private items. The current read
  mandate slice supports explicit company-shared scope without creating grants.

## Interactive response and local-model evidence

The native selection path awaited shadow inference before dispatch, potentially
adding its two-second deadline to a new conversation. Shadow results cannot
change that turn's route. Persisted native conversation identity now skips this
inference with reason `interactive_conversation`; ordinary admitted task shadow
evaluation remains. Selection, frozen request identity and audit persistence are
preserved. No extra asynchronous worker, copied transcript or model swap is added.
Fifty focused model-triage/native-selection checks pass:
`/private/tmp/agentos-interactive-triage-20261106.log`. This removes a source-level
wait, not a measured full-turn latency or physical audio acceptance claim.

`scripts/evaluate-local-triage.ts` now provides a repeatable offline diagnostic
using the actual pinned worker and native question/answer validation. It uses
twelve explicitly synthetic cases, writes only a new private report and never
inserts production learning outcomes. The installed model became ready in
4,461 ms; median observed inference was 528 ms. Against the authored diagnostic
labels, family matched 8/12, complexity 2/12, evidence availability 9/12, and
profile abstention 0/12. All twelve profile answers contradicted another answer;
native validation rejected every suggestion. The small authored corpus is not a
representative or independently reviewed production benchmark, and these results
do not qualify model choice, general quality or routing promotion.

Full report: `/private/tmp/agentos-laya-diagnostic-20261106.json`; log:
`/private/tmp/agentos-laya-diagnostic-20261106.log`. The initial root-level
`pnpm exec tsx` invocation failed because that executable is not exposed there;
the existing CLI loader ran the diagnostic successfully. Run it with the
workspace Node toolchain and `node --import ./cli/node_modules/tsx/dist/loader.mjs
scripts/evaluate-local-triage.ts <absolute-python> <absolute-model-directory>
<new-absolute-report.json>`.

## Current-account model qualification

Historical usage no longer makes an alternative model eligible for automatic
selection. Until the selected account is qualified, the native selector keeps
the operator-configured baseline and preserved sessions; stale queued automatic
alternatives require review. The saved audit explicitly records that access is
not verified. Twenty-eight focused checks passed; evidence prefix:
`/private/tmp/agentos-model-qualification-20261106.log`.

Official documentation checked on 6 November distinguishes an app-server model
catalog from confirmed access: with the documented ChatGPT plan configuration,
`model/list` may return a bundled catalog, while a completed inference confirms
that request's access. [Codex app-server documentation](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).
That sign-in flow has an account-specific catalog and requires refresh on account
switch. [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).
This is not evidence that AgentOS's installed credentials use that flow. No token
is moved to a different endpoint, authentication or billing path. Implementing
and observing current-account qualification remains open.

## Worksheet continuation and interface verification

The owner's continuation reference remains the original requirements worksheet,
with the same IDs. `AGENTS.md` now directs new sessions to that worksheet and this
checkpoint before resuming the next unfinished, unblocked item. Closing a session
or a Codex restart does not authorize recreating the backlog or repeating settled
questions. These updates are tracked as **F04/F05/L04**, **V10**, and **A01**.

- Original interface and sign-in checks: 154 passed (120 UI, 34 server). Logs:
  `/private/tmp/agentos-original-ui-recovery-checks-r2-20261106.log`,
  `/private/tmp/agentos-original-orb-performance-recovery-20261106.log`, and
  `/private/tmp/agentos-original-auth-recovery-20261106.log`.
- V10: 16 focused/integration checks passed at
  `/private/tmp/agentos-v10-tests-r2-20261106.log`. Intro state retains conversation
  scope; recent-task IDs are revalidated by native summaries before showing titles.
- A01: three access-refresh regressions first failed, then seven file/access
  checks passed after the fix, including retry and successful removal. Evidence:
  `/private/tmp/agentos-artifact-access-reproduction-20261106.log` and
  `/private/tmp/agentos-artifact-access-fix-final-20261106.log`.
- UI semantic checking, all token checks, map structure and whitespace pass.
  The initial root-directory UI test commands failed before executing tests
  because the config's relative setup file belongs under `ui/`; corrected runs
  from that directory passed. The initial `pnpm` command was unavailable on PATH;
  the existing workspace Node toolchain and Vitest shim were used.
- Real browser/audio, current landing screenshots and exact reproduction of the
  original Performance `type` exception remain unverified. Plugin discovery did
  not expose a controller capable of using the local authenticated Chrome app.

## Combined source verification — 7 November NZDT

Source checkpoint `4057682fd` is committed and pushed to `agentos/platform`.
The working tree was clean after push. Local health is healthy in private,
authenticated mode with healthy database backups. Its reported commit follows
the checkout and still does not establish loaded backend code or migration
activation. No live portfolio grant or capacity group was created.

Integrated shared build, database/server/UI typechecks, migration numbering/safety,
production UI build and design-token gates pass. Evidence prefix:
`/private/tmp/agentos-completion-`; final UI build is
`agentos-completion-ui-build-final-20261106.log` (3.45 seconds, existing large
chunk and mixed MarkdownEditor import warnings).

Migrations `0389_secret_scrambler.sql` and
`0390_tough_virginia_dare.sql` are generated and remain unapplied. Snapshot
retention is exactly `0386`–`0390`; historical SQL/journal entries remain.
Actual PostgreSQL locking/privacy/concurrency checks are not claimed: this
session cannot bind the isolated test listeners.

The final EGM preparation slice passed 35 focused owner/route/executor/content
checks. Catalog shipped-file checks (11) and its package artifact check (1) pass.
Both native runtime selection and common executor admission reject unsupported
packet delivery, including injected/direct backends. Receipt-bound clearing of
an unbound packet remains possible after author result submission while that
exact active run still owns the task. See the
[EGM execution audit](2026-11-06-agentos-egm-dispatch-audit.md) for exact logs and
the separate, still-open packet-only execution qualification.

The final module-boundary check initially rejected capability adoption's new
native configuration-transaction caller. That one workflow is now explicitly
registered with its atomic pin/configuration/decision/audit justification;
neighboring services and routes remain rejected. The gate and 11 checker tests
pass (`/private/tmp/agentos-capability-boundaries-final-20261107.log` and
`agentos-capability-boundary-tests-final-20261107.log`). The initial failure is
retained in `agentos-completion-boundaries-20261106.log`.

Verification stayed focused on the requested changes. A full repository build
and complete repository test campaign were not run; the owner requested practical
checks. Native listener/database tests blocked by this session, and the distinct
global forbidden-token check that rejects existing fork branding/local paths,
remain documented in the feature logs rather than being counted as passes.

Next required operator step was requested after the source became reviewable:
run `python3 /Users/dave/cursor-tutor-1/AgentOS/paperclip/scripts/restart-agentos-local.py`
from normal Mac Terminal and return its result. This session's `/bin/ps` denial
prevents the native restart preflight; no preflight bypass or force-kill was
attempted. The helper requires current native preparation and a matching healthy
recovery report with no lost runs. Browser capture/access remains independently
unavailable. The unanswered concurrency, portfolio-private-scope and Supabase
choices are still not approvals.

This source checkpoint did not itself close screenshots, backend activation, live
Google-owner/voice acceptance, current-account model qualification, packet-only
EGM, the real delegated/recovery journey, portfolio writes, provider business
loops, Supabase scope or privileged component/platform release workflows.

## Runtime activation — 7 November NZDT

The session's filesystem/process/network restrictions were removed. The existing
helper's read-only preflight then verified the launchd service, listener and
process ancestry. Running `python3 scripts/restart-agentos-local.py` through its
normal native preparation completed successfully. No preflight bypass was used.

The native service log records two pending migrations applied successfully,
followed by “Migrations already applied” and completed startup recovery.
The generated pending migrations were `0389_secret_scrambler.sql` and
`0390_tough_virginia_dare.sql`. The matching recovery report completed at
`2026-11-06T11:21:14.586Z` (7 November, 00:21 NZDT), changing server PID 59616
to 36929, with empty lost/missing-snapshot/skipped run lists. There were no
active runs at shutdown, so this proves idle graceful activation rather than
active delegated-work recovery. The helper correctly resumed the existing
same-boot pending request and matched its original request identity.

Evidence: `.runtime/tunnel/com.agentos.backend.log` and
`.runtime/instances/default/hot-restart-report.json` under the parent workspace.
Fresh health is OK in private authenticated mode with healthy database backups,
serving checkout `f17eb1d1b`. No capacity group or portfolio mandate was created.
The historical process/listener denials above describe the earlier restricted
session; they are not current blockers. Browser controller availability, actual
owner login, physical audio and the outstanding worksheet requirements remain
separate. Database/listener tests can now be attempted through their ordinary
isolated fixtures; their earlier failures are not retroactively marked passed.

## Implementation ownership

Native heartbeat admission/settlement owns subscription capacity. The company
skill/version and agent-configuration services own effective capability adoption.
Search retains native resource visibility; routines retain native revisions and
trigger ownership; saved views use existing authorized reads. Local model
evaluation must not write fabricated quality outcomes into production analytics.
Each implemented row needs focused checks and a clear source/runtime distinction.
