# Model Intelligence

Independent local model-profile router, storage and authenticated HTTP API. Node 22.16+; no paid model calls or provider credentials. Can be packaged with `npm pack` and run separately with HTTP credentials (below), `MODEL_INTELLIGENCE_DB` and `npm start`. The listener stays on `127.0.0.1`; this package does not deploy a hosted service.

The host supplies only authorized, available subscription candidates. Existing tasks retain their recorded model; new complex or unenrolled work retains the configured baseline. Observational evaluations remain useful diagnostics, but cannot promote a profile. Automatic changes require an enrolled company/family policy, a complete controlled comparison, a bounded observed canary and versioned adoption. Unknown context, quality or resource evidence cannot qualify. The authorized host attests these observations; this package does not independently verify provider internals, reviewer independence or population-level improvement. It acquires no credentials and performs no model execution.

Embedded API: `createModelIntelligence(path)` → `select`, `evaluate`, `policy`, `analytics`, `close`. HTTP equivalents: POST `/v1/select`, `/v1/evaluations`, `/v1/policy`; GET `/v1/analytics?namespace=...`. Require `Authorization: Bearer ...`. The legacy HTTP token is an all-namespace operator credential. Optional host credentials bind each token to exact namespaces; every endpoint enforces that boundary before reading or writing storage. Agent OS enforces native company access at its embedded integration boundary.

Receipt and evaluation IDs are idempotent; mismatched reuse fails. Release rollback restores a prior eligible adopted version or the configured baseline for new work, preserving active pins. A separate profile block prevents continuation with that profile. SQLite owns durable receipts, evaluations and policy history. The service neither changes agent instructions nor executes tasks. The caller must revalidate admission, account capacity and permissions immediately before execution.

## Standalone HTTP credentials and namespace authority

Configure at least one credential mode before starting the process:

- `MODEL_INTELLIGENCE_TOKEN`: preserves the existing all-namespace operator credential, including aggregate analytics when `namespace` is omitted. Keep it within the service operator's trusted environment.
- `MODEL_INTELLIGENCE_HOST_CREDENTIALS`: a JSON array of `{ "id": "agentos-host", "token": "<random secret>", "namespaces": ["company-id"] }` entries. This mode works without an operator token. Credentials authorize all existing and comparison methods within their listed namespaces; they are trusted host credentials, not browser/end-user sessions.

Tokens must be 32–512 printable, non-whitespace ASCII characters; generate them from cryptographically random bytes. Host IDs and tokens must be unique, including against the operator token. Host lists are limited to 100 entries, 100 distinct namespaces per host, and 1,000 total namespace grants; environment JSON is capped at 512 KiB. Empty scopes and `*` are rejected. Namespace strings retain exact case and whitespace semantics: there is no wildcard expansion, prefix matching or normalization. Malformed configuration fails startup with a generic error, before storage/listener creation, without including credentials or JSON fragments. Matching compares fixed-size SHA-256 credential digests with `timingSafeEqual` across all configured entries.

Every scoped request must explicitly name one allowed namespace. Missing namespaces produce 400, foreign namespaces produce 403, and invalid/missing credentials produce 401. Reads use query parameters; writes use the top-level JSON `namespace`. Repeated query parameters, duplicate top-level JSON fields (including escaped aliases), and query parameters on writes are rejected before store access. GET bodies are not accepted. These rules prevent a query/body conflict from silently choosing a namespace. Responses disable caching. Request bodies are bounded at 64 KiB, or 128 KiB for the up-to-100-case dataset registration endpoint.

| Method and path | Namespace and operation |
| --- | --- |
| POST `/v1/select` | JSON namespace; existing selection receipt |
| POST `/v1/evaluations` | JSON namespace; existing observational evaluation |
| POST `/v1/policy` | JSON namespace; existing profile block/restore policy |
| GET `/v1/analytics?namespace=...` | Query namespace; omission permits aggregate reads only for the operator credential |
| POST `/v1/datasets` | JSON namespace; `registerDataset` |
| POST `/v1/comparisons` | JSON namespace; `registerComparison` |
| POST `/v1/comparison-outcomes` | JSON namespace; `recordComparisonOutcome` |
| GET `/v1/comparisons/report?namespace=...&comparisonId=...` | Explicit query namespace and comparison ID; `comparisonReport` |
| POST `/v1/routing/policy` | Revision-checked company/family enrollment, opt-out or adopted-version pin |
| POST `/v1/routing/releases` | Idempotent publication from eligible evidence under the current enrollment |
| POST `/v1/routing/rollback` | Withdraw a release while retaining history and active pins |
| POST `/v1/routing/outcomes` | Exact originating selection, observed variant or null, reviewed quality and measurements |
| GET `/v1/routing/rollouts?namespace=...&taskType=...` | Company/family policy, latest 20 releases and 100 audit events |

