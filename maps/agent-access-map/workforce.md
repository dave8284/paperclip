# Portfolio and shared workforce access

Product: [Portfolio and shared workforce](../feature-map/workforce.md).

Feature ID: `workforce`.

Friday can receive broad owner-authorized portfolio visibility, but every task
and handoff remains owned by one company. Read mandates do not authorize task
creation, execution, identity substitution or copying another company's private
context. Direct-chat and coordinator instructions state this boundary; broader
company-isolated delegation is still pending.

Friday's board role is a product responsibility, not the native board actor.
Updated guidance directs work to the company's CEO or department heads, who own
staffing and specialist execution. Executive handoff is implemented in source;
the actual delivery journey remains pending. Designation consumes native execution
stop evidence under the final provider configuration lock, without cancelling
work or taking over lifecycle cleanup. Prompt guidance alone is not an access boundary.

## `portfolio`

Capability ID: `workforce/portfolio`.

Review: `baseline`.

API: `present` — GET/POST /api/agentos/portfolios; GET /api/agentos/portfolios/{portfolioId}; POST /api/agentos/portfolios/{portfolioId}/companies.

Agent access: `operator-only` — board REST and UI. Native discovery labels these routes board-only. Ordinary company agent keys cannot operate or read portfolios.

Policy: owner user identity, session/token company admission, fresh active membership and native company ACLs. A company-consented token cannot use broader user memberships to expand its scope. Writes require users:manage_permissions in the home and target company. Linking never grants company access. Local implicit board retains existing local authority. Home company permanent deletion is blocked before stopping agents; archive remains available.

Evidence: `verified` — the prior board-only isolated PostgreSQL checkpoint exercised owner, foreign-owner, revoked-company and agent-denial paths. It does not certify the current continuation. Live provider/Friday transport is not certified.

Verification: `passed` — [tests](../../server/src/__tests__/agentos-workforce.test.ts), [routes](../../server/src/routes/agentos-workforce.ts), [OpenAPI](../../server/src/routes/openapi.ts). Identity replay, narrow returned fields and revoked-company filtering were exercised at that earlier checkpoint; current database reruns remain blocked.

Gaps: persisted/live delegation acceptance, external-broker direction authority and independent executive outcome reporting remain. Explicit read and write gateways are separate; agent identity is never elevated to board implicitly.

Ownership transition: the existing native board-claim ceremony transfers only
`local-board` portfolios to the authenticated claimant, with an activity record
in the same transaction. Another user's portfolio is never transferred by that
ceremony. See [board-claim tests](../../server/src/__tests__/board-claim.test.ts).
The same transaction transfers explicit bootstrap operational responsibility,
archives active local-board memberships and seeds the new owner's native grants.
Routine responsibility changes append revisions; historical work and existing API
key identities are preserved. This 2026-11-04 correction has source-reviewed
regressions pending an environment that permits the isolated PostgreSQL listener.

## `assignments`

Capability ID: `workforce/assignments`.

Review: `baseline`.

API: `present` — POST /api/agentos/portfolios/{portfolioId}/employees; POST /api/agentos/portfolios/{portfolioId}/assignments; POST /api/agentos/portfolios/{portfolioId}/assignments/{assignmentId}/retire. GET portfolio supplies the authorized roster. GET /api/companies/{companyId}/workforce and POST /api/companies/{companyId}/workforce/assignments provide company-scoped read/bind. POST /api/companies/{companyId}/workforce/assignments/{assignmentId}/retire provides company-scoped retirement.

Agent access: `available` — company staffing mutations admit an actual CEO or department head with native applications:manage and agents:create authority, server-derived responsible portfolio ownership and fresh approved-user membership. Current Friday can read the company workforce under native visibility but cannot bind/retire staff, even with legacy grants. Department leadership and current role are rechecked under mutation locks. The responsible owner must retain portfolio administration through a direct native user grant, without instance-admin elevation. Binding additionally requires native target-agent read/configuration authority. Retirement requires target-agent read and explicit workforce:retire through native caller/responsible-user/authorizing-user intersections. Neither agent nor human role defaults include this grant; native scope is evaluated with targetAgentId. Restricted keys, another company's paths and inactive managers are denied. Global identity/portfolio APIs remain board-only; native hiring retains its separate gates.

