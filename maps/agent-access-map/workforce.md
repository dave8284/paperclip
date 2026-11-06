# Portfolio and shared workforce access

Product: [Portfolio and shared workforce](../feature-map/workforce.md).

Feature ID: `workforce`.

## `portfolio`

Capability ID: `workforce/portfolio`.

Review: `baseline`.

API: `present` — GET/POST /api/agentos/portfolios; GET /api/agentos/portfolios/{portfolioId}; POST /api/agentos/portfolios/{portfolioId}/companies.

Agent access: `operator-only` — board REST and UI. Native discovery labels these routes board-only. Ordinary company agent keys cannot operate or read portfolios.

Policy: owner user identity, session/token company admission, fresh active membership and native company ACLs. A company-consented token cannot use broader user memberships to expand its scope. Writes require users:manage_permissions in the home and target company. Linking never grants company access. Local implicit board retains existing local authority. Home company permanent deletion is blocked before stopping agents; archive remains available.

Evidence: `verified` — the prior board-only isolated PostgreSQL checkpoint exercised owner, foreign-owner, revoked-company and agent-denial paths. It does not certify the current continuation. Live provider/Friday transport is not certified.

Verification: `passed` — [tests](../../server/src/__tests__/agentos-workforce.test.ts), [routes](../../server/src/routes/agentos-workforce.ts), [OpenAPI](../../server/src/routes/openapi.ts). Identity replay, narrow returned fields and revoked-company filtering were exercised at that earlier checkpoint; current database reruns remain blocked.

Gaps: portfolio work creation/delegation remains to implement. Explicit shared-summary read delegation has its separate gateway below; agent identity is never elevated to board implicitly.

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

Agent access: `available` — the company endpoints admit the current configured coordinator or CEO with native applications:manage and agents:create authority, server-derived responsible portfolio ownership and fresh approved-user membership. The responsible owner must retain portfolio administration through a direct native user grant, without instance-admin elevation. Binding additionally requires native target-agent read/configuration authority. Retirement requires target-agent read and explicit workforce:retire through native caller/responsible-user/authorizing-user intersections. Neither agent nor human role defaults include this grant; native scope is evaluated with targetAgentId. Restricted keys, another company's paths and inactive managers are denied. Global identity/portfolio APIs remain board-only; native hiring retains its separate gates.

Policy: portfolio ownership and company permission administration; approved native runtime binding; unique active employee/company assignment; compound foreign keys; revision-bound retirement. Native lifecycle, key revocation, assignment update and activity record share a company accounting transaction. Native authority rows and target ancestry remain locked through commit; decisions are refreshed after target-lock waits. Live reports prevent manager retirement. Retirement never changes the shared identity or another company's assignment; unresolved native cleanup still prevents same-company replacement. Permanent agent deletion retains shared assignment history, matching native retained case-history semantics.

Evidence: `source-only` — the added company delegation paths have regression cases but no completed runtime verification. Earlier isolated database tests covered board bindings, retirement isolation, concurrent duplicate retirement, private adapter-field exclusion and real SQL audit-failure rollback. Native asynchronous cleanup completion was not certified by those tests.

Verification: `blocked` — PostgreSQL setup failed on 2026-11-03 with `listen EPERM: operation not permitted 127.0.0.1`; all 12 cases were skipped. New company delegation cases in [tests](../../server/src/__tests__/agentos-workforce.test.ts) cover current coordinator/CEO, native grants, target approval/configuration, scoped responses, duplicate writes and owner revocation. Prior board-only paths had a passing isolated database checkpoint; that result does not certify the new slice. See [service](../../server/src/services/agentos-workforce.ts), [lifecycle adapter](../../server/src/modules/agent-lifecycle/adapters/postgres.ts) and the [staffing plan verification record](../../doc/plans/2026-11-03-agentos-workforce.md).

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

## `portfolio-read`

Capability ID: `workforce/portfolio-read`.

Review: `baseline`.

API: `present` — owner GET/POST /api/agentos/portfolios/{portfolioId}/read-mandates and POST /api/agentos/portfolios/{portfolioId}/read-mandates/{mandateId}/revoke; actual agent GET /api/companies/{companyId}/friday/portfolio-mandates and GET /api/companies/{companyId}/friday/portfolio-work.

Agent access: `available` — actual source agent with explicit matching workforce:portfolio_read native grant and mandate. No role default, shared identity or source coordinator binding implies a mandate. Discover and read keep the source-company URL; ordinary target-company routes remain denied. Board principals cannot impersonate an agent through the read gateway.

Policy: mandatory company_shared_only scope, portfolio_work:read action, selected target set, exact source agent/company, owner, revision, revocation and expiry. Native grant ID, owner and complete structured scope must match the row. Every read locks/rechecks current portfolio links, approved accounts, source agent readiness/membership, owner permission-management grants in home/source/target and external-authorizer target read ceiling. Original actor and both user identities reach strict native SQL privacy predicates regardless of rollout shadow mode; private ancestry and projects are excluded before counts/pages. Maximum 100 tasks and 200 projects per response; no transcript, config, secret, evidence body or unchecked relationship projection. Mutations and successful reads append native audit records. Grant changes cannot commit halfway through the guarded read transaction.

Evidence: `source-only` — [service](../../server/src/services/agentos-portfolio-mandates.ts), [UI](../../ui/src/components/WorkforceMandates.tsx), [strict native projection](../../server/src/services/friday-awareness.ts), [execution log](../../doc/plans/2026-11-06-agentos-portfolio-read-mandates.md).

Verification: `passed` — six focused mandate/authority/SQL construction cases, five component cases and one native discovery case pass without listeners. Source-only PostgreSQL/HTTP cases cover actual privacy, owner/native revocation, company denial and revision replay; these were authored but not run in the sandbox. SQL construction tests do not prove database transaction or privacy execution.

Gaps: migration/activation, real PostgreSQL concurrency/privacy/audit proof, browser and actual agent acceptance. Private scope awaits the user's answer; no private scope control or live grant exists. Portfolio task creation, delegation and cross-company operating proof remain open.
