---
navigation: {"section":"Agents and organization","sectionOrder":30,"order":5}
---

# Portfolio and shared workforce

Feature ID: `workforce`.

One reusable employee identity can have separate native agent assignments in several companies. Company execution, skills, instructions and permissions retain their native owners.

Friday's owner-authorized visibility spans the owner's companies and employees.
Work stays isolated to each company; coordination never merges their tasks or
shares private context with another company's employees. Delegation retains each
company's permissions, budgets and applicable approvals.

The owner and Friday act as the board. Friday directs company CEOs or department
heads; those executives own staffing, specialist delegation and delivery.
Friday reads evidence and reports outcomes without performing execution work.

Implementation: [page](../../ui/src/pages/Workforce.tsx), [service](../../server/src/services/agentos-workforce.ts), [routes](../../server/src/routes/agentos-workforce.ts).

Agent access: [companion](../agent-access-map/workforce.md).

## Sub-features

- `portfolio`: `workforce/portfolio` — create an owner-scoped portfolio and link authorized companies.
- `assignments`: `workforce/assignments` — register shared employees, bind company agents and retire an assignment with preserved history.
- `awareness`: `workforce/awareness` — read current shared-employee assignment evidence under the caller's native company and private-work access.
- `capabilities`: `workforce/capabilities` — publish reviewed Markdown releases and independently adopt, refuse or roll back exact versions in each company.
- `portfolio-read`: `workforce/portfolio-read` — explicitly grant one source agent bounded work summaries in selected portfolio companies, with an explicit private scope for current Friday.
- `board-directions`: `workforce/board-directions` — separately authorize Friday to submit company-owned executive tasks, read current receipts and receive completion returns in the originating owner conversation.

## How to get to it (user POV)

### `shared-workforce`

Open Portfolio & workforce in the sidebar, or `/workforce`. Create a portfolio with an existing home company, add another company, add a specialist and connect an approved agent from each company. Company cards link to projects, routines, artefacts and profiles. Agent links open native profiles with instructions, skills, harnesses, budgets and chat.

Retire assignment requires a reason. Only the selected company agent enters native termination. Other assignments remain active. Runtime cleanup can remain pending; retirement is not proof that a remote process has stopped. Managers with live reports must reassign those reports first.

Reassigning that employee within the same company waits for the previous native runtime's terminal cleanup state. Retired assignment history remains visible after a replacement is assigned.

The company-scoped staffing API lets current Friday, the company CEO and actual
department heads read that company's bindings under native visibility and current
responsible-owner authority. Staffing changes belong to the CEO or department
heads, with native staffing and target configuration grants. Friday cannot bind
or retire staff, even with legacy grants. Company assignment retirement requires the explicit native
`workforce:retire` grant for both the caller and responsible owner, evaluated
against the selected company agent. It is not included in default agent or human
grants. The API does not hire a runtime, grant tools or start work. The
[staffing plan](../../doc/plans/2026-11-03-agentos-workforce.md) recommends three
departments and seven initial company roles, reusing specialists as heads/leads.

Friday's board role comes from the current operating profile, not her name or
prompt. Designating Friday no longer grants application-management permissions.
Changing the designation waits for the employee's existing work and native cleanup
to settle; it does not cancel work. Keeping the same Friday preserves active chats.
Ordinary task and routine pickers exclude her; her conversations and mentions
remain available. Native assignment, preparation and final dispatch enforce the
role ceiling. Company delivery is directed to actual CEOs or responsible heads.
This source change does not activate a portfolio write/delegation grant.

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

Direct employee chat uses GET
`/api/companies/{companyId}/friday/agents/{agentId}/awareness`. Ordinary agent
reads remain current-company only. An explicit exact `mandateId`/`revision`
allows the same employee's other active assignments, within the mandate's
current owner, source-agent and target-company authority. Each assignment retains
its company label and separate native agent. Shared-only scope excludes private
project/task ancestry; only the existing Friday private mandate can admit private
work. A shared identity alone grants nothing.

Authorization filters assignments before counts/pagination. At most five work
pages are returned, each with 25 tasks and bounded projects/evidence. Delegated
continuations use the same source endpoint with exact assignment ID/revision and
`workOffset`/`projectOffset`; they cannot substitute a foreign actor. Local/board
reads retain the existing company work endpoint. Missing access is not proof of
idle work, and task status is not execution proof. There is no new model call,
background worker, credential sharing or foreign execution authority.

[Existing contract tests](../../server/src/services/employee-awareness.test.ts),
[delegated contracts](../../server/src/services/employee-awareness-delegated.test.ts),
[mandate checks](../../server/src/__tests__/agentos-portfolio-mandates-contract.test.ts)
and [discovery tests](../../server/src/services/native-runtime/runner-api.test.ts)
pass 2,198 checks on 8 November. These controlled-dependency checks cover current
identity/authority, denied targets before pagination, stale assignment/mandate
revisions, bounded continuations, rollback publication and unchanged local reads.
Subsequent native SQL pagination/private exclusion/revocation and actual assignment-lock
contention pass in the 72-case workforce/privacy/project/routine suite. Loaded
`cb110a1eb` also passed native ORB-11 multi-company chat, mandate revocation and
independent retirement. Both company agents executed separate arithmetic tasks;
private fixture markers stayed absent from the authorized report and observed
native events. The retained Codex audit attachment is
`aed3acb1-10a0-4c7b-bd4a-e904cda452cc`. These checks do not establish learned
capability transfer, hidden provider context or owner business acceptance.