Policy: portfolio ownership and company permission administration; approved native runtime binding; unique active employee/company assignment; compound foreign keys; revision-bound retirement. Native lifecycle, key revocation, assignment update and activity record share a company accounting transaction. Native authority rows and target ancestry remain locked through commit; decisions are refreshed after target-lock waits. Live reports prevent manager retirement. Retirement never changes the shared identity or another company's assignment; unresolved native cleanup still prevents same-company replacement. Permanent agent deletion retains shared assignment history, matching native retained case-history semantics.

Evidence: `source-only` — the added company delegation paths have regression cases but no completed runtime verification. Earlier isolated database tests covered board bindings, retirement isolation, concurrent duplicate retirement, private adapter-field exclusion and real SQL audit-failure rollback. Native asynchronous cleanup completion was not certified by those tests.

Verification: `blocked` — PostgreSQL setup failed on 2026-11-03 with `listen EPERM: operation not permitted 127.0.0.1`; all 12 cases were skipped. New company delegation cases in [tests](../../server/src/__tests__/agentos-workforce.test.ts) cover Friday read-only access, actual CEO/department-head mutation, native grants, target approval/configuration, scoped responses, duplicate writes and owner revocation. Prior board-only paths had a passing isolated database checkpoint; that result does not certify the new slice. See [service](../../server/src/services/agentos-workforce.ts), [lifecycle adapter](../../server/src/modules/agent-lifecycle/adapters/postgres.ts) and the [staffing plan verification record](../../doc/plans/2026-11-03-agentos-workforce.md).

Delegated retirement verification (2026-11-04): source-only; new cases cover default denial, current CEO/Friday identity, exact target scope on both principals, home administration, role changes, company isolation, report reassignment, concurrent replay, grant revocation before authorization and through audit commit, plus SQL audit-failure rollback. The prior PostgreSQL listener failure was not repeated; these cases have not run. Native PERMISSION_KEYS/shared SDK and grant validators expose workforce:retire; the core Members page delegates advanced permission editing to an installed extension.

Gaps: cross-company delegation, centrally evaluated learning and cross-company chat remain planned. Manual opt-in capability versions have their separate contract below. Delegated retirement needs runtime qualification. Binding does not create a model subscription or execute work. Agent-authored reports are not treated as qualification evidence.

## `awareness`

Capability ID: `workforce/awareness`.

Review: `baseline`.

API: `present` — GET /api/companies/{companyId}/friday/agents/{agentId}/awareness with offset and limit (maximum five assignment pages). Native discovery exposes this read to standard, Ask and Plan modes.

Agent access: `available` — only the authenticated agent's own current-company assignment with a standard key. Shared identity, portfolio roles and the responsible user's access to other companies never substitute a different agent or board actor. Board reads intersect consented company scope with current native company/agent authorization.

Policy: resolve active shared bindings only after source company/agent admission. Refresh membership snapshots; retain actor, run, responsible user and external authorizer identities. Filter assignment metadata before pagination. Reuse native Friday work with the unchanged actor for private project/task/evidence predicates. At most five work calls, each bounded to 25 tasks; assignment metadata discovery scales with the shared employee's admitted company assignments, with eight concurrent authorization checks maximum. No credentials, configurations or transcript bodies are projected.

Evidence: `source-only` — [service](../../server/src/services/employee-awareness.ts), [direct-chat guidance](../../server/src/services/agent-conversations.ts), controlled-dependency [contract tests](../../server/src/services/employee-awareness.test.ts) and [discovery tests](../../server/src/services/native-runtime/runner-api.test.ts). Fresh native SQL privacy behavior and live model answers are not claimed by these tests.

Verification: `passed` — eight controlled-dependency awareness cases and 2,058 native API/discovery cases pass on 2026-11-04 without listeners. This proves those bounded contracts only; full PostgreSQL route/privacy integration and live direct-chat acceptance require an environment that permits them. No database listener or model execution was attempted for this slice.

Gaps: this endpoint grants no cross-company authority. Explicit shared-summary reads use the separate read-mandate gateway below; private reads and broader cross-company chat/work delegation remain pending.

## `capabilities`

Capability ID: `workforce/capabilities`.

Review: `baseline`.

API: `present` — GET /api/agentos/portfolios/{portfolioId}/employees/{employeeId}/capabilities (offset pages); POST /api/agentos/portfolios/{portfolioId}/capabilities; POST /api/agentos/portfolios/{portfolioId}/assignments/{assignmentId}/capabilities (adopt, refuse, rollback).

