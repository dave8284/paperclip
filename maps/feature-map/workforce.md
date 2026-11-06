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
- `awareness`: `workforce/awareness` — read current shared-employee assignment evidence under the caller's native company and private-work access.
- `capabilities`: `workforce/capabilities` — publish reviewed Markdown releases and independently adopt, refuse or roll back exact versions in each company.
- `portfolio-read`: `workforce/portfolio-read` — explicitly grant one source agent bounded company-shared work summaries in selected portfolio companies.

## How to get to it (user POV)

### `shared-workforce`

Open Portfolio & workforce in the sidebar, or `/workforce`. Create a portfolio with an existing home company, add another company, add a specialist and connect an approved agent from each company. Company cards link to projects, routines, artefacts and profiles. Agent links open native profiles with instructions, skills, harnesses, budgets and chat.

Retire assignment requires a reason. Only the selected company agent enters native termination. Other assignments remain active. Runtime cleanup can remain pending; retirement is not proof that a remote process has stopped. Managers with live reports must reassign those reports first.

Reassigning that employee within the same company waits for the previous native runtime's terminal cleanup state. Retired assignment history remains visible after a replacement is assigned.

The company-scoped staffing API permits a currently configured Friday or company
CEO to read that company's bindings and bind an already approved native agent.
It requires native staffing grants and a currently approved responsible portfolio
owner. Company assignment retirement additionally requires the explicit native
`workforce:retire` grant for both the caller and responsible owner, evaluated
against the selected company agent. It is not included in default agent or human
grants. The API does not hire a runtime, grant tools or start work. The
[staffing plan](../../doc/plans/2026-11-03-agentos-workforce.md) recommends three
departments and seven initial company roles, reusing specialists as heads/leads.

## Driving it with the API and UI

### `shared-workforce`

Use [database/HTTP tests](../../server/src/__tests__/agentos-workforce.test.ts) for two-company identity, duplicate requests, access revocation, stale retirement, native key revocation and audit-failure rollback. [Component tests](../../ui/src/pages/Workforce.test.tsx) cover company links, retirement state, creation retries, read-only controls and account changes. These do not certify browser rendering, audio or provider execution.

Manual recipe: create two disposable companies, connect one specialist to both, open each native agent profile, retire one assignment and refresh. Verify one remains active, inspect company Activity, then remove the second company's membership and verify its records disappear. Do not use production employees for retirement testing.

Company delegation: GET `/api/companies/{companyId}/workforce` and POST
`/api/companies/{companyId}/workforce/assignments`; POST
`/api/companies/{companyId}/workforce/assignments/{assignmentId}/retire` requires
`expectedRevision` and `reason`. Verify an authorized CEO or current coordinator
can read/bind only its company, cannot retire without the explicit target grant or
operate the global portfolio APIs, and loses access after grant, coordinator, owner approval
or membership revocation. The new database/HTTP regression cases require a
permitted local PostgreSQL/socket environment; current execution evidence is
recorded in the staffing plan rather than inferred from their presence.

## Current employee evidence

### `employee-awareness`

Direct employee chat guidance now directs assignment/project status questions to
GET `/api/companies/{companyId}/friday/agents/{agentId}/awareness`. It resolves the
active shared identity and reads current native work, with observation time and
pagination. Agent runs can read their own current-company assignment only. A
board request can include other assignments only when its admitted company
scope, current native company and agent permissions permit them; native task and
project privacy still applies. Hidden assignments add no names or counts.

At most five assignment work pages are returned, each with up to 25 tasks and the
existing work endpoint's bounded projects/evidence. Further work pages use that
company's `/friday/work` endpoint with the assignment's native agent ID. Missing
access is not proof of idle or absent work; task status is not execution proof.
There is no model call, background prefetch, new UI or cross-company agent grant.

