# AgentOS workforce: initial organisation and delegated authority

Date: 2026-11-03

This is the concrete staffing recommendation requested in the previous session.
It extends the [operating model](2026-10-25-agentos-operating-model.md) and the
[complete execution plan](2026-10-27-agentos-end-to-end-execution.md). It does not
create employees, start runs, or declare the existing roster evaluated.

## Start with three departments and seven company roles

For the first company, use **one company CEO, three department heads, one product
manager and one lead per active project**. Heads, product manager and project
leads are responsibilities held by the existing specialist pool, not additional
employees. Start with six specialist assignments and the CEO; Friday coordinates
the portfolio above them. This matches the seven paused Northstar demo roles
(CEO, Product Lead, Growth Lead, Operations Lead, Software Engineer, Quality
Reviewer and Sales Operator), without treating that illustrative seed as verified
execution:

| Assignment | Department and management responsibility | Initial execution responsibility |
| --- | --- | --- |
| Friday | Portfolio coordinator; delegates company operations to its CEO | Owner conversation, portfolio priorities, cross-company exceptions and scoped navigation |
| Company CEO | Accountable for this company only | Goals, operating mandate, staffing requests, financial outcomes and escalations |
| Product specialist | Head of Product & Engineering; product manager across this company's explicitly assigned projects | Briefs, priorities, acceptance criteria and product project leadership |
| Engineering specialist | Product & Engineering | Implementation and technical investigations; technical project lead when the project needs one |
| QA specialist | Product & Engineering | Independent checks, regression evidence and release readiness |
| Marketing specialist | Head of Growth & Revenue | Campaign/project lead, creation, publication and measured iteration |
| Sales specialist | Growth & Revenue | Qualified opportunities, outreach and follow-up within the company's mandate |
| Operations specialist | Head of Operations & Customer Success | Operations/project lead, customer support/feedback triage, reliability, source-backed reporting and recovery |

That is **3 departments, 3 heads, 1 product manager, 6 specialists and 1 CEO**,
coordinated by Friday. The three heads and product manager are included in the
six specialists. Add a dedicated Support specialist only when measured workload
justifies splitting it from Operations. Do not create a separate executive for
every title.

Friday and the six specialists are reusable employee identities. Each company
gets its own authorized assignment, native agent/runtime context, instruction
adoption and resource bindings. The company CEO has a separate company-scoped
assignment. Adding a company need not duplicate the shared specialist identities.
An identity is not a permanently running process or an additional subscription
seat. Reuse suitable installed identities before creating new ones.

## Initial project ownership

Create only projects that have real work. These are recommended starting scopes,
not fabricated tasks or results:

| Department | Project when needed | Accountable lead | Supporting specialists | Evidence of success |
| --- | --- | --- | --- | --- |
| Product & Engineering | Build and improve the product | Product specialist | Engineering, QA, Operations | Accepted brief, tested output, review and release/health evidence when applicable |
| Growth & Revenue | Acquire and retain customers | Marketing specialist | Sales, Product, Engineering | Authorized content/publication receipts, measured reach/conversion and next iteration |
| Operations & Customer Success | Operate the company and support customers | Operations specialist | QA, Sales; dedicated Support when needed | Resolved cases, reliability outcomes and source-backed performance reports |

Each project has exactly one lead; each task has exactly one assignee. A specialist
can contribute to several projects without changing its reporting manager. The
Product specialist coordinates dependencies across the explicit project set;
it does not acquire access to unrelated companies or private projects.

## Reporting and escalation

The company CEO receives reports from the three department heads. Engineering
and QA report to Product; Sales reports to Marketing. A future Support specialist
reports to Operations. Friday coordinates with the CEO through scoped tasks and messages;
do not create a cross-company `reportsTo` link.

An executor receives the task's necessary context and reports evidence or a
blocker to its project lead. The project lead resolves project scope and
dependencies. The department/product manager resolves conflicts across its
assigned projects. The CEO resolves company priority and resource conflicts.
Friday resolves authorized portfolio conflicts and presents owner decisions.
Existing ACLs and native grants apply at every level; titles and reporting lines
do not grant access.

## Staffing, retirement and growth

Start work on demand and use native routine scheduling. Avoid idle employee
polling. Do not enable a recurring workflow before its tools, output checks,
limits, stop conditions and recovery are configured and qualified.

Reuse a specialist before hiring another. Split a role only when recorded queue
age, conflicting deadlines or independent-review requirements demonstrate a
need. A second simultaneous engineering project may justify a dedicated
technical lead; a sustained support queue may justify another support
assignment. Record the workload, expected benefit, capacity impact and review
date in the hiring task. Creating more names does not increase account quota.

The CEO may request or perform native hiring within its actual grants and
approval policy. Retirement ends one company's assignment, preserves work and
history, and waits for native runtime cleanup before replacement. A manager's
reports must be reassigned first. Portfolio-wide identity retirement remains
the owner's/Friday's separately authorized responsibility.

For a capability improvement, retain company evidence in that company, propose
a sanitized reusable method, evaluate representative successes and failures,
publish a version and record each company's adoption or refusal. Retiring one
assignment must not update or retire another company's version. Model-routing
improvement and employee capability cultivation are separate records.