Agent access: `operator-only` — the existing portfolio board-only guard and OpenAPI discovery classification apply. Standard company agents cannot publish or mutate a portfolio capability. A company agent may propose a source skill/evaluation through native Skill Studio, then request its owner's manual review and decision; no agent inherits board identity.

Policy: portfolio owner, fresh current home/target company administration and consented company scope. Adoption also requires native target-agent configuration authority and company skill policy. Native authority/agent/policy locks span the transaction; expected assignment revision and selection hash fence stale intent. Publication accepts only an exact immutable Markdown-only source version and matching completed readable native test with retained output, plus explicit human reviewed/sanitized acceptance. It shares only deliberate bytes/evaluation summary. Company import, native selection revision, immutable decision and audit commit atomically. Exact adopted pins persist across Beta UI settings; refusal preserves configuration and rollback requires earlier company adoption. Existing run snapshots are unchanged. No paid execution or automatic adoption is triggered.

Evidence: `source-only` — [owner service](../../server/src/services/agentos-capabilities.ts), [native skill owner](../../server/src/services/company-skills.ts), [routes](../../server/src/routes/agentos-workforce.ts) and [UI](../../ui/src/components/WorkforceCapabilities.tsx).

Verification: `passed` — eleven focused content/privacy/native selection/mutation-authorization cases and eight new/existing component cases passed on 6 November 2026. Five additional real PostgreSQL/HTTP cases were authored but not run because the session cannot create an isolated listener. The existing 63-case native skill route suite was attempted and failed at Supertest listener setup (`listen EPERM`), before route behavior. Passing pure/UI checks does not certify transaction concurrency or delivered runtime skill bytes.

Gaps: backend migration/activation, real two-company execution and revocation/rollback qualification, browser review, and delegated/automated capability evaluation remain open. The manual slice supports native Paperclip Runner skill delivery only. Release pages are bounded to 100 plus active pins; decision history shows the latest 100 receipts.

## `board-directions`

Capability ID: `workforce/board-directions`.

Review: `baseline`.

API: `present` — owner POST /api/agentos/portfolios/{portfolioId}/read-mandates/{mandateId}/board-direction-authority; source Friday POST /api/companies/{companyId}/friday/board-directions and GET /api/companies/{companyId}/friday/board-directions/{directionId}?revision={currentMandateRevision}.

Agent access: `available` — current Friday in a native owner conversation, with exact private read mandate and separately granted workforce:board_direct. External broker source executions revalidate pinned connection identity/generation, live credential authority and every current connection/operator read and assignment ceiling. Ordinary foreign-company task routes remain unavailable.

Policy: one company's actual CEO/responsible head, current owner assignment rights, approved native identities and exact grant/revision/expiry. Strict input forbids foreign parents/workspaces/runtime context and creator overrides. Task contents, assignment and authority are rechecked inside native admission. Source provenance never becomes target execution identity. Native queue receipts resolve uncertain delivery without repeating accepted work. Revocation stops pending handoffs; admitted work belongs to the company. Read receipts use current private resource rights and distinguish dispatch, task status, latest native implementation and exact historical independent review. Scope-match evidence does not certify artifact freshness or business acceptance.

Evidence: `source-only` — [gateway](../../server/src/services/board-directions.ts), [durable delivery](../../server/src/services/board-direction-delivery.ts), [owner controls](../../ui/src/components/WorkforceMandates.tsx), [execution checkpoint](../../doc/plans/2026-11-06-agentos-completion-ledger.md).

Verification: `passed` — focused scope/retry tests and owner UI checks pass; four database cases are authored but unrun. Migration 0394, persisted native admission/concurrency, live broker authority and independent executive outcome reporting remain unaccepted. No live grant or business execution occurred.

Gaps: persisted/live broker authority, real executive-led delivery/review/reporting, persisted concurrency/native admission and loaded acceptance.

## `portfolio-read`

Capability ID: `workforce/portfolio-read`.

Review: `baseline`.

API: `present` — owner GET/POST /api/agentos/portfolios/{portfolioId}/read-mandates and POST /api/agentos/portfolios/{portfolioId}/read-mandates/{mandateId}/revoke; actual agent GET /api/companies/{companyId}/friday/portfolio-mandates, portfolio-work, portfolio-records and portfolio-content.

