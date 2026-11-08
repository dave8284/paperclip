# Companies and portability — agent access

Product map: [Companies and portability](../feature-map/companies.md).

Feature ID: `companies`.

Review date: 2026-10-12. Source commit: `58e16dbddfc9c8d0cf60867f9d9847f0feda055b`.
Native REST transport reconciled in this change; see the
[shared transport contract](README.md#native-rest-transport).

This is a source-reviewed baseline of representative operations and known gaps.
Each capability needs operation-level review before its entire scope can be
qualified. No live agent execution is claimed. Follow the [map contract](../README.md)
for format, permission checks, evidence and maintenance.

## `selection`

Capability ID: `companies/selection`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/companies/{companyId}`.
- `GET /api/companies`.
- `POST /api/companies`.

Agent access: `partial` — Agent reads its bound company; CLI context chooses it; board
lists/creates companies.

Policy: Same-company CEO or board for identity/import operations; list/create/archive
convenience endpoint is board-gated.

An Agent OS portfolio's home company cannot be permanently deleted because it
owns portfolio administration and audit context; the native delete service returns
`409 portfolio_home_company_retained` before stopping agents. Archive remains
available. Explicit deletion of another linked company removes only that
company's assignments and portfolio link, retaining shared employees.

Agent OS department grouping supports a nullable `leadAgentId`, validated against
an active, ready employee of the same company. Updates require the current
department revision, persist an audit event and retain native project visibility.
The composite company/agent foreign key prevents foreign-company heads; company
deletion removes department grouping before employee cleanup. Native individual
employee deletion must first clear any department-head assignment. Neither a
department-head label nor the existing project-lead label grants private-project
access. Source: `server/src/services/agentos-departments.ts`,
`server/src/services/company-deletion.ts`, `server/src/services/agent-deletion.ts`.

Department mutations retain `applications:manage` and current native user/agent
authority. The board or company CEO can create/remove departments and appoint heads.
An appointed head manages only its own department and projects; it cannot replace
heads, delete its own appointment, or move work into or out of another head's department. Friday cannot be
appointed as a delivery head. A CEO can hire specialists directly without creating
a department. Both native hire routes retain `agents:create` and approval gates;
an appointed head's hires report to itself or a current manager in its own team,
never another department's head, a foreign company, a reporting cycle, or a new
CEO/top-level position. Appointment and authority are checked again within the
hire transaction. These rules do not grant project visibility or change ordinary
creators' existing native permissions.
An employee reporting beneath a department head inherits the same ceiling for its
own reporting subtree, including catalog imports and configuration. Default native
creator/configuration grants cannot promote it to CEO, move its own reporting line
outside the department or control another team. Current ancestry is checked again
under the write locks; direct CEO specialists retain their existing native policy.
For an appointed head, role/reporting changes through PATCH or a configuration
revision rollback must keep an existing team member inside the same team; they
cannot promote a CEO, take another team's employee, or change the head's own
manager. The owning configuration transaction rechecks the current appointment
and native configure permission before applying the graph change.
The same ceiling covers runtime/adapter/profile PATCH updates, managed instruction
entries and supporting files, restoration, and legacy bundle/file writers.
Native self-edit and protected-change consent remain intact; a server-bound,
single-use receipt prevents consuming consent twice between route and writer.
Company workforce assignment and retirement also require the head's own reporting
team. Broad native target grants do not permit taking or retiring another team's
employees; board and CEO scope is retained. Retirement still requires its separate
native target grant, and a head cannot retire its own executive appointment.
Agent pause/termination through PATCH has the same board-only boundary as the
dedicated lifecycle routes; the authorized workforce retirement path remains
available. Agent resume, including PATCH to idle, retains explicit native configure
authority and the head's current target scope within the existing lifecycle
transaction. Normal lifecycle holds and budgets still apply.

Evidence for these refinements: 44 controlled SQL-transport service checks and
four listener-free lifecycle route-handler checks pass
for ownership, reporting scope, revocation after a wait, native denial and privacy
denial. Real PostgreSQL department/authority suites were attempted but blocked by
`listen EPERM` before assertions; persistence, locking and the live head-led
journey remain unverified. Sources:
`server/src/services/agent-hiring-authority.ts`,
`server/src/services/agent-hiring-authority.test.ts`,
`server/src/services/agentos-departments-authority.test.ts`,
`server/src/__tests__/agentos-department-authority.test.ts`.

`GET /api/companies/{companyId}/friday/work` also projects accountability for
authorized work on the current page: task owners remain on tasks, while project
and department heads and their reporting chains appear in `accountability`.
Native employee-read checks filter people; no credentials or instruction bundles
are included. Traversal stops at eight levels or 512 people, with a truncation
flag; permission checks run in batches of at most 16. Tests cover private projects,
foreign managers, cycles and bounds. This is a read model for choosing whom to
consult, not a new delegation grant or orchestration engine.

Evidence: `source-only` — [implementation](../../server/src/routes/companies.ts#L1245)
at the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: A worker cannot enumerate/create companies via its company agent key. Browser
selection is local state.

## `identity`

Capability ID: `companies/identity`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `PATCH /api/companies/{companyId}`.
- `PATCH /api/companies/{companyId}/branding`.

Agent access: `available` — Same-company CEO REST / native call_api / CLI company.

Policy: Same-company CEO or board for identity/import operations; list/create/archive
convenience endpoint is board-gated.

Evidence: `source-only` — [implementation](../../server/src/routes/companies.ts#L1245)
at the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: The CEO restriction is a real policy, not a missing API; ordinary employees need
denial evidence.

## `archive`

Capability ID: `companies/archive`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/companies/{companyId}/archive`.
- `PATCH /api/companies/{companyId}`.

Agent access: `partial` — Board archive endpoint; CEO company PATCH can express status
changes.

Policy: Same-company CEO or board for identity/import operations; list/create/archive
convenience endpoint is board-gated.

Evidence: `source-only` — [implementation](../../server/src/routes/companies.ts#L1245)
at the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Convenience archive and general company PATCH have different authorization. Review
equivalence rather than declaring all archival human-only.

## `portability`

Capability ID: `companies/portability`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/companies/{companyId}/exports`.
- `POST /api/companies/{companyId}/imports/preview`.
- `POST /api/companies/{companyId}/imports/apply`.

Agent access: `partial` — Same-company CEO REST / native `call_api` / CLI exports
and eligible same-company imports.

Policy: Same-company CEO or board for company import/export operations. Agent
imports retain the original native hiring actor and responsible-user ceiling;
they cannot create another company, replace employees, grant arbitrary imported
permissions or bypass individual hire approvals. The separate team catalog
install path also permits native authorized creators. Appointed heads may install
only staff explicitly anchored to their own current reporting team; CEO/top-level
packages, cycles and another department's employees are rejected. Reporting links
are created with each employee under current transaction-checked authority.

Explicit package permission grants require the authenticated board actor's
current `users:manage_permissions` authority; `applications:manage` additionally
requires that same company-wide granting authority. Other existing grant keys
retain the native permission-management policy. CEO title or `agents:create`
alone cannot mint grants. Selected non-skipped grants are checked before import
mutations and again inside the employee's native lifecycle transaction. The
employee, grants and audit commit together; lifecycle work and publications occur
after commit. Existing membership status/role, pending hire approvals, scoped
grants and the import pause reason are preserved. Imports without explicit grants
retain their normal lifecycle path.

Evidence includes the real lifecycle facade with controlled transaction transport
(root guard, distinct nested transaction context, rollback, revoked/scoped board
authority and post-commit wake), actual importer wiring and listener-free native
route handlers. These checks do not qualify PostgreSQL contention or live import
acceptance. Sources: `server/src/services/company-import-permission-grants.ts`,
`server/src/modules/agent-lifecycle/index.ts` and their focused tests.

Evidence: `source-only` — [implementation](../../server/src/routes/companies.ts#L1245)
at the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Exports use inline credential delivery and encrypted mutation receipts.
New-company/ZIP import flows retain their board and transport constraints.
Controlled SQL authorization and importer/route tests cover the new staffing
boundary; live catalog installation remains unqualified.

## `decision-models`

Capability ID: `companies/decision-models`.

Review: `baseline`.

API: `present` — GET and PUT /api/companies/{companyId}/decision-model;
POST /api/companies/{companyId}/decision-model/test;
GET /api/companies/{companyId}/decision-model/availability;
GET /api/companies/{companyId}/decision-model/history.

Agent access: `partial` — same-company REST and admitted native call_api
availability/history reads where policy allows. Settings and the fixed Test
action require board identity. Native rollout/run gates follow the shared
[transport contract](README.md#native-rest-transport).

Policy: Settings access requires board and company access; non-managers receive
no settings or choices. Configuration and tests additionally require connection
management authority (owner/admin, instance admin, or tools:manage_connections).
History requires company_scope:read and redacts task/run links without issue:read.
Background sponsorship and budget admission remain separate service checks.

Evidence: `source-only` — reviewed on 2026-10-13 at
`60bc0d5fee9a6e48db08fc016521fee3d9f57d67`:
[routes](../../server/src/routes/decision-models.ts),
[service](../../server/src/services/decision-models.ts), and
[connection authority](../../server/src/routes/ai-connections.ts).

Verification: `not-run` — read history with an allowed company actor and an actor
without task access; check link redaction. Reject agent configuration/tests and
board mutations without connection-management permission. Verify settings and
bounded test receipts with an owned simulated provider.

Gaps: No agent settings/test path; permitted history does not delegate management.
Live native and agent-credential reads remain unverified.

## `fast-responses`

Capability ID: `companies/fast-responses`.

Review: `baseline`.

API: `present` — GET and PUT /api/companies/{companyId}/fast-response;
GET /api/companies/{companyId}/fast-response/models;
GET /api/companies/{companyId}/fast-response/availability;
POST /api/companies/{companyId}/fast-response/test;
GET /api/companies/{companyId}/fast-response/history.

Agent access: `partial` — same-company REST and admitted native call_api history
reads where policy allows, subject to the shared
[transport contract](README.md#native-rest-transport).
Settings, model selection, availability and test controls require board identity.

Policy: Board and company access gate configuration surfaces. Updates, models
and tests additionally require connection-management authority. History requires
company_scope:read; task/run links require issue:read. The experiment, provider
account, sponsorship and budget controls still gate actual acknowledgements.

Evidence: `source-only` — reviewed on 2026-10-13 at
`60bc0d5fee9a6e48db08fc016521fee3d9f57d67`:
[routes](../../server/src/routes/fast-responses.ts),
[service](../../server/src/services/fast-responses.ts), and
[connection authority](../../server/src/routes/ai-connections.ts).

Verification: `not-run` — inspect history and redacted task links as an allowed
company actor. Reject agent settings/models/availability/tests and unauthorized
board mutations. Use a simulated provider to inspect a saved configuration,
success receipt, timeout and recorded usage.

Gaps: No agent configuration/test path. An acknowledgement is not completed task
work. Live native, provider and agent access remain unverified.

## `agent-observability`

Capability ID: `companies/agent-observability`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/companies/{companyId}/observability`.
- `PUT /api/companies/{companyId}/observability`.
- `DELETE /api/companies/{companyId}/observability`.
- `POST /api/companies/{companyId}/observability/test`.

Agent access: `operator-only` — configuration and tests require board context.

Policy: Company access and Manage connections permission; non-managing board readers receive no settings.
Credentials are write-only and stored through company secret bindings.

Evidence: `source-only` — [routes](../../server/src/routes/agent-observability.ts).

Verification: `not-run` — exercise board management, restricted board, agent denial, and cross-company denial.

Gaps: Direct agent management and independent personal harness enrollment are outside v1.

## `prompt-injection-prevention`

Capability ID: `companies/prompt-injection-prevention`.

Review: `baseline`.

API: `present` — GET/PUT /api/companies/{companyId}/prompt-injection-prevention,
GET /api/companies/{companyId}/prompt-injection-prevention/models, and
POST /api/companies/{companyId}/prompt-injection-prevention/test.

Agent access: `restricted` — management is board-only. Admitted gateway tool
results use saved configuration through an internal service, not an agent API.

Policy: Company access, connection-management permission, shared OpenRouter API
keys, credential audience, installation, and budgets remain enforced. Identified
users cannot become sponsored callers after a denial. See
[routes](../../server/src/routes/prompt-injection-prevention.ts) and
[service](../../server/src/services/prompt-injection-prevention.ts).

Evidence: `source-only` — [service tests](../../server/src/__tests__/prompt-injection-prevention.test.ts)
and [gateway tests](../../server/src/__tests__/prompt-injection-gateway.test.ts)
exercise permissions, billing, fallback, and persisted evidence; execution results
belong in the change's PR.

Verification: `not-run` — Reject agent management and foreign-company requests. Assert model
verdicts at admitted result boundaries and the original regex on dependency failure.

Gaps: No agent-facing mechanism to request a board configuration change is added.

## `performance`

Capability ID: `companies/performance`.

Review: `baseline`.

API: `present` — `GET /api/companies/{companyId}/friday/performance?period=YYYY-MM`
and `POST /api/companies/{companyId}/friday/performance`.

Agent access: `available` — native `call_api`/REST; Friday's instructions describe
read-before-write, sources, completeness and optimistic revision matching.

Policy: company membership/discovery and normal agent key required. Project reads
are authorized before pagination. Writes require `applications:manage`, validate
same-company project access, append an immutable revision and transactional audit.
No external provider write or automatic Stripe import occurs here.

Evidence: `source-only` for the agent entry point. Passing isolated database tests cover company/project privacy,
revision conflicts, validation and persistence; a local board GET returned no
invented metrics. [Tests](../../server/src/__tests__/company-performance.test.ts).

Verification: `not-run` — no real agent write, source ingestion or browser proof.
The fixture tests do not qualify an end-to-end provider reporting loop.

Gaps: automatic provider ingestion, actual agent execution and browser acceptance
remain unverified. Manual sourced snapshots are the implemented entry point.