[Contract tests](../../server/src/services/employee-awareness.test.ts) exercise
scope preservation, responsible-user propagation, refreshed snapshots, omission
before pagination, call bounds and changed evidence with controlled dependencies.
[Native discovery tests](../../server/src/services/native-runtime/runner-api.test.ts)
exercise the advertised API and read modes. These tests do not certify live chat
answers or database privacy; the existing [native work tests](../../server/src/__tests__/friday-awareness.test.ts)
cover those SQL resource boundaries and require a permitted PostgreSQL listener.

## Known gaps

Portfolio task creation/delegation, private cross-company reads, automated capability evaluations and the portfolio Decisions/graph projections remain later steps of the approved operating-model plan. The explicit summary read gateway and manual capability lifecycle below have source implementation and focused checks, with PostgreSQL/runtime acceptance pending. Company-scoped staffing does not establish broader authorities. Delegated retirement has source regression coverage, with PostgreSQL execution still blocked by the known sandbox listener denial. This screen connects existing company agents; it does not create model subscriptions or start runs. Refresh and focus refetch retrieve current state; portfolio-wide live subscription is not implemented. Department is an optional assignment label, not an independent permission boundary. The home company is retained for portfolio administration; archive it instead of permanently deleting it.

## Explicit portfolio summary access

Expand **Portfolio read access** in Workforce. The owner selects the actual source
company agent, target companies, the supported **Company-shared project and task
summaries** scope and an expiry or explicit no-expiry choice. Create, edit, grant
again and revoke all use the displayed revision. There is no default grant.
Names are read through native agent access; unavailable agents are labelled as
unavailable. A configured row does not claim its current native grant is usable.

Agents discover their own current mandate at
GET `/api/companies/{companyId}/friday/portfolio-mandates`, then call the same
source company's `/friday/portfolio-work` with the exact mandate ID/revision and
an authorized target company. Original agent, run, owner and authorizer identities
remain intact. Counts and pagination apply only to shared visible work; private
ancestors are excluded even when the owner could read them. No transcripts,
configuration, secrets, hidden counts or foreign execution authority are returned.
The owner must retain native permission-management authority in home, source and
selected target companies, and an external authorizer must also have current
target read access. Revoke, expiry, account suspension, company unlink or a changed
native grant closes the gateway. Ordinary cross-company routes stay denied.

See the [read-mandate execution log](../../doc/plans/2026-11-06-agentos-portfolio-read-mandates.md)
for focused tests, the unapplied migration and remaining live qualification.

## Reviewed capabilities

### `reviewed-capabilities`

Expand **Reviewed capabilities** on a shared employee. Publish an exact standalone
Markdown skill version after reviewing a completed native Skill Studio test and
explicitly accepting the result. The owner checks the skill and evaluation
summary are suitable for portfolio sharing; private task/test references and
output stay in the source company. Process completion alone is not a quality
score. Edit and retest the source before publication if sanitization is needed.

Each company has separate Adopt, Refuse and Roll back controls with a reason.
Adoption writes an immutable native company skill version and its exact agent
selection in the same transaction as the decision/audit. Refusal preserves
selection. Rollback uses a previously adopted version's exact bytes. Active runs
retain their captured snapshots; disabling the Beta skills UI does not erase
these explicit adoption pins. The first slice supports skills-capable native
Paperclip Runner agents and operator-owned manual decisions.

Release history pages contain 100 releases plus every currently selected
version; older releases remain reachable. Recent decision history is explicitly
limited to 100 receipts per company. Current selection is read from native
configuration, so manual removal or a changed selection is not labelled adopted.
Source companies and skills with published evidence are retained by foreign keys;
archive the source company rather than deleting it.

[Focused content/selection checks](../../server/src/__tests__/agentos-capabilities-contract.test.ts)
and [component checks](../../ui/src/components/WorkforceCapabilities.test.tsx)
cover privacy projection, exact pins, review requirements, company choices,
refusal/retry and older-version rollback controls. The additional
[database/HTTP cases](../../server/src/__tests__/agentos-workforce.test.ts) cover
real two-company adoption, stale/concurrent intent, policy/revocation and audit
rollback; they require an isolated PostgreSQL/listener environment and have not
run in this sandbox. Browser and native agent delivery acceptance remain open.
