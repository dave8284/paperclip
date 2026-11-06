# Shared employee capability adoption — next implementation slice

Status: manual source implementation added on 6 November 2026; focused checks pass. Migration activation, real PostgreSQL concurrency and two-company runtime acceptance remain open.

Requirements O06/O05 distinguish shared reusable methods from private company knowledge and from automatic model-routing policy improvements. The smallest complete slice is manual publication of a reviewed Markdown skill release, followed by an independent company decision to adopt, refuse or roll back. Publication alone must never change another company's employee configuration.

## Existing native owners

- `packages/db/src/schema/company_skills.ts` and `server/src/services/company-skills.ts` own immutable company skill versions, snapshots, import/materialization and test-run records.
- `server/src/routes/agents.ts` owns current authorized skill selection/sync and configuration revisions. Extract reusable persistence under this owner rather than calling HTTP routes internally.
- `server/src/services/heartbeat/execution-configuration.ts` captures the exact skill versions for a run; `server/src/services/skill-version-retention.ts` protects selected and in-flight versions.
- Shared workforce records own the portfolio employee identity and company-local assignment. They currently have no release/adoption link.
- Current agent instructions are managed files/content tokens. Legacy instruction revision tables are upgrade inputs and must not become a new writing path.

## Concrete implementation

1. Add a narrow capability owner service, shared contract and additive migration. Keep immutable portfolio/employee release metadata, reviewed Markdown bytes/hash, and append-only company adoption decisions. Existing native permission grants remain the only authority store.
2. A portfolio owner publishes deliberately sanitized `SKILL.md` content, linked to an immutable native source version and reviewed evidence. Recipients receive the published content and sanitized evaluation summary; originating task transcripts, private evidence references and company knowledge remain private. The first slice excludes recursive repository copies, executable scripts and remote fetches.
3. Target-company admission checks the active shared assignment, the native company skill policy and target-agent configuration permission. Preserve the actual actor, responsible user and authorizing user. A shared identity grants no company access and must not substitute another company's agent or board identity.
4. Extend the company-skill owner with a transactional import primitive and extract authorized skill-selection persistence from its current route. Import the company-local immutable skill/version, select it and append adoption/audit receipts atomically under expected revisions and idempotency. Recording adoption metadata alone is insufficient.
5. Refusal appends a decision without changing configuration. Rollback selects an earlier imported immutable version and appends a new receipt. Neither operation changes another company's assignment or an in-flight run snapshot.
6. Provide release preview/history and adoption/refusal/rollback controls in Workforce, and matching native API discovery/maps.

## Gates discovered in source

- Ordinary version pins depend on `enableBetaSkills`. The implemented native selection owner now preserves the reserved capability-skill pins even when that experimental UI is disabled. A reviewed company adoption therefore never silently falls back to latest.
- A skill-test `succeeded` status records execution completion. Publication must retain separate reviewed acceptance evidence and must not label process completion as proven quality.
- Native forks are company-local; a portfolio release needs explicit sanitized publication and a target-company import, not a cross-company snapshot pointer.
- Any new authority/adoption transaction needs current membership/grant checks and concurrency/revocation review. Existing company-retirement tests do not certify this operation.

## Acceptance before closing O06

Two companies choose different releases of the same employee capability; refusal leaves selection unchanged; rollback restores the exact previous bytes; revoked/foreign actors fail; publication never exposes private source evidence; duplicate and stale requests are safe; audit failure rolls back import/selection; active runs retain their captured versions. Complete these through the real native API and runtime in a capable environment. Database/listener restrictions in the present session prevent claiming these results in advance.

## Implementation checkpoint — 6 November

- Added immutable release and company decision records in generated migration
  `0389_secret_scrambler.sql` (shared with the independent capacity slice).
  The migration has not been applied to the running instance.
