# Costs, budgets, and spending controls — agent access

Product map: [Costs, budgets, and spending controls](../feature-map/budgets-costs.md).

Feature ID: `budgets-costs`.

Budget admission commits under the company accounting lock. A separate ownership
transaction rechecks scope and capacity immediately before provider handoff;
provider work does not hold the company accounting lock. Company, applicable
agent, and applicable project limits include unsettled
observed run usage and reservations without counting either twice. A committed
hard stop prevents fresh provider work immediately; scoped cancellation delivery
runs asynchronously and preserves existing Stop acknowledgement and recovery
requirements. Project enforcement does not pause an agent's unrelated projects.
Hosted browser dispatch reserves a separate scoped hold, rechecks authority at
the paid POST, and retains unknown charges until terminal accounting. The parent
run reservation does not authorize or replace this separate browser cost cap.

Review date: 2026-10-12. Source commit: `f981fa3cc10cb8663a87dec60345fbff46d54d0a`.

This is a source-reviewed baseline of representative operations and known gaps.
Each capability needs operation-level review before its entire scope can be
qualified. No live agent execution is claimed. Follow the [map contract](../README.md)
for format, permission checks, evidence and maintenance.

Prompt injection classification is a separate `prompt_injection` service charge,
with user/agent/task/project attribution and no heartbeat receipt linkage. Unknown
billing retains its reservation until correction; agent deletion cannot erase
that hold. See [accounting behavior](../../doc/prompt-injection-prevention.md).

## `shared-execution-capacity`

Capability ID: `budgets-costs/shared-execution-capacity`.

Review: `baseline`.

API: `present` — `GET /api/instance/ai-execution-capacity` and
`POST /api/instance/ai-execution-capacity`.

Agent access: `restricted` — instance administrator board only. Current access
to every old and new bound company is required for changes. An agent's name,
role, subscription plan or task does not authorize configuration or membership.

Policy: Groups are explicit private administrative configuration. Company
billing identities remain unchanged. Admission uses durable run claims under a
group lock before the normal budget/dispatch gate. Native AI selection rechecks
the original responsible user, grant audience, installation, account, policy and
prepared credential generation after waiting. Only verified execution cleanup
releases admitted claims; elapsed time and terminal status alone cannot.
Company-local task projections expose the wait without other companies' work.

Evidence: `source-only` — [routes](../../server/src/routes/ai-execution-capacity.ts),
[service](../../server/src/services/ai-execution-capacity.ts) and native heartbeat
integration. No automatic grouping or production policy is installed.

Verification: `not-run` for actual database/provider/board journeys. Focused
component and controlled lifecycle tests are separate from live concurrency,
revocation, Stop and restart qualification.

Gaps: Host credential paths without a managed connection and unbound managed
connections are outside these configured groups. Operational concurrency does
not establish the provider's actual quota or entitlement.

## `cost-reporting`

