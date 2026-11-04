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

Comparison outcomes stay separate from existing observational `evaluate` records and cannot activate a route. The pre-existing routine-work router and its legacy evidence remain unchanged and should continue to be described as an observational heuristic. No HTTP endpoints, new scheduler, provider calls, live employee runs, policy promotion or cross-company method sharing were added. The independent package still has no Agent OS runtime dependency.

## Verification

Canonical Node 24.22.1, actual temporary SQLite files and in-memory SQLite:

```sh
node --test packages/model-intelligence/src/index.test.mjs packages/model-intelligence/src/comparisons.test.mjs
```

24 tests pass, covering immutable/canonical idempotency, restart and v1 upgrade, unknown future schema rejection, namespace/receipt/case/variant binding, pre-registration receipts, mixed dimension/funding rejection, configured stricter thresholds, synthetic/training/unpaired evidence, cross-version training exposure, preserved failure/retry costs, first-pass/final regression, unknown measurements, adversarial resource arithmetic, policy block/restore, and absence of routing activation from comparison records. Fixture outcomes are synthetic test data exercising logic; they demonstrate no actual model improvement.

Only lightweight package tests and syntax checks were run for this slice. HTTP listener tests were not rerun: no HTTP changes were made, and this session's listener restrictions were already established. No live evaluations or production trials were performed.

## Remaining M05/M06 integration

- Native authenticated delivery of observed execution dimensions, every attempt's acceptance evidence and measured resource use, with a recovery/outbox contract. Arbitrary caller labels must not be upgraded to independently verified observations.
- A representative, authorized and sanitized task corpus, versioned checks, protected artifact lifecycle, time-separated held-out work, evaluator calibration and explicit missing-evidence handling.
- Bounded offline execution and shadow/canary trials using existing native admission and budget ownership; genuine held-out results and drift/rollback evidence.
- Versioned adoption/promote/rollback receipts under the approved company operating policy, preserving in-flight pins and opt-out boundaries.
- Separate API authorization/contracts if comparison methods are exposed over HTTP; this checkpoint deliberately exposes only the embedded contract for review.
