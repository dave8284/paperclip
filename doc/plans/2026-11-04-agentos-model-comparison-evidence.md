# Model Intelligence controlled-comparison checkpoint — 2026-11-04

Owner: independent `packages/model-intelligence`. This implements a bounded portion of M05/M06 in [the product plan](2026-10-27-agentos-model-intelligence.md). It does not complete live qualification, held-out production improvement, canary release or automatic adoption.

## Implemented contract

| Embedded method | Persisted contract |
| --- | --- |
| `registerDataset` | Immutable namespace/dataset/version; task-family identity/version; routine/complex class; declared observed/synthetic provenance; 1–100 distinct cases with training/holdout split, SHA-256 input/check identities and protected source references |
| `registerComparison` | Frozen dataset version; baseline/candidate subscription profiles, explicit model version/effort and harness/prompt/context fingerprints; exactly one varying model/prompt/context dimension; immutable quality/resource/sample thresholds |
| `recordComparisonOutcome` | One immutable attempt per same-namespace selection receipt; exact frozen input/check/variant binding; host-observed variant or explicit observation gap; declared provenance; passed/failed/cancelled/unknown; terminal state; iterations/latency; evaluator and evidence reference |
| `comparisonReport` | Transactionally consistent full case/attempt history; first-pass/final acceptance and failed-attempt counts; bounded readiness checks and explicit limitations; current block/restore policy |

The comparison freezes a SQLite selection-sequence cutoff, so a receipt created before registration cannot qualify even if wall-clock timestamps match. Consecutive attempt numbers, unique receipt binding, immutable outcome IDs and terminal history prevent overwriting registered failures or reusing one execution as several samples. Canonical JSON identity makes retries with reordered object keys idempotent. Dataset mutation requires a new version; comparison mutation requires a new ID. All history remains namespaced, and SQLite schema v2 additively preserves the v1 audit.

Both arms use the same frozen cases and acceptance checks. Model comparisons may vary model/version/effort and associated profile identity; provider, subscription funding, harness, prompt and context remain fixed. Prompt and context comparisons retain the remaining dimensions. A renamed profile without a changed model configuration is rejected.

Every frozen holdout case remains in the denominator. Missing or unterminated arms block readiness. Retries retain failed evidence and add to the case's total latency/iterations; success never replaces a failure record. First-pass success requires the first recorded attempt to pass with one work/repair iteration. Candidate loss of either first-pass or final success on a baseline-passed case blocks readiness. Latency compares the same paired accepted cases, including failed attempts before acceptance. Training-only or synthetic evidence, registered training exposure, unknown/cancelled outcomes, missing observations/latency, policy-blocked profiles and complex work remain ineligible.

The caller must configure all thresholds: minimum frozen and accepted holdout pairs (5–100), quality score floor (>=0.7), maximum median iterations (1–2), and minimum latency reduction (>=15%, <100%). Existing policy floors cannot be weakened. The quality score reuses the existing Wilson formula with `z=1.28`. These are conservative software gates for the registered sample; the package does not assert statistical independence, a universal sufficient sample size, or population-level confidence.

## Evidence authority and limits

Only an authorized host should call the embedded API. Namespace separation does not authenticate a caller. The host owns data access, execution admission, provider/account capacity, iteration accounting, evaluator independence and complete delivery of outcomes. Source/evidence references and hashes identify protected host artifacts; the package neither retrieves nor independently validates those artifacts. Host-reported model version/effort and actual prompt/context fingerprints remain attested observations, not provider-certified facts.

Reports explicitly return `evidenceTrust: "host_attested"` and `productionImprovementProven: false`. `eligible_for_canary` means the registered evidence meets the configured gates and can be considered by the host's canary policy. It does not assert that a canary ran or independently verified production improvement exists. Missing executions, pre-registration cherry-picking, unregistered training overlap, data representativeness and time separation remain outside this layer's observable boundary. The host must resolve those before treating any result as causal evidence.

At the original 4 November checkpoint, comparison outcomes stayed separate from observational `evaluate` records and could not activate a route. The 7 November continuation below replaces the legacy observational promotion path with explicit versioned enrollment. The independent package still has no Agent OS runtime dependency.

## Verification

Canonical Node 24.22.1, actual temporary SQLite files and in-memory SQLite:

```sh
node --test packages/model-intelligence/src/index.test.mjs packages/model-intelligence/src/comparisons.test.mjs
```

24 tests pass, covering immutable/canonical idempotency, restart and v1 upgrade, unknown future schema rejection, namespace/receipt/case/variant binding, pre-registration receipts, mixed dimension/funding rejection, configured stricter thresholds, synthetic/training/unpaired evidence, cross-version training exposure, preserved failure/retry costs, first-pass/final regression, unknown measurements, adversarial resource arithmetic, policy block/restore, and absence of routing activation from comparison records. Fixture outcomes are synthetic test data exercising logic; they demonstrate no actual model improvement.

Only lightweight package tests and syntax checks were run for this slice. HTTP listener tests were not rerun: no HTTP changes were made, and this session's listener restrictions were already established. No live evaluations or production trials were performed.

## Remaining M05/M06 integration