Capability ID: `budgets-costs/cost-reporting`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/companies/{companyId}/costs/summary`.
- `GET /api/companies/{companyId}/costs/by-agent`.

Agent access: `available` — REST / native call_api / CLI cost.

Policy: Reading costs uses company/resource cost policy. Budget policies and incident
resolution require a board actor.

Evidence: `source-only` — [implementation](../../server/src/routes/costs.ts#L346) at the
reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Cost visibility applies. Provider accounting imports and quota-window inspection
have additional board gates.

## `model-routing-audit`

Capability ID: `budgets-costs/model-routing-audit`.

Review: `baseline`.

API: `present` — GET /api/admin/model-intelligence adds read-only task/model
cohorts and recent run audit projections; GET /api/admin/model-intelligence/learning
retains the independent selection/evaluation ledger.
GET and POST /api/companies/{companyId}/friday/model-qualifications list bounded
native evidence and register an immutable qualification. DELETE
/api/companies/{companyId}/friday/model-qualifications/{id} revokes eligibility
while retaining the evidence. Request bodies accept native references and expiry,
never caller-authored model observations or quality scores.

Agent access: `restricted` — these are instance-level board administrator reads.
Company membership, an agent role or task execution does not grant this
cross-company report. Ordinary task/run links still use their native access rules.
Qualification management is also operator-only: current approved instance
administrator plus active target-company membership, or local implicit board.
An agent cannot certify its own account access or reviewed workflow.

Policy: `assertAdministration` executes before queries. Actual usage joins both
company and run; selection/triage receipts bind their recorded company/run, and
evaluation links match both namespace and receipt ID. No prompts, transcripts,
credentials or full configurations are returned. This projection does not mutate
model policy, evaluation, review requirements or permissions.
The native model owner also records `modelAccountAccess` after managed-account
preparation, scoped to that employee/company and exact account/credential epoch.
It reads at most 100 indexed execution projections and the matching usage ledger.
No new API, provider probe, credential access or model-admission authority is
granted; prior access remains distinct from current entitlement and quality.

Queue timing uses native run timestamps. First-comment timing requires native
issue scope, exact company/issue/run/author matching, ordinary comment origin,
nondeleted state and a timestamp between run start and report time. Only the
minimum timestamp is read, using the existing company/issue/created-at index.
No raw comment body or inferred author is projected. These timings do not prove
provider first-token or audible-response performance.

Evidence: `source-only` — [administrator route](../../server/src/routes/agentos-administration.ts),
[authorized report](../../server/src/services/agentos-model-analytics.ts) and
[bounded audit projection](../../server/src/services/agentos-model-audit.ts).

Verification: `not-run` for live board/agent requests. Focused SQL-projection tests
and administrator component checks cover authorization-before-read, company/run
binding, selected/actual distinction, bounded truncation and company-owned links.
Use an administrator and a denied ordinary actor against an owned fixture for
live acceptance; recorded successful process completion must not become a
quality pass.

Gaps: The report limits the last 30 days to 100 model/task groups and 50 recent
runs. Review lookup uses the latest 100 evaluation records; no match is unknown.
It does not qualify System One accuracy or independent reviewer isolation.
Native interactive conversation identity skips local shadow inference before
dispatch, recording `interactive_conversation` with no execution/timing claim.
This does not change actor authority, selected profiles or ordinary task review.
Native qualification binds a fresh completed subscription execution, actual
provider session observation, exact managed account/credential generation and
employee profile. Access evidence and independently reviewed workflow evidence
remain distinct. Routine-work alternatives additionally require routing-quality
evidence and matching CLI identity, with current authority and receipt validity
rechecked before dispatch and after waits. Historical usage and global catalogs
never admit an automatic alternative. Existing resumed sessions remain untouched;
stale queued alternatives fail for explicit review. The qualification API is
bounded and on-demand; it never launches inference or acquires credentials.
Production account qualification and the full operating journey remain unverified.

## `budgets`

Capability ID: `budgets-costs/budgets`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/companies/{companyId}/budgets/overview`.
- `POST /api/companies/{companyId}/budgets/policies`.

Agent access: `restricted` — Agent-readable overview where allowed; board-only
configuration.

Policy: Reading costs uses company/resource cost policy. Budget policies and incident
resolution require a board actor.

