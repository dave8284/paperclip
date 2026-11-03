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

Gaps: explicit cross-company Friday portfolio delegation remains to implement. Company-scoped staffing has its separate endpoints below; agent identity is never elevated to board implicitly.

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

API: `present` — POST /api/agentos/portfolios/{portfolioId}/employees; POST /api/agentos/portfolios/{portfolioId}/assignments; POST /api/agentos/portfolios/{portfolioId}/assignments/{assignmentId}/retire. GET portfolio supplies the authorized roster. GET /api/companies/{companyId}/workforce and POST /api/companies/{companyId}/workforce/assignments provide company-scoped read/bind.

Agent access: `available` — the company endpoints admit the current configured coordinator or CEO with native applications:manage and agents:create authority, server-derived responsible portfolio ownership and fresh approved-user membership. The responsible owner must retain portfolio administration. Binding additionally requires native target-agent read/configuration authority. Restricted keys, another company's paths and inactive managers are denied. Global identity/portfolio changes and retirement remain board-only; native hiring retains its separate gates.

Policy: portfolio ownership and company permission administration; approved native runtime binding; unique active employee/company assignment; compound foreign keys; revision-bound retirement. Native lifecycle, key revocation, assignment update and activity record share a company accounting transaction. Live reports prevent manager retirement. Permanent agent deletion retains shared assignment history, matching native retained case-history semantics.

Evidence: `source-only` — the added company delegation paths have regression cases but no completed runtime verification. Earlier isolated database tests covered board bindings, retirement isolation, concurrent duplicate retirement, private adapter-field exclusion and real SQL audit-failure rollback. Native asynchronous cleanup completion was not certified by those tests.

Verification: `blocked` — PostgreSQL setup failed on 2026-11-03 with `listen EPERM: operation not permitted 127.0.0.1`; all 12 cases were skipped. New company delegation cases in [tests](../../server/src/__tests__/agentos-workforce.test.ts) cover current coordinator/CEO, native grants, target approval/configuration, scoped responses, duplicate writes and owner revocation. Prior board-only paths had a passing isolated database checkpoint; that result does not certify the new slice. See [service](../../server/src/services/agentos-workforce.ts), [lifecycle adapter](../../server/src/modules/agent-lifecycle/adapters/postgres.ts) and the [staffing plan verification record](../../doc/plans/2026-11-03-agentos-workforce.md).

Gaps: company read/bind is a limited staffing slice. Agent retirement, cross-company delegation, opt-in capability versions, centrally evaluated learning and cross-company chat remain planned. Binding does not create a model subscription or execute work. Agent-authored reports are not treated as qualification evidence.