Native source now freezes prepared execution and consumes accepted thread/turn
input hashes from the provider adapter. Each turn needs an authenticated receipt;
recovery cannot replace it, and a rejected request cannot become delivered
evidence. The initial model-envelope digest is compared independently of JSONB
key order. Run-log projection excludes prose/tool bodies and bounds metadata;
oversized/encoded records fail closed without disappearing from the history.
These are partial context observations: implicit provider context and retrieved
resources remain unverified. They cannot populate `observedVariant` or qualify a
canary. Source checks and retained sandbox limits are in the completion ledger.

The next continuation separately records native semantic-tool result transport.
The provider adapter hashes the actual serialized result and records its byte
count only after the pipe write succeeds. A rejected write cannot replace the
last receipt. Native state preserves a separate diagnostic receipt after the
earlier semantic outcome; settling a result after its turn closed does not invent
a provider delivery. Exact replays retain the original receipt without consuming
more event capacity. The bounded regular queue now allows three receipts per
call (input, result, transport write); terminal reserve and total state bounds
remain enforced. Older Runner binaries must not read newly enlarged pending
queues; drain/check compatibility before rollback.

Host evidence matches each receipt to authenticated complete input/result/turn
history. It preserves native business outcome separately from transport error,
rejects mismatched/duplicate/after-turn receipts and retains missing deliveries.
SQL projects only bounded receipt fields. Provider acceptance/use, provider-owned
retrieval and implicit context remain unknown; these partial writes still cannot
populate an observed variant. Audit receipts remain in logs, with no added normal
chat messages. Existing warning/error rendering remains unchanged.

The 8 November source follow-up requires accepted input receipts before their
provider turn starts. Late receipts cannot backfill evidence, and session receipts
after run termination fail closed. Seventy-eight focused host checks and server
semantic checks pass. This improves receipt integrity; implicit/retrieved context
and actual provider acceptance/use remain unknown, so native canary readiness
stays blocked.

Current focused checks: 74 host, 74 selected Rust backend, 12 provider-boundary,
exact-byte/replay checks, 73 app transcript checks and 14 package transcript checks
pass. These counts overlap. A wider initial Rust selection passed 97 and failed
five: four ACPX fixtures could not reserve loopback ports, while the fifth queue
fixture needed the newly required third receipt and passes after correction.
The first app transcript assertion targeted a consumer that already omits all
harness diagnostics; moving it to the actual diagnostic-rendering adapter passes.
PostgreSQL projection coverage was extended but remains unrun. Full current
provider/UI results and builds belong in the completion ledger after completion.

- Native preparation/admission and an immutable run-row outcome outbox are wired in source as of 7 November; current checks and socket-blocked PostgreSQL acceptance are in the completion ledger. Native measurement source now counts provider turns and distinct repair submissions from complete authenticated histories, and queue-through-review latency across preserved failed attempts. Incomplete histories/timestamps remain null; delivered context is still incompletely bound. Arbitrary caller labels must not become independently verified observations.
- A representative, authorized and sanitized task corpus, versioned checks, protected artifact lifecycle, time-separated held-out work, evaluator calibration and explicit missing-evidence handling.
- Bounded offline execution and shadow/canary trials using existing native admission and budget ownership; genuine held-out results and drift/rollback evidence.
- Versioned adoption/rollback and authorized HTTP contracts are implemented in source below; persisted native and live acceptance remain open.

## Versioned rollout continuation — 7 November

The independent package owns immutable company/task-family policy revisions,
qualified comparison publication, deterministic fresh canary/control assignment,
bounded outstanding observations, adoption, company pins/opt-out and rollback.
New tasks default to their baseline without enrollment. Observational evaluations
cannot promote models. Complete variants, independent quality, repair counts and
end-to-end latency are required; missing observations or expired deadlines roll
back. Existing task pins preserve their original receipt/version. Restoring a
parent release rechecks the current policy, rather than reviving withdrawn scope.

Schema v5 additively retains earlier audit records and original pending deadlines.
SQLite transactions, canonical idempotency and policy revision checks cover
restart, conflicting writes and retries. Deadline work is indexed and bounded;
the product owns no timer or host runtime dependency. Authorized standalone HTTP
routes are namespace-gated. The host subscribes to committed work changes and
provides the existing delivery worker's concrete next deadline.

Native policy mutations require current approved administrator/company rights,
an immutable PostgreSQL audit receipt and current authority again at admission
and dispatch. An orphaned SQLite policy cannot authorize an alternative. Native
run rows bind the exact frozen request and authoritative historical selection;
the outbox preserves terminal failure, exact independent review and accounting
across either acknowledgement gap. Standard runs cannot manufacture a comparison
receipt. Full native observed context is still unknown: `observedVariant` remains
null, so this implementation cannot qualify a native canary yet.

Settings → Models offers explicit enrollment, adopted-version pins, revisioned
changes and rollback with stable retry identities. Access loss hides cached policy
and release details; account/company changes discard drafts. Native preparation
currently covers model variants only. Broader prompt/context variant delivery,
PostgreSQL execution, live enrollment, real-account qualification and measured
production non-regression remain unfinished. M05/M06 stay **Not fixed**.

Source evidence: 53 independent SQLite/HTTP-handler tests, 92 host/UI checks and
an overlapping 76-pass/one-skip native outcome/worker suite. Database-backed audit
and outbox recovery cases are authored but unrun under the owner's retained
listener restriction. Server/UI builds and targeted semantic checks pass; no
runtime was restarted. Exact logs and earlier failed attempts are retained in
the completion ledger.