## Delegation implementation boundary

Existing workforce records preserve shared identity and company-local runtime
assignments. The board owns portfolio creation, company linking and global
identity changes. Native company access must remain authoritative.

The initial safe delegation slice is deliberately company-scoped: a currently
configured coordinator or company CEO can inspect the company's shared-workforce
bindings and bind an already approved native company agent only when native
staffing grants, target-agent access and a server-derived responsible portfolio
owner all permit it. It must not return another company's assignments or private
agent configuration. The portfolio owner is derived from authentication, never
accepted from request JSON. Revoked membership, restricted task keys and inactive
agents deny access. A role label alone is insufficient.

Cross-company Friday delegation needs an explicit portfolio mandate with an
owner, authorized company set, permitted actions, revision/revocation and native
target-company revalidation. The current company coordinator binding is not
that mandate. The native termination endpoint remains board-only.
Company assignment retirement now has its separate explicit scoped grant contract
below; hiring/configuration grants do not imply termination authority.

## Completion evidence

1. Record the chosen company CEO, three department heads, product manager and
   project leads through native assignments; reuse suitable existing employees.
2. Exercise an authorized company staffing action and reject a non-manager,
   revoked owner, foreign company, restricted key and inaccessible target agent.
3. Show a real task escalating executor → project lead → company CEO → Friday,
   preserving sources and independent context boundaries.
4. Demonstrate company-local retirement and replacement without changing another
   company's shared specialist assignment or capability pin.
5. Run one bounded product or marketing project to verified outputs, then use its
   evidence for a capability proposal and an explicitly recorded adoption choice.

Code/test evidence and runtime staffing evidence must be recorded separately.

## Implementation and verification record

The company-scoped slice is implemented at:

- `GET /api/companies/{companyId}/workforce`: current-company assignment records
  and their linked shared identity metadata, filtered through target-agent reads.
- `POST /api/companies/{companyId}/workforce/assignments`: idempotent binding of
  an existing shared employee to an approved native agent. The body contains
  `id`, `employeeId`, `agentId` and optional `department`; `companyId` comes only
  from the authenticated path. No owner or portfolio ID is accepted in the body.
- `POST /api/companies/{companyId}/workforce/assignments/{assignmentId}/retire`:
  revision-checked company retirement with `expectedRevision` and `reason`.
  Target read and explicit `workforce:retire` grants are checked using
  `scope: { targetAgentId }`; an administrator may constrain each grant with
  `{ agentIds: [targetAgentId] }`. Both the actual caller and its responsible
  owner must qualify through native authorization; a pinned authorizing user
  retains its native ceiling too. No new role defaults or automatic grants are
  added. The existing board portfolio route retains its owner checks.

The acting manager needs native `applications:manage` and `agents:create` grants;
binding also checks native `agent:read` and `agent_config:update`. The responsible
user must be the portfolio owner, remain approved, hold active non-viewer
membership in the target company, and retain portfolio administration in the
home company. The actor's company and key boundary remain in force. An operator
can use the same endpoints under the existing owner checks. Shared assignment
uniqueness, native lifecycle readiness, duplicate-request handling and durable
audit use the same implementation as the original board binding path.

No existing portfolio route was opened to agents. Creating portfolios, linking
companies and registering global identities remain on the board-only routes.
The company retirement endpoint shares revision/idempotency, direct-report,
native termination, key revocation and durable audit behavior with board
retirement. Authorization rows are held through commit after waiting for the
target agent; no acting board identity is substituted. This slice does not provision roles, change instructions,
grant provider access or launch employee work.

The focused PostgreSQL/HTTP suite now includes four delegated-staffing scenarios
alongside eight existing workforce cases. On 2026-11-03 its database setup failed
with `listen EPERM: operation not permitted 127.0.0.1`; all 12 cases were skipped.
This is blocked verification, not a passing result. The log is retained at
`/private/tmp/agentos-workforce-20261103.log`. `node scripts/check-maps.mjs` passed
the structural map check (37 areas, 198 capability IDs). Integrated typechecking
and runtime proof are tracked by the main implementation session.

The 2026-11-04 retirement extension adds CEO/Friday target-scope, responsible-owner,
home-administration, default-denial, role-change, isolation, direct-report,
concurrent revocation and SQL-audit-rollback cases. These cases remain unrun under
the same sandbox listener restriction; the failing PostgreSQL setup was not
repeated. The native permission key is exported through the shared/plugin SDK
catalog and accepted by native grant validators. Advanced permission editing in
the core Members page is delegated to an installed extension; there is no second
workforce-specific grant store or authority UI.

Independent continuation review found the responsible-user shadow rollout could bypass retirement's owner grant. `workforce:retire` now always enforces that intersection, matching the existing strict instruction-update pattern without changing other actions. Two additional database cases cover absent/wrong owner scope under shadow and current authorizing-user scope/membership, bringing this suite to 23 cases. These remain unrun here. Final integrated server semantic checking and independent source re-review pass; neither certifies runtime locking or lifecycle completion.