Changing or revoking credentials requires a process restart; there is no background credential polling or hot reload. Already-admitted requests may finish during graceful shutdown. A replacement configuration can retain existing namespace data while denying removed credentials. Never send these host/operator tokens to browsers or put them in source control. This boundary authenticates host access to stored namespaces; it does not independently authenticate evaluation provenance or certify a hosted multitenant product. Hosted TLS, rate limits and tenant lifecycle/retention remain separate work.

The actual async request handler is exercised in process using streams and real SQLite. Its focused tests cover operator compatibility, host-only mode, all endpoint boundaries, duplicate/ambiguous namespaces, policy/evidence isolation, credential replacement, malformed configuration, body bounds and split UTF-8. Real loopback listener tests also verify v1-to-v2 storage upgrade, retained evidence, exact namespace denial, and removal/replacement of host and operator credentials across process restart. These listener checks pass from an independently packed and extracted npm artifact. They do not qualify public hosting.

## Controlled comparison evidence

The same embedded instance also provides `registerDataset`, `registerComparison`, `recordComparisonOutcome` and `comparisonReport`; their contracts are exported in `src/index.d.ts`. The namespace-gated HTTP routes above call those same methods. They use separate SQLite tables and do not insert legacy `evaluate` records. A complete report may publish a canary only under an enrolled versioned policy; the report alone never grants execution.

1. Register an immutable, namespaced dataset version with task-family/version, routine or complex risk class, observed/synthetic provenance and 1–100 cases. Each case declares a training/holdout split, SHA-256 input and acceptance-check digests, and a host-controlled source reference. Store raw inputs and check artifacts in the host's protected storage.
2. Freeze a comparison before selecting its runs: baseline/candidate subscription profiles, model version and effort, harness/prompt/context fingerprints, one changed dimension (`model`, `prompt` or `context`), and explicit thresholds. Model comparisons retain the provider and harness; prompt/context comparisons retain the model profile. Renaming a profile alone is not a measured model change.
3. Select and execute both arms through an authorized host, recording every attempt in consecutive order with a distinct selection receipt. The package performs no execution. Record the matching case/check digests, actual variant as observed by the host (or `null` when unknown), provenance, pass/fail/cancelled/unknown result, terminal state, iterations, measured latency (or `null`), evaluator and evidence reference. A passed attempt is terminal; failed attempts can be terminal or followed by a bounded retry, up to ten attempts. `iterations` means model work/repair iterations within that attempt, or `null` when unmeasured; the host includes all attempt overhead in latency. Preserve more detailed transport/tool/verification accounting in the referenced host evidence.
4. Read the report. Every frozen holdout case stays in its quality denominator, including failures and missing results. Attempt costs are summed before comparing the same accepted pairs. First-pass success requires the first recorded attempt to pass with one work/repair iteration. A candidate regression on any baseline-passed case, including first-pass success, blocks readiness. Training overlap is checked by input digest across registered dataset versions within the namespace. Registering later training exposure can invalidate an earlier report.

All four thresholds are required and immutable for the comparison: `minimumHoldoutPairs` (5–100), `qualityLowerBound` (at least 0.7), `maximumMedianIterations` (1–2), and `minimumLatencyImprovement` (at least 0.15, below 1). The same minimum applies to both the frozen holdout count and paired accepted outcomes. The quality score is the existing Wilson formula with `z=1.28`; it is a deterministic policy heuristic, not a validated confidence claim about independent population samples. Thresholds can be stricter, and suitable case counts remain the host's evaluation-policy responsibility.