- Publication requires a completed native test of the exact standalone
  `SKILL.md` bytes, retained output, explicit human acceptance and sanitization,
  and a concise deliberately shared evaluation summary. Source task IDs,
  company IDs, test IDs and output are excluded from release responses/audit.
  A completed process is not presented as measured skill quality.
- Workforce now previews the source skill/test and published releases, and
  provides per-company adoption, refusal, rollback and recent decision history.
  Release pages retain active versions outside the page; native selections,
  rather than the last 100 receipts, establish current selection. Older pages
  preserve earlier rollback choices and separately query prior adoption.
- The workforce owner revalidates native home/target authority under existing
  row locks. Native skill policy replacement/import share a transaction fence,
  including the previously absent-policy case. Native skill import, exact
  selection/config revision, company decision and audit share one transaction.
  No provider is called and no adoption is automatic.
- Scope is the owner's manual workflow and skills-capable Paperclip Runner
  agents. This does not complete delegated portfolio authority or automated
  employee improvement/evaluation.
- Eleven content/privacy/native-selection/mutation-authorization tests and eight UI/workforce cases pass:
  `/private/tmp/agentos-capabilities-contract-r2-20261106.log` and
  `/private/tmp/agentos-capabilities-ui-final-20261106.log`.
  Five additional real PostgreSQL/HTTP cases were authored in
  `server/src/__tests__/agentos-workforce.test.ts`; they have not run because
  this session cannot create the isolated listener. They cover two-company
  adoption/refusal/rollback, concurrent replay/stale intent, denied policy and
  revocation, existing-skill update/edit policy denial despite allowed create,
  and actual audit-failure transaction rollback. Physical runtime
  delivery, browser acceptance and concurrency proof remain outstanding.
- Independent review found that an initial implementation evaluated only
  `skills.create` when a later release also edits/updates an existing skill.
  The existing route admission was extracted into a shared native skill owner:
  platform containment and the legacy missing-grant exception remain unchanged.
  Import/create/install, existing update/edit/version-create/install, and
  pin-only reset now evaluate their actual policy resources and actions.
  The existing 63-case native skill route suite was attempted but all cases
  failed at listener setup (`listen EPERM: 0.0.0.0`), before behavior ran:
  `/private/tmp/agentos-capabilities-native-skill-routes-20261106.log`.
  The focused helper/operation denial tests pass; this does not replace that
  blocked route regression or the unrun PostgreSQL cases.
- Final server/UI semantic checks, token gates, map structure and whitespace
  checks pass. Logs: `/private/tmp/agentos-capabilities-tsc-r5-20261106.log`,
  `/private/tmp/agentos-capabilities-ui-tsc-r3-20261106.log`,
  `/private/tmp/agentos-capabilities-tokens-20261106.log` and
  `/private/tmp/agentos-capabilities-maps-20261106.log`. Earlier semantic checks
  exposed native snapshot/inventory typing mistakes, corrected before these
  final checks. No browser, provider or production database operation ran.

Independent review follow-up on 6 November:

- Board approval and current local administrator state are now re-read after
  native authority waits; cloud attestation/local implicit semantics remain
  native. Capability/source evidence is hidden after an authorization refetch
  failure, including retained React Query data.
- Native skill deletion returns an explicit retained-history conflict for
  publication sources and company adoption history. Soft deletion of a published
  test also conflicts before hiding its harness. Lazy missing-source cleanup and
  failed-fork cleanup retain immutable evidence. Publication and deletion fence
  the same source skill/test rows. No release/evidence is silently erased.
- Native company deletion already deletes assignments before skills; assignment
  cascade removes only that company's capability decisions first. Published
  source companies remain blocked before lifecycle work, with archive guidance.
  An additional real PostgreSQL regression covers the retained source and target
  deletion order; it is authored but not run in this sandbox.
- Two focused native retention guard cases and the mandate's two stale-account
  helper cases add source verification. Real lock-wait/revocation and native
  transaction proof remain pending a permitted PostgreSQL environment.
