# AgentOS: application operating platform

## Objective

Maintain a real Paperclip fork that coordinates a portfolio of existing, in-flight and new applications. The operator provides a repository or an idea and an operating brief. A coordinator discovers the current state, plans outcomes, selects specialists from a reusable role pool, delegates work and maintains recurring obligations across product, development, QA, operations, marketing, sales and support.

The combined portfolio, application, project, task and agent views must describe persisted work. Every dot represents a record; observed execution drives motion. Native task/run/output pages supply the evidence. Visual polish is deferred in favor of working controls, density, zoom and reliable navigation.

## Provenance and current implementation

- Fork: https://github.com/dave8284/paperclip; branch `agentos/platform`.
- Upstream: https://github.com/paperclipai/paperclip at `d0c8f0b0907afb7706ab78359e11fa226ea4a92e`. Original Git ancestry and MIT license retained.
- Local toolchain: Node 24.22.1, pnpm 9.15.4, package-pinned Rust 1.97.1. Dependencies installed from the frozen lockfile.
- Native Paperclip runs locally with embedded PostgreSQL and durable data outside the source checkout. The GitHub CLI is authenticated and the fork exists. Earlier network restrictions are resolved.
- Implemented: company-scoped application registry; recoverable existing/new registration; linked initiative projects; authorized portfolio counts and paginated work; map/Kanban/list; observed run and work-product drill-downs; native team catalog page; eight-role AgentOS package; paused daily/weekly routines; connection-health/capability inspection; native API discovery; dedicated fork CI.
- A local AgentOS organization contains the installed role package. Installation provenance matches the package hash. The agents briefly paused during native runtime migration and are now idle. No model connection is configured; installation is not evidence of verified execution.
- Required checks and live acceptance are recorded separately below. A working UI, installed role, queued task or configured URL must never be presented as completed external work.

## Architecture

One Paperclip company is the initial portfolio and authorization boundary. An application is the long-lived product. Native projects are its initiatives; native issues are its work. Application access inherits a home project's audience. Linked-project and issue ACLs apply before counts and rows. Standard company agents can link accessible initiative projects; registration, lifecycle edits and unlinking remain operator actions. Restricted keys cannot discover the portfolio.

Paperclip continues to own execution adapters, workspaces, agents, goals, atomic checkout, single-assignee tasks, reviews, documents, work products, routines, durable wakeups, costs, approvals and tool governance. Do not introduce a second scheduler, credential vault or task engine. Applications/connections in the native Apps catalog remain distinct from the products in `managed_applications`.

Role definitions are versioned catalog content with installed content hashes. Credentials, assignment context and budgets remain runtime concerns. Shared improvements must not copy private application data. Run/task evidence and native instruction history support evaluated changes and rollback; a weekly review prompt alone does not certify improved performance.

## Delivery and acceptance

| Stage | Implementation and acceptance | Current state |
| --- | --- | --- |
| 1. Fork and runtime | Preserve ancestry, install supported tools, isolated persistent runtime, CI and push | Fork and local runtime verified; push/check results recorded in delivery |
| 2. Application onboarding | Existing repository or new idea; durable application/home project; retry-safe registration; inspect existing work before changes | Registry and UI implemented; API/database and interrupted-form tests |
| 3. Role pool and coordination | Coordinator plus product, engineer, QA, operations, marketing, sales and support; choose only needed specialists; tasks have owners and outputs | Package and real installation verified; configured model execution still needs qualification |
| 4. Combined views | Portfolio → application → initiative → task/agent → evidence; real counts, privacy, pagination, live catch-up, zoom and reduced motion | Core views implemented; browser tool currently fails before connecting; browser acceptance remains open |
| 5. Provider capability setup | Connect real GitHub/Vercel/GCP and business providers; distinguish discovered tools from agent authority and observed application health | Native GitHub/Vercel and generic MCP reused; capability UI implemented; accounts and live provider proof pending |
| 6. Cross-functional workflows | Engineering PR/review/release; incident investigate/repair/verify; product prioritization; marketing experiment; sales/support outcomes | Role workflows use native tasks and evidence; complete external journeys require connected providers |
| 7. Recurrence and recovery | Explicit schedules/events, deduplication, bounded retries, lease recovery, browser-independent operation | Native scheduler retained; two paused routines installed; application-specific triggers and restart/replay journey need qualification |
| 8. Policy and role quality | Server-enforced grants, approval and budget ceilings, pause/stop, attribution and evaluated instruction versions | Native controls retained; application-wide stop/budget aggregation and evaluation comparison UI remain extensions |
| 9. Persistent deployment | Authenticated control plane/workers, PostgreSQL, durable artifacts, encrypted secrets, backups, restore and live acceptance | Local service runs; hosting account/domain and production qualification pending |

### Onboarding behavior

Existing applications: keep repository history, branches, local changes, open PRs, production state and existing commitments intact. The first coordinator task inventories these facts, writes an evidence-backed plan and delegates bounded next actions. Saving a repository URL does not grant access or clone/rewrite an application.