`eligible_for_canary` means the registered, host-attested evidence passes these bounded checks. Every report includes `evidenceTrust: "host_attested"`, `productionImprovementProven: false`, blockers, full attempt history, first-pass/final acceptance and failure counts, and limitations. Synthetic evidence, training-only data, incomplete pairs, unknown/cancelled outcomes, unobserved execution dimensions, missing resource measurements (including null iteration counts), blocked profiles and complex work cannot qualify. This API cannot detect omitted executions, verify reviewer independence, prove the provider's actual model, establish representativeness/time separation, or detect unregistered training overlap. It does not perform a canary or grant execution access.

Dataset versions, comparisons and outcomes are immutable and idempotent, including equivalent JSON object-key order; conflicting reuse fails. Outcomes bind same-namespace selection receipts created after comparison registration. Each receipt can support one comparison attempt. Reports read a consistent SQLite transaction and apply current profile block/restore policy. Schema v5 retains earlier audit records, nullable measurements and versioned rollout history. Its additive v4 upgrade reconstructs indexed observation deadlines without changing their original expiry. Older binaries (including v3/v4) must not open the upgraded store; unknown future schemas fail closed. Back up the SQLite database using SQLite's consistent backup mechanism, including WAL state where applicable.

See [the implementation checkpoint](../../doc/plans/2026-11-04-agentos-model-comparison-evidence.md) for limits and focused verification.

## Agent OS host

Set `AGENTOS_MODEL_INTELLIGENCE_DB` to an absolute private SQLite file path in the server environment. Agent OS creates its parent directory and embeds this package without a network round trip. Leave it unset to retain existing configured-model behavior without learning. The standalone HTTP process is optional; do not expose its operator or host tokens to browser code. Embedded callers remain responsible for native company authorization; HTTP namespace credentials do not alter Agent OS permissions.

The native run saves the selection request before calling the product, revalidates retained candidates on retries, and carries the request and receipt through lifecycle checkpoints. Additional observed models do not change a queued request. New retry runs receive new receipts while retaining their task pin. Native subscription entitlement, permissions, capacity and execution remain authoritative.

After managed-account preparation, a selected native run records an account access observation from at most its employee's 100 most recent started executions. Matching requires the same company, subscription, grant/user/credential epoch, native requested model and completed subscription usage with output. A newer matching failure or unfinished execution prevents an older success from being reported. The observation retains its evidence run/time and never claims current entitlement, actual provider model identity, answer quality or eligibility for automatic alternatives. Missing or unavailable evidence stays explicit; no provider inference is triggered.


### Native comparison admission and outcome delivery (source checkpoint)

The embedded host can discover immutable records through `comparisonCatalog` and
`comparisonDefinition`, and recover a historical selection with
`selectionReceipt({ namespace, receiptId })`. The latter is a read, including
when current policy blocks new execution. These methods do not grant authority
or add public HTTP endpoints. A `comparisonBinding` on a selection names one
frozen case/arm; it cannot use an alternative candidate or train observational
routing. Both its host candidate and frozen comparison profile retain block policy.

AgentOS prepares a locked pointer on a fresh native task; private source/account
provenance stays in source-scoped audit and server-owned execution state. Native
admission rechecks owner, employee, source, task, account, executable and profile.
Only exact independent native reviews can supply accepted/rejected quality.
The existing run row freezes outcome delivery, including store-commit/acknowledgement
recovery. Execution terminal events, accounting settlement and native review
resolution wake the shared coordinator. Waiting on review/accounting does not
create a recurring scan; an undelivered frozen outcome retains its retry duty.

This source checkpoint is not live qualification. Complete authenticated histories
measure provider turns/repairs and queue-through-review latency. Accepted provider
instruction/input hashes are bound to frozen preparation, but implicit and retrieved
context remains incomplete: actual variants stay null and readiness is blocked.
Native tool-result receipts separately identify bytes successfully written to the
provider transport, matched to original calls and outcomes. They do not establish
provider acceptance/use or unobserved retrieval. Missing delivery remains explicit.
Stops
before selection retain a native unknown gap instead of a fabricated receipt.
Current source checks and blocked PostgreSQL/listener acceptance are recorded in
[the completion ledger](../../doc/plans/2026-11-06-agentos-completion-ledger.md).


## Versioned company routing (source checkpoint)

