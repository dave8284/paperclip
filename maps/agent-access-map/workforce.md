# Portfolio and shared workforce access

Product: [Portfolio and shared workforce](../feature-map/workforce.md).

Feature ID: `workforce`.

## `portfolio`

Capability ID: `workforce/portfolio`.

Review: `baseline`.

API: `present` — GET/POST /api/agentos/portfolios; GET /api/agentos/portfolios/{portfolioId}; POST /api/agentos/portfolios/{portfolioId}/companies.

Agent access: `operator-only` — board REST and UI. Native discovery labels these routes board-only. Ordinary company agent keys cannot operate or read portfolios.

Policy: owner user identity, session/token company admission, fresh active membership and native company ACLs. A company-consented token cannot use broader user memberships to expand its scope. Writes require users:manage_permissions in the home and target company. Linking never grants company access. Local implicit board retains existing local authority. Home company permanent deletion is blocked before stopping agents; archive remains available.

Evidence: `verified` — isolated PostgreSQL HTTP tests at the current source checkout exercise owner, foreign-owner, revoked-company and agent-denial paths. Live provider/Friday transport is not certified.

Verification: `passed` — [tests](../../server/src/__tests__/agentos-workforce.test.ts), [routes](../../server/src/routes/agentos-workforce.ts), [OpenAPI](../../server/src/routes/openapi.ts). Identity replay, narrow returned fields and revoked-company filtering were exercised.

Gaps: explicit Friday portfolio delegation and CEO company staffing admission remain to implement. Agent identity is never elevated to board implicitly.

Ownership transition: the existing native board-claim ceremony transfers only
`local-board` portfolios to the authenticated claimant, with an activity record
in the same transaction. Another user's portfolio is never transferred by that
ceremony. See [board-claim tests](../../server/src/__tests__/board-claim.test.ts).

## `assignments`

Capability ID: `workforce/assignments`.

Review: `baseline`.

API: `present` — POST /api/agentos/portfolios/{portfolioId}/employees; POST /api/agentos/portfolios/{portfolioId}/assignments; POST /api/agentos/portfolios/{portfolioId}/assignments/{assignmentId}/retire. GET portfolio supplies the authorized roster.

Agent access: `operator-only` — board REST and UI. CEOs can still use their existing native company hiring APIs under native grants, but cannot bind/retire shared identities through these new routes yet.

Policy: portfolio ownership and company permission administration; approved native runtime binding; unique active employee/company assignment; compound foreign keys; revision-bound retirement. Native lifecycle, key revocation, assignment update and activity record share a company accounting transaction. Live reports prevent manager retirement. Permanent agent deletion retains shared assignment history, matching native retained case-history semantics.

Evidence: `verified` — isolated database tests cover cross-company bindings, retirement isolation, concurrent duplicate retirement, private adapter-field exclusion and real SQL audit-failure rollback. Native asynchronous cleanup completion is not certified by those tests.

Verification: `passed` — [tests](../../server/src/__tests__/agentos-workforce.test.ts), [service](../../server/src/services/agentos-workforce.ts), [lifecycle adapter](../../server/src/modules/agent-lifecycle/adapters/postgres.ts).

Gaps: controlled self-staffing, opt-in capability versions, centrally evaluated learning and cross-company chat remain planned. Agent-authored reports are not treated as qualification evidence.
