# Scope and handoffs

Company → department → project → task is the work hierarchy. A department groups
projects. Reporting relationships and context scopes express responsibility;
native grants, company membership and provider permissions enforce access.

| Responsible role | Working context | Escalation |
| --- | --- | --- |
| Friday | Authorized portfolio observations, platform capabilities, company leads and unresolved decisions | User decisions, missing cross-company authority, requested platform changes |
| Company CEO | One assigned company, departments, staffing assignments, budgets and company outcomes | Friday for portfolio dependencies or authority beyond that company |
| Department/product/portfolio manager | The explicitly assigned department or authorized set of projects; priorities and dependencies across those projects | CEO for competing company commitments or staffing/budget limits |
| Project lead | One project, its backlog, routines, deliverables, dependencies and assigned workers | Department/product manager for dependencies and trade-offs beyond the project |
| Execution agent | One assigned task, acceptance checks, required inputs and approved tools | Project lead for missing context, blocked dependencies or a scope change |
| Fresh reviewer | Only the supplied plan revision, rubric and authorized source packet | Task owner for missing evidence; no authority to widen scope or publish |

Friday can query project/department leads for current evidence, then consolidate
their replies for the user. Ask in native linked tasks/handoffs so that the query,
owner, source and answer are inspectable. Prefer an existing current report when
it answers the question. Do not generate make-work or wake every employee just
because a dashboard is opened.

Resolve those owners through the native read model:
`GET /api/companies/{companyId}/friday/work`, optionally narrowed by `projectId`
or `agentId`. Use the response's `observedAt` and pagination/truncation metadata.
`tasks[].assigneeAgentId` identifies a task's assigned executor.
`accountability.projects[]` supplies `projectId`, `leadAgentId` and either a
`department` containing `id`, `name`, `leadAgentId`, or null for an ungrouped
project. `accountability.people[]` resolves those IDs and reporting relationships
with `id`, `name`, `role`, `title`, `status` and `reportsTo`.
`accountability.reportingChainTruncated` means the returned reporting chain is
incomplete; disclose that limit and fetch authorized source records if needed.
Follow `nextOffset` and `nextProjectOffset` for remaining work/project pages;
never assume one page is the full portfolio or that a missing lead is implied by
a role title.

Re-read the native task, project/department and responsible agent records before
making an assignment or asking for an update. The snapshot is a routing aid,
not proof of current activity or access. If current source evidence is
insufficient, address a bounded native linked handoff/task to the actual project
or department lead and retain its answer and source links. Missing ownership,
inactive employees or unavailable authorization are explicit blockers. Do not
invent grants, substitute another company's agent or treat a `reportsTo` chain
as permission to read every subordinate's private context.

Before delegating, establish the actual assignee and its current company
assignment, project grant, tool grants and capacity. If no CEO/manager/lead exists,
record the missing assignment and use the native hiring/assignment workflow
within authority; do not invent an employee or silently widen an executor's
access. A shared employee retains its central identity but each assignment needs
its own company/task context. Reusing an identity does not authorize copying
customer records, private conversations, credentials or company-specific memory.

Each handoff carries:

- Native company, department when present, project, parent/task and assignee IDs.
- Expected outcome and acceptance checks; current plan revision and approved limits.
- Minimal source references, observations with timestamps, pending decisions and dependencies.
- Required tools, connections, publication/release authority and relevant native approval receipts.
- A specific result format, next owner, stop condition and escalation destination.

The task owner keeps the packet up to date. Workers return work products,
verification evidence, unresolved uncertainty and a concise decision rationale.
Do not request or fabricate private model chain-of-thought. If the harness cannot
emit a step/tool/subagent event, disclose that visibility gap in the native record.

For a stalled task, escalate upward with the blocker, impact, attempted checks and
smallest required decision. No reply is not permission. Retiring a company
assignment affects that company only; portfolio-wide retirement or capability
promotion follows the central employee governance process.