Policies are revision-checked, immutable and scoped to one namespace/task family.
`off` retains the configured baseline; `automatic` considers complete new evidence;
`pinned` selects only a specified adopted release. Complete comparisons publish
once on evidence/enrollment changes. Retrying a withdrawn comparison cannot erase
its history or start another trial: it needs fresh comparison evidence. A successor
uses the adopted variant as its baseline, retains the original root baseline and
can roll back to the previous adopted version. Native integration currently supplies
model-only alternatives with unchanged prompt/context/effort.

Canaries deterministically sample 1–10% of fresh task identities and a matching
control cohort. Frozen dataset inputs, repeated task/input identities, unavailable
full variants and complex work cannot become samples. Outstanding observations
are bounded by policy. Every originating selection has one immutable observed
outcome; retries cannot overwrite a failure. Adoption needs complete candidate and
control samples, quality/non-regression and latency floors, with no pending samples.
Ongoing observations retain a bounded rolling window. Unknown dimensions/resources,
candidate failures, expired observations, withdrawn baselines and regressions roll
back new work. These gates describe host-attested evidence, not universal reliability.

The product owns no maintenance timer. `subscribeRoutingWork`,
`nextRoutingDeadline` and `reconcileRoutingDeadlines` let the host use its existing
lifecycle. Deadlines are indexed durable obligations, reconstructed after restart;
retired or observed work has no timer. The native host uses the shared coordinator,
terminal/accounting/review producers and a frozen run-row outcome outbox. Historical
selections and either acknowledgement gap replay without reselection or duplicate
outcomes. Native dispatch additionally requires the exact committed policy audit
and the configuring owner's current authority. A SQLite-only write cannot enable it.

Settings → Models exposes enrollment, pins, rollback and bounded history to current
company/instance administrators. No policy was enabled in a live company during
implementation. PostgreSQL, native activation and live accepted-work verification
remain separate; the current M05 context gap keeps native canaries ineligible.

## Offline migration inventory

The separate `@agentos/model-intelligence/migration-manifest` export inventories
an existing, consistent schema-v5 SQLite backup. It never opens the runtime store
through its writable factory, upgrades/checkpoints it, or moves data. Supply a
standalone rollback-journal backup without WAL/SHM/journal sidecars. Preparing that
consistent backup remains an operator step; this command cannot establish that a
live database is quiescent. Do not point it at the live store.

From the AgentOS repository root:

```sh
node scripts/agentos-model-backup-manifest.mjs --inspect /path/to/offline-backup.sqlite /path/to/new-manifest.json
node scripts/agentos-model-backup-manifest.mjs --verify /path/to/offline-backup.sqlite /path/to/new-manifest.json
```

The new manifest is private (mode 0600) and never overwrites an existing file.
It retains the source file/schema identity, all twelve tables' counts/content
digests and exact signed 64-bit rowid bounds. Typed row framing preserves nulls,
integer precision and stored JSON text, including original pending deadlines.
It contains no row payloads, namespace IDs or source paths. Whole-file identity
and metadata are checked before and after the snapshot; source changes, unknown
objects/versions, integrity errors and configurable row/value limits stop output.
Exact verification also detects manifest tampering. Initial defaults are one
million rows and 2 MiB per value; programmatic operator calls can set explicit
bounds. Inventory work scans all rows and belongs in an offline process, never
the live server request loop.

This is an integrity inventory, not PostgreSQL adapter/importer parity, a restore
test or cutover approval. No production data is exported by the fixture tests.

## PostgreSQL migration staging

`@agentos/model-intelligence/migration` exports the inventory functions,
`createPostgresMigrationTarget` and `importModelIntelligenceBackup`. The latter
two are asynchronous operator tools. The caller supplies a postgres.js connection
to an explicitly approved isolated destination and retains its destination UUID
for every retry. Neither function reads credentials, changes runtime configuration
nor enables a database switch. The existing SQLite runtime API remains unchanged.

```js
const destination = createPostgresMigrationTarget(approvedSql, {
  destinationId: savedDestinationId,
});
await destination.initialize();
const report = await importModelIntelligenceBackup(offlineBackup, manifest, destination);
// report.state === "imported_unaccepted"; report.runtimeEnabled === false
```