Agent access: `available` — actual source agent with explicit matching workforce:portfolio_read native grant and mandate. No role default, shared identity or source coordinator binding implies a mandate. Discover and read keep the source-company URL; ordinary target-company routes remain denied. Board principals cannot impersonate an agent through the read gateway.

Policy: explicit company_shared_only or owner_accessible_private scope, portfolio_work:read action, selected target set, exact source agent/company, owner, revision, revocation and expiry. Native grant ID, owner and complete structured scope must match the row. Every read locks/rechecks current portfolio links, approved accounts, source agent readiness/membership, owner permission-management grants in home/source/target and external-authorizer target read ceiling. Original actor and both user identities reach strict native SQL privacy predicates regardless of rollout shadow mode; shared-only scope excludes private ancestry/projects before counts/pages. Private scope requires the current Friday and intersects the owner's current resource rights (including current admin status) with external-authorizer rights; ordinary target routes stay denied. Summary responses contain at most 100 tasks and 200 projects, without bodies or unchecked relationships; private content uses the separate contract below. Mutations and successful reads append native audit records. Grant changes cannot commit halfway through the guarded read transaction.

Evidence: `source-only` — [service](../../server/src/services/agentos-portfolio-mandates.ts), [UI](../../ui/src/components/WorkforceMandates.tsx), [strict native projection](../../server/src/services/friday-awareness.ts), [execution log](../../doc/plans/2026-11-06-agentos-portfolio-read-mandates.md).

Verification: `passed` — eight focused mandate/authority/SQL construction cases, six component cases and one native discovery case pass without listeners. Source-only PostgreSQL/HTTP cases cover actual privacy, owner/native revocation, company denial and revision replay; these were authored but not run in the sandbox. SQL construction tests do not prove database transaction or privacy execution.

Private content policy: the records/content gateways require owner_accessible_private;
shared grants remain summary-only. One native SQL statement applies task/project
and both user ceilings before body projection. Personal conversations remain
owner-only. Deleted comments, system documents and hidden/harness work are
excluded. References are limited to 50 per page; bodies to 20,000 Unicode
characters with SHA-256-bound continuation. Text is untrusted reference material.
Native audits omit bodies and titles; protected response handling prevents
plaintext overflow artifacts. No extra schema, background work or foreign route
authority is introduced.

Private content verification: `passed` — 24 contract/SQL/UI checks and four
selected native discovery/protected-response checks. The new PostgreSQL privacy,
version and revocation case is authored but unrun under listener restrictions.

Gaps: migration/activation, real PostgreSQL concurrency/privacy/audit proof, browser and actual agent acceptance. The owner approved private information across their companies; bounded private content is implemented, but no live private grant is configured. Bounded task/case attachments have a separate private read contract; run/tool logs remain outside the gateway. Portfolio task creation, delegation and cross-company operating proof remain open.

Private executive discovery (2026-11-08): portfolio-records kind=executives uses
the exact owner_accessible_private mandate and current source Friday. It returns
bounded native CEO/department-head identities and availability, optionally for
a readable target project. Owner/external-authorizer project predicates apply
before pagination; current target Friday and title-only matches are excluded.
Discovery shares the native executive-role predicate with assignment, but
grants no write or execution authority. Sensitive-response handling and
content-free source audit remain unchanged. Controlled SQL/contract checks pass;
the real PostgreSQL gateway/revocation case is authored and unrun.

Task-file continuation (source only): `portfolio-records` kind=attachments and
`portfolio-attachment` expose exact version-bound ordinary task files through
the private mandate. Original/current task and project privacy, comment lineage,
owner/external ceilings and post-storage reauthorization apply. Reads are bounded
and cancellable; storage keys and API captures are excluded. Task-file reads do
not admit case-owned assets; those use the case-owner contract below.
Partial chunks are not whole-file proof. Focused host/storage/API checks pass;
persisted privacy/revocation and live inspection remain unaccepted.

Case-file continuation (source only): when Cases is enabled, `portfolio-records`
kind=cases discovers readable identities and kind=case_attachments lists files
for an exact caseId. Byte reads require exactly one taskId or caseId. The shared
native case predicate preserves every retained task/project boundary; current
case ownership, original upload case, both user ceilings and feature enablement
are rechecked after storage. Case fields and bodies are not projected by discovery.
Controlled contract/SQL/reauthorization checks pass; real PostgreSQL isolation
and live reads remain unaccepted.