Evidence: `source-only` — [implementation](../../server/src/routes/costs.ts#L346) at the
reviewed commit above.

Verification: `not-run` — assert the documented agent denial with an owned test fixture;
verify any listed agent request/result path separately. A delegated operation needs its
own policy and access review.

Gaps: Read API exists; no agent-write path for budget policies, including agents with
ordinary company access.

## `incidents`

Capability ID: `budgets-costs/incidents`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/companies/{companyId}/budgets/overview`.

Agent access: `available` — REST / native call_api for allowed visibility.

Policy: Reading costs uses company/resource cost policy. Budget policies and incident
resolution require a board actor.

Evidence: `source-only` — [implementation](../../server/src/routes/costs.ts#L346) at the
reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Inspection is supported; hard-stop or pause relief does not follow from seeing the
incident.

## `resolution`

Capability ID: `budgets-costs/resolution`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/companies/{companyId}/budget-incidents/{incidentId}/resolve`.

Agent access: `restricted` — Board resolution API; agent requests the authorized
person's action.

Policy: Reading costs uses company/resource cost policy. Budget policies and incident
resolution require a board actor.

Evidence: `source-only` — [implementation](../../server/src/routes/costs.ts#L346) at the
reviewed commit above.

Verification: `not-run` — assert the documented agent denial with an owned test fixture;
verify any listed agent request/result path separately. A delegated operation needs its
own policy and access review.

Gaps: A governance-policy decision is needed before delegating budget increases or
incident resolution.

## `subscriptions`

Capability ID: `budgets-costs/subscriptions`.

Review: `baseline`.

API: `present` — GET /api/companies/{companyId}/costs/subscriptions; POST /api/companies/{companyId}/costs/subscriptions/refresh; PATCH /api/companies/{companyId}/costs/subscriptions/{subscriptionId}; POST /api/companies/{companyId}/costs/subscriptions/{subscriptionId}/link.

Agent access: `restricted` — these report, refresh, price, and link routes require a board actor. An ordinary agent bearer, native tool, or assistant grant does not inherit the person’s subscription-management identity.

Policy: Company membership and company cost-read permission apply. Account metadata and fees are limited to the owner, an authorized shared audience, or a manager of shared AI connections. Viewers cannot refresh or edit. Editing requires ownership or management of a shared account; linking requires that authority for both records and matching source/target revisions. Company boundaries, immutable price history, and activity logging remain in force.

Evidence: `source-only` — reviewed at `9ef434fe79c57d976b8b03b14c5242db270b8320`. [Subscription card](../../ui/src/components/SubscriptionCostCard.tsx), [cost routes](../../server/src/routes/costs.ts), [subscription service](../../server/src/services/subscriptions.ts), and [report visibility](../../server/src/services/subscription-report.ts).

Verification: `not-run` — Read as each authorized person and verify the account audience. Persist and reload an allowed price change and same-seat link. Reject viewer mutation, another person’s personal-price edit, stale revisions, foreign-company IDs, and ordinary agent requests. Compare current fees, historical usage, and provider state separately.

Gaps: No ordinary-agent management path or request/result handoff is documented. Provider plan discovery, currencies, and seat-identity cases need live qualification; source tests do not establish actual provider billing.

## `accounting-recovery`

Capability ID: `budgets-costs/accounting-recovery`.

Review: `baseline`.

API: `present` — GET /api/companies/{companyId}/costs/data-quality; POST /api/companies/{companyId}/costs/retry-accounting. Separate board operational inspection also uses GET /api/companies/{companyId}/accounting/inspect and POST /api/companies/{companyId}/accounting/retry.

Agent access: `restricted` — quality and retry routes require board identity and company cost-read permission. The separate accounting inspection/retry namespace is board-only. There is no ordinary-agent cost-repair tool implied by permission to read a run.

Policy: Company boundaries and cost visibility apply to the UI report. Viewers may read permitted reports but cannot retry recording. A retry names a run in the same company, logs its request, and calls saved-cost accounting; it does not invoke the adapter. Projection repair is a different operational action with an inspection fingerprint and reason, not the UI Retry cost recording control.

Evidence: `source-only` — reviewed at `9ef434fe79c57d976b8b03b14c5242db270b8320`. [Cost notice](../../ui/src/components/CostDataQualityNotice.tsx), [cost routes](../../server/src/routes/costs.ts), [quality report](../../server/src/services/cost-data-quality.ts), and [accounting retry](../../server/src/services/accounting-integrity.ts).

Verification: `not-run` — Inspect each fixture reason, execute one authorized retry, and compare cost rows, accounting state, activity, and the unchanged run/task execution. Repeat the request to check no duplicate charge. Reject viewer/agent mutations and a foreign-company run. Preserve unavailable and failed states until an actual receipt or allowed correction resolves them.

Gaps: The report is bounded to recent entries; vary the date range to inspect additional records. Full provider receipt timing, invoice reconciliation, and projection repair need separate operator qualification; no live provider recovery is claimed.