Initialization owns only the new private `agentos_model_intelligence` schema.
Existing incompatible schemas or destination identities fail without replacement.
The versioned SQL is in `src/postgres-migrations/0001_model_evidence_v5.sql`;
do not edit it after a destination has applied it. PostgreSQL stores exact JSON
text, explicit signed 64-bit source rowids, primary/unique identities and the
original deadlines. UTF-8 and C text collation preserve the source's text semantics.
Public schema access, including `anon`/`authenticated` access, blocks import.
Other credential/connector grants and the Supabase Data API settings still require
the migration plan's separate preflight; schema checks do not certify them.

Import binds the verified source manifest and destination marker. Its bounded
batches (at most 250 rows, default 8 MiB) commit data and progress together.
Rows already present must match exactly; conflicting history is never overwritten.
Unknown commit acknowledgements are recovered by rerunning with the same identities.
Only confirmed serialization/deadlock rollbacks receive automatic retries, capped
at three attempts. Cancellation takes effect between batches; an in-flight batch
can commit and remains recoverable. Completed replays read and verify without
reinserting records or resetting sequences.

The importer verifies every destination table's full ordered content hash and
row count under table locks before advancing sequences and recording
`imported_unaccepted`. Source changes stop finalization. Final reads inspect cell
lengths before transferring rows, limit each cell to 2 MiB and normally load at
most 8 MiB per page (one larger multi-column row may occupy a page alone). The report does not
establish report/selection parity, live PostgreSQL compatibility, restore or
cutover acceptance. Six importer checks use real SQLite and an
independent controlled destination; two transaction-error checks exercise the
actual target wrapper. Ten actual PostgreSQL cases are authored in the native
integration suite but remain unrun in this session, which denies both listeners
and standalone PostgreSQL shared-memory creation.

## Explicit PostgreSQL runtime

`@agentos/model-intelligence/postgres` exports an asynchronous runtime factory
and separate operator activation/revocation functions. SQLite retains its
synchronous public API. Both drivers execute the same selection, comparison and
rollout policy programs; each public operation commits its evidence and derived
changes together. Commit notifications run afterward. Internal int64 ordering
values remain exact; public counters reject unsafe numbers instead of rounding.

After the migration rehearsal has been reviewed, an operator can call
`activatePostgresModelIntelligence(sql, { destinationId, activationId, manifest,
acceptanceRef })`. This re-verifies the complete import under locks before
recording a separate activation in `0002_runtime_activation.sql`. The reference
locates the actual external review; supplying a string does not prove review.
Importing and opening never invoke activation. Retain the same identities for
replay. An active destination rejects further import operations. Revocation stops
subsequent writes after admitted transactions finish; replaying old acceptance
cannot reverse revocation.

Open with `await createPostgresModelIntelligence(sql, { destinationId,
activationId, manifestSha256 })`. Await storage methods and `close()`;
`subscribeRoutingWork()` still returns its unsubscribe function synchronously.
The caller owns TLS, credentials, connection timeouts, pool size and `sql.end()`.
Closing the store drains admitted operations without ending the caller's pool.
Opening and every operation check accepted identities and private schema access.
The HTTP handler awaits results and errors before sending an acknowledgement.

Namespace mutations serialize through transaction advisory locks; different
namespaces can proceed independently. Deadline reconciliation takes the matching
global lock. Reports use repeatable-read snapshots. Statement/lock waits are
bounded, only confirmed deadlock/serialization rollbacks retry (three attempts),
and unknown commit acknowledgement failures are returned without automatic replay.
Driver errors expose no connection details, SQL or payload values.

AgentOS initializes this factory explicitly during startup and closes its
separate shared-client pool during shutdown. Its native consumers await results
before saving delivery acknowledgements. Scheduled deadlines are refreshed only
by existing reconciliation, with no remote query in synchronous scheduler reads.
See [host configuration](../../doc/DEVELOPING.md#model-intelligence-storage).
The standalone `start` command still uses SQLite; hosts can supply their own
connection to the asynchronous factory. No new dependency is required by the
embedded package. Independent SQL writers or multiple runtime replicas still
need an external notification/recovery contract before production use; local
commit subscriptions alone do not cover them.

Four real-SQLite asynchronous policy checks cover shared rollout behavior,
rollback, suspended input mutation, shutdown and int64 ordering. Four controlled
driver checks cover activation, delayed commits, bounded retries and safe errors.
These checks do not establish real PostgreSQL SQL/locking/performance parity.