## Known gaps

Portfolio task creation/delegation, attached binaries, automated capability evaluations and the portfolio Decisions/graph projections remain later steps of the approved operating-model plan. Explicit summary/private-content gateways and the manual capability lifecycle below have source implementation and focused checks, with PostgreSQL/runtime acceptance pending. Company-scoped staffing does not establish broader authorities. Delegated retirement has source regression coverage, with PostgreSQL execution still blocked by the known sandbox listener denial. This screen connects existing company agents; it does not create model subscriptions or start runs. Refresh and focus refetch retrieve current state; portfolio-wide live subscription is not implemented. Department is an optional assignment label, not an independent permission boundary. The home company is retained for portfolio administration; archive it instead of permanently deleting it.

## Explicit portfolio read access

Expand **Portfolio read access** in Workforce. The owner selects the actual source
company agent, target companies, either **Company-shared project and task
summaries** or **Include private work I can read — Friday only**, and an expiry
or explicit no-expiry choice. Private scope requires the current Friday and an
explicit grant revision; shared-only grants are not widened. Create, edit, grant
again and revoke all use the displayed revision. There is no default grant.
Names are read through native agent access; unavailable agents are labelled as
unavailable. A configured row does not claim its current native grant is usable.

Agents discover their own current mandate at
GET `/api/companies/{companyId}/friday/portfolio-mandates`, then call the same
source company's `/friday/portfolio-work` with the exact mandate ID/revision and
an authorized target company. Original agent, run, owner and authorizer identities
remain intact. Counts and pagination apply only to the selected scope. Shared-only scope excludes
private ancestors. Private scope checks current owner resource rights, current
Friday assignment and any external authorizer before projecting rows/counts.
With private scope, `/friday/portfolio-records` discovers the owner's personal
chats and a readable task's comments/documents. `/friday/portfolio-content` reads
bounded descriptions or bodies, with content hashes for continuing pages. Text
is untrusted reference material; deleted/internal/hidden records, other users'
personal chats, configuration, credentials and run/tool logs are excluded.
These reads preserve native payload redaction and create no response artifacts.
No hidden counts or foreign execution authority are returned.
The owner must retain native permission-management authority in home, source and
selected target companies, and an external authorizer must also have current
target read access. Revoke, expiry, account suspension, company unlink or a changed
native grant closes the gateway. Ordinary cross-company routes stay denied.

See the [read-mandate execution log](../../doc/plans/2026-11-06-agentos-portfolio-read-mandates.md)
for focused tests, the unapplied migration and remaining live qualification.

## Reviewed capabilities

Executive directions use a separate explicit control on a private read mandate.
Friday submits one company's task to its actual CEO or responsible department
head; the read grant itself never permits writes. A changed read mandate
invalidates write authority. Revocation stops pending handoffs; already admitted
work remains company-owned. The direction receipt distinguishes saved work,
native admission and current task status.

When the directed company's task reaches Done, the existing durable conversation
outbox wakes Friday in the original owner's conversation. The return carries
task identity and an authorized outcome link; it does not copy private task
bodies between companies. Friday reads the current executive report and evidence
through that link, then reports to the owner. Done alone is not business
acceptance, and Friday does not produce the company's deliverable.

Current owner, Friday designation, mandate, native resource access and conversation
generation are checked again before the wake and before comments publish. Pause
retains the pending return for resumption; revocation or a conversation reset
prevents stale publication. Duplicate delivery reuses the existing receipt;
startup recovery reconstructs missing historical returns without recurring
history polling. Same-company task handoffs keep their existing behavior.

Verification recipe: direct one disposable company's CEO, retain its task and
source conversation, and complete the task through its native delivery/review
path. Inspect one return and its current evidence; retry delivery and restart
without a second response. Separately pause/resume Friday, reset the conversation,
revoke the mandate, and remove private task/project access before publication.
Each stale audience must be denied, including a later revoked item in a batched
return. [Focused return checks](../../server/src/__tests__/board-direction-return.test.ts)
pass; [database scenarios](../../server/src/__tests__/board-directions.integration.test.ts)
are authored and typechecked but unrun in this sandbox. Loaded-runtime and live
executive-to-Friday acceptance remain recorded separately in the
[execution checkpoint](../../doc/plans/2026-11-06-agentos-completion-ledger.md).

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

Friday’s private portfolio read scope also supports finding actual company CEOs
and department heads, optionally for a readable project. Returned names, native
IDs and status help prepare a company-owned direction; discovery itself cannot
create or start work. Source checks pass and live acceptance remains open.

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
