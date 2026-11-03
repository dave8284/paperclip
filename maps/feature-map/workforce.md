---
navigation: {"section":"Agents and organization","sectionOrder":30,"order":5}
---

# Portfolio and shared workforce

Feature ID: `workforce`.

One reusable employee identity can have separate native agent assignments in several companies. Company execution, skills, instructions and permissions retain their native owners.

Implementation: [page](../../ui/src/pages/Workforce.tsx), [service](../../server/src/services/agentos-workforce.ts), [routes](../../server/src/routes/agentos-workforce.ts).

Agent access: [companion](../agent-access-map/workforce.md).

## Sub-features

- `portfolio`: `workforce/portfolio` — create an owner-scoped portfolio and link authorized companies.
- `assignments`: `workforce/assignments` — register shared employees, bind company agents and retire an assignment with preserved history.

## How to get to it (user POV)

### `shared-workforce`

Open Portfolio & workforce in the sidebar, or `/workforce`. Create a portfolio with an existing home company, add another company, add a specialist and connect an approved agent from each company. Company cards link to projects, routines, artefacts and profiles. Agent links open native profiles with instructions, skills, harnesses, budgets and chat.

Retire assignment requires a reason. Only the selected company agent enters native termination. Other assignments remain active. Runtime cleanup can remain pending; retirement is not proof that a remote process has stopped. Managers with live reports must reassign those reports first.

Reassigning that employee within the same company waits for the previous native runtime's terminal cleanup state. Retired assignment history remains visible after a replacement is assigned.

The company-scoped staffing API permits a currently configured Friday or company
CEO to read that company's bindings and bind an already approved native agent.
It requires native staffing grants and a currently approved responsible portfolio
owner. The API does not hire a runtime, grant tools or start work. The
[staffing plan](../../doc/plans/2026-11-03-agentos-workforce.md) recommends three
departments and seven initial company roles, reusing specialists as heads/leads.

## Driving it with the API and UI

### `shared-workforce`

Use [database/HTTP tests](../../server/src/__tests__/agentos-workforce.test.ts) for two-company identity, duplicate requests, access revocation, stale retirement, native key revocation and audit-failure rollback. [Component tests](../../ui/src/pages/Workforce.test.tsx) cover company links, retirement state, creation retries, read-only controls and account changes. These do not certify browser rendering, audio or provider execution.

Manual recipe: create two disposable companies, connect one specialist to both, open each native agent profile, retire one assignment and refresh. Verify one remains active, inspect company Activity, then remove the second company's membership and verify its records disappear. Do not use production employees for retirement testing.

Company delegation: GET `/api/companies/{companyId}/workforce` and POST
`/api/companies/{companyId}/workforce/assignments`. Verify an authorized CEO or
current coordinator can read/bind only its company, cannot retire or operate the
global portfolio APIs, and loses access after grant, coordinator, owner approval
or membership revocation. The new database/HTTP regression cases require a
permitted local PostgreSQL/socket environment; current execution evidence is
recorded in the staffing plan rather than inferred from their presence.

## Known gaps

Cross-company Friday delegation, agent retirement authority, versioned shared capabilities, cross-company employee chat, learning evaluations and the portfolio Decisions/graph projections remain later steps of the approved operating-model plan. Company-scoped read/bind does not establish those broader authorities. This screen connects existing company agents; it does not create model subscriptions or start runs. Refresh and focus refetch retrieve current state; portfolio-wide live subscription is not implemented. Department is an optional assignment label, not an independent permission boundary. The home company is retained for portfolio administration; archive it instead of permanently deleting it.