New applications: persist the brief and planning task first. Select a first useful release, create the repository through authorized GitHub tooling, implement, test, review and deploy a preview through a configured provider. The operator need not choose a pilot application to develop this platform.

The registration form saves an immutable submission intent across reloads. Native project creation and application registration have stable idempotency keys. A partial project registration resumes against the saved project. Unknown outcomes are reconciled before creating a different operation.

### Provider qualification

| Surface | Required behavior | Completion evidence |
| --- | --- | --- |
| GitHub | Discover permitted repositories; inspect issues/PRs/checks; implement on isolated branches; review and merge within authority | Commit/PR/check references and permission-denial tests in a configured repository |
| Vercel | Resolve the correct team/project/environment, inspect failures and create authorized previews/releases | Provider operation ID, deployment URL and observed result |
| Google Cloud | Explicit project/service scope, logs/health and supported deployment/repair operations | Reviewed connection, a configured staging service and recorded action/recovery receipts |
| Marketing/analytics | Supported claims, experiments, reviewable assets, authorized publication and outcome measurement | Assets, publication receipt and metric source; gaps remain explicit |
| Sales/support | Approved records, qualification/triage, authorized outreach or resolution, feedback to product | CRM/helpdesk/email operation receipts and resulting task state |

Use native connection ownership, installations, grants, tool catalogs and approvals. An available write tool is not blanket authority. A model or provider connection is never inferred from this fork's maintainer GitHub CLI login. Do not place credentials in source, role instructions or task descriptions.

Google Cloud currently has no bespoke qualified connector in this fork. Start with a reviewed remote MCP capability or a configured execution environment, following the connection playbook. Inventory actual needed services before adding provider-specific code.

### Remaining product extensions

1. Add application resource bindings for provider project/environment IDs and display observed health/deployment evidence, with source authorization and timestamps.
2. Expand portfolio aggregation to cross-application costs and outcomes. Distinct assigned-agent/project-lead counts and full application assignment summaries are implemented; task pagination does not truncate the team. Per-agent filtering supports workload drill-down across map, Kanban and list. Keep bounded queries and source ACLs.
3. Add an application-wide stop/resume operation using native execution/routine owners, plus project-level budget aggregation. Lifecycle alone must not masquerade as a pause.
4. Promote reusable role versions only after comparable evaluation evidence; surface quality, cost, failures and rollback. Do not allow self-assessment to bypass authority.
5. Qualify runtime configuration, delegation and native API fallback admission, then exercise provider events, duplicate delivery, unknown outcomes, service restart and exhausted budgets.

## Release qualification

Required repository checks: `pnpm -r typecheck`, `pnpm test:run`, `pnpm build`, `pnpm --filter @paperclipai/db check:migrations`, `pnpm check:token-gates`, catalog validation/tests and `node scripts/check-maps.mjs`. Keep original failures visible when a retry succeeds; distinguish fixture tests from browser and provider evidence.

Meaningful targeted coverage includes real PostgreSQL transactions, actor/company/private-resource boundaries, concurrent replay, audit rollback, hidden task filtering, coordinator link rights, API discovery and interrupted UI registration. The dedicated fork CI runs these without depending on the upstream organization's private runner infrastructure.

Local evidence so far: 100 distinct targeted tests have passed across application persistence/access, API discovery, registration recovery, agent drill-down, native installer/app shell, company navigation and the team catalog. Assignment coverage verifies that private/hidden work cannot affect agent counts and that pagination does not truncate the team. `node scripts/agentos-smoke.mjs` passes against the running server for existing/new registration, replay, native tasks, counts, pagination and initiative links, and removes its disposable company. A restart preserved the real application, six tracked delivery tasks, eight agents and two paused routines. Typecheck, build, migration, map and token checks have passed. The [first fork CI run](https://github.com/dave8284/paperclip/actions/runs/40146947400) passed at `3b60c92e4`; the [navigation/API revision](https://github.com/dave8284/paperclip/actions/runs/40147696104) passed at `976504e36`. Later revisions have their own checks. The repository-wide suite is still being qualified; browser automation fails before connection and no provider execution has been certified.

Failures retained in the local qualification record: the first new drill-down UI test queried the next page before React finished rendering; an explicit wait corrected the test, and the two UI cases plus 27 API-discovery tests passed on rerun. One smoke invocation during server startup received connection refused before the listener was ready; after startup recovery completed, the complete smoke passed. Neither retry is evidence of browser or external-provider acceptance.

Live acceptance still requires: adopt an existing application and complete a reviewed change; start a new application and expose a deployed preview; operate two applications without context/authority leakage; recover a staging incident; complete one business workflow through a configured provider; restart/replay/disconnect/exhaust budget without duplicated effects; stop and resume with accurate evidence.

Keep the service local until a hosting destination is chosen. For deployment, build this fork's existing Dockerfile and follow the upstream authenticated deployment and backup procedures. A frontend-only Vercel deployment cannot replace the persistent control plane and workers. Separate platform runtime data and credentials from imported application repositories. Production readiness requires an actual restore exercise and authenticated browser/provider journeys.
