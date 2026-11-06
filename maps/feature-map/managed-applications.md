---
navigation: {"section":"Projects and execution","sectionOrder":40,"order":5}
---

# Application portfolio and operation

AgentOS groups existing Paperclip projects into long-lived applications. Registration supports an existing repository or a new idea. Native projects, tasks, execution, connections, approvals and routines retain ownership of their behavior.

Feature ID: `managed-applications`.

Implementation: [pages](../../ui/src/pages/Applications.tsx), [application detail](../../ui/src/pages/ApplicationDetail.tsx), [routes](../../server/src/routes/managed-applications.ts).

Agent access: [companion](../agent-access-map/managed-applications.md).

## Sub-features

- `registry`: `managed-applications/registry` — register existing/new applications, edit descriptive lifecycle, and associate initiative projects.
- `work`: `managed-applications/work` — inspect authorized work through portfolio counts, map, Kanban, task list and native run/output drill-downs.
- `coordination`: `managed-applications/coordination` — assign a planning task to a company lead and select a reusable operating team.
- `connections`: `managed-applications/connections` — inspect organization connection health and discovered read/write capabilities.

## How to get to it (user POV)

### `portfolio`

Open Settings → Company → Applications and repositories, or `/applications`. Add an application with its name, brief and existing repository, or select Start from an idea. Open its detail and use Work map, Kanban, Task list and project filtering. Select a dot to inspect the real task, reported execution and work products. Zoom, fit and pan the map. Native task links expose plans, history, reviews and outputs. A failed application work refresh hides cached content and actions until a successful retry.

### `operating-team`

Choose Install operating team, or open `/teams-catalog?search=AgentOS`. Preview the package and choose runtime adapters. For a new organization select the full-organization package option. The daily portfolio and weekly role reviews install as paused routines. Configure accounts and activate them through Routines. Choose the application's Planning lead and Start planning; this assigns one native task in that company and does not replace Friday as portfolio coordinator.

### `operating-connections`

Open Settings → Connectors or Models. The native `/operating-connections` route is retained for compatibility, without a redundant application-footer entry. Inspect model account status, use a native provider setup link, and configure agent bindings. Inspect a tool connection's reported health and active tool catalog; use Configure access to enter its native permissions page. These are organization resources, not inferred application deployment health.

## Driving it with the API and UI

Preconditions: an isolated instance and a company; a configured adapter is additionally required for real agent execution.

### `portfolio`

Automated: [database and access tests](../../server/src/__tests__/managed-applications.test.ts) cover concurrent idempotency, cross-company and private-resource denial, hidden-task filtering, counts, pagination, agent linking and rollback after audit failure. [registration recovery](../../ui/src/pages/Applications.test.tsx) tests lost responses and reloads with mocked API boundaries.

[Application detail checks](../../ui/src/pages/ApplicationDetail.test.tsx) cover
company-scoped planning assignment, drill-down and hiding cached content after a
failed access refresh. They do not execute the assigned planning task.

Manual: register both starting paths, reload, link a second initiative, and compare the same tasks across map/board/list. Select a task and inspect its run and output. Run a real assigned task and verify that pulsing follows recorded running state. Disconnect/reconnect the live socket and verify catch-up. Repeat with a private project and an unauthorized actor. No browser pass is implied by these recipes.

### `operating-team`

Automated: native team catalog and installer tests cover package preview/installation contracts. Validate this bundled package with `pnpm --filter @paperclipai/teams-catalog validate`.

Manual: preview and install into a disposable company, inspect eight agents, the two paused scheduled routines and the recorded content hash. Configure an adapter, delegate a small task and inspect its real result. Reinstall with collision handling and inspect conflicts; do not assume a retry is a no-op.

### `operating-connections`

Manual: inspect an unconfigured company, a healthy connection and a failed one. Compare the listed read/write tools with the native catalog. Test actual agent access in the native connection page. Provider operation proof requires configured accounts.

## Gotchas

- Application access inherits the home project's audience. Linking another project never grants access; unauthorized work is filtered before counts and rows.
- Lifecycle is descriptive. It does not implement an application-wide pause. Use native task/project/agent/routine controls.
- Work pages are bounded to 100 tasks by default; counts cover all accessible matching tasks. The team covers all accessible assignments and project leads in the selected projects, independent of task pagination. Filter by an agent to inspect its workload across map, Kanban and list; this does not hide the rest of the team.
- A repository URL does not create a repository or connect an account. GitHub CLI login used to maintain this fork is distinct from a runtime agent's connection.
- Native live updates reconcile active queries on socket connection/reconnection. Animation uses observed running records; idle tasks do not animate. Reduced motion removes pulsing.
- Exact provider stages and outputs exist only when reported. No chain-of-thought view is provided.

## Friday coordination and observation

The existing registry/work/coordination capabilities now include `/friday`, GET/PUT `/api/companies/{companyId}/operating-profile`, and GET `/api/companies/{companyId}/managed-applications/galaxy`. Binding requires a board permission administrator and expectedRevision. Native grants are transferred in the same transaction as the binding and audit. Companies with an operating profile enforce subscription-only model admission and resolved credential selection; companies without one retain their existing behavior.

The galaxy projects native records through the same project/task ACLs before counting or pagination. `kind=application` is the default; `kind=platform` separates internal development and `kind=all` supports cross-portfolio awareness. Dots are bounded and truncation is explicit. Select application/project/task to drill down while Friday stays alongside it. Native conversations own persistence, handoffs and revision-bound approvals.

The Agent Map additionally requests `dataAccess=tools` on the existing Friday
work read. Tool resource points come from native catalog/profile configuration
or recorded invocation connection IDs. Dashed employee/resource links mean
**Profile allows tool**, while solid links to separate tool-action points show
stored attempts and outcomes on the visible task page. Open an action to inspect
its source task; select a resource to inspect its configured and observed links.
Read/write/destructive labels use the invocation's recorded classification;
legacy risk levels stay unclassified, and denied/failed/pending actions retain
their outcomes. These records do not identify every provider dataset or file.

Configuration uses the native board/company boundary. Action history separately
requires native tool-audit access; the map says when it is restricted. Reads are
on demand, without discovery, provider calls or a new timer. At most eight
employees' native effective profiles, 100 configured links and 100 task-linked
actions are projected per company page; cap notices remain visible. Selecting a
project narrows the cohort. No arguments, results, schemas or credentials enter
the projection. Failed source refreshes remove its cached graph records.

Checks: [real graph navigation and access refresh](../../ui/src/components/AgentOSPortfolioMap.test.tsx),
[pan/fit and source inspection](../../ui/src/components/FridayWorkGraph.test.tsx),
[record/permission/action semantics](../../ui/src/lib/friday-graph.test.ts),
and [native database authority/privacy](../../server/src/__tests__/friday-awareness.test.ts).
These establish stored-record behavior, not a successful external provider call.

Voice is a browser capability: explicit microphone activation writes final transcripts to the existing draft, playback is stoppable, and automatic new-reply speech is opt-in. There is no paid speech API fallback. Component tests cover transcript/permission/cleanup behavior; a real microphone and audible playback are not yet qualified. Live model coordination, account-wide quota queuing and self-deployment remain separate qualification gates.


Friday is now the company landing view, mobile Home and company-switch destination. Native dashboard routes remain available. Its generic conversation focus slot folds history while retaining the original sender, queue, runtime questions, approvals and recovery. Pending inline connection requests and failures reveal their native history controls. The original Canvas orb reports browser voice and observed native-run states; reduced-motion and hidden-page handling stop animation.

The existing `work` and `coordination` capabilities also include on-demand generated displays. Agent publication uses native HTML attachment/artifact work products, resolved against the same conversation's authorized attachment list. The workspace reuses the opaque-origin HTML preview and its bounded text loader. Save for reuse creates a native revision-controlled document `friday-canvas-{attachmentId}` with JSON `{version:1,attachmentId,workProductId}`; it does not modify the published file or the agent's privileges. Reusing a display means reading the saved source and publishing a new attachment. Platform component promotion remains a reviewed engineering change. No new API or permission key is added.

Native reusable live tables, lists and task boards additionally use revisioned conversation documents keyed `friday-display-{slug}`. Their strict version-1 data descriptor selects a registered table/list/board (boards require task data), then `tasks` or `projects`, one authorized company, an optional project, a supported task-status filter and 1–100 rows. Saved displays filters by the selected company/project; the document's source company may be the internal Friday coordinator company. Opening/resuming re-reads the authorized document and existing Friday work API, displays company/project labels and observation time, and pages within the native bounds. Existing event invalidation refreshes data without polling; Stop preview unmounts the reader. Scope mismatches, unsupported fields, and access errors never leave cached rows visible. Boards group only the current bounded page and open native tasks for edits. HTML snapshots remain separate; arbitrary generated-component promotion is still unimplemented. Verification: `friday-saved-display.test.ts`, `FridaySavedDisplay.test.tsx`, and `FridayWorkspace.test.tsx` cover parsing, scope, current reads, revocation, pagination, revisions and stop/resume. Browser visual acceptance remains unverified.

If the saved definition read fails, Retry saved display reauthorizes the document
and uses its current revision before requesting any source data. It does not
reuse a cached descriptor or rows after a failed read.

Friday distinguishes reply audio preparation from observed playback. Preparing
reply audio uses the thinking state; Speaking begins only after the local audio
play request succeeds or browser speech emits its start event. Native holds and
interruptions still cancel pending synthesis, and late cancelled starts do not
restore the speaking label. Focused UI checks cover these transitions; physical
microphone, playback quality and room-noise acceptance remain separate.

Verification: FridayWorkspace, TaskChatThread, FridayVoiceControls and existing HTML/attachment tests cover arrival, stale-access suppression, saved references, original sending, inline decision visibility and preview isolation attributes. `scripts/agentos-smoke.mjs` additionally checks authenticated agent upload/registration and revision-protected reusable-reference writes against an owned local instance. Real browser animation, microphone and model-driven generation require live qualification.

Friday voice refinement: the light home folds the native composer behind “Type to Friday…”, while keeping its imperative voice sender mounted. Voice turns use native submission receipts and retain drafts on failure or pending review; new replies speak by default with a remembered mute preference and explicit browser-audio errors. Unbound profile-managed agents inherit a compatible coordinator connection choice, subject to the existing native grant and subscription checks. Personal credentials are not propagated; account pools require explicit assignment. Component integration and real-database policy tests cover these boundaries; physical microphone and audio playback remain unqualified.


Friday workspace refinement extends the existing `work` and `coordination` capabilities. `/friday` has an automatic native attention agenda and badge, a project/application/agent-scoped Work panel (galaxy, Kanban, activity and combined modes), agent/skills selection with persistent native individual conversations, routines, artifact browsing and the native audit trail. Source links and the native task inspector retain details; Explore retains management pages. New task/project controls draft a request in the existing composer. URL state supports browser history and preserves a specialist's conversation while opening its display.

GET `/api/companies/{companyId}/friday/work` is a request-driven projection of native records, including projects without application registration. Standard company discovery access is required; restricted agent keys are rejected. Project/task privacy precedes totals and pagination, application scope uses its home-project boundary, and handoffs retain native case-source authorization. Query filters are projectId/applicationId/agentId, status, limit/offset and projectOffset. Project counts and task status totals cover the full authorized scope; rows, assignments, evidence and handoffs are capped with pagination/truncation fields. Messages and work products supply actual dots. Current assignment, task creation, subtask relationships and native case handoffs are distinct edge types. Only observed running assignments or pending recorded handoffs move. This is not a complete distributed trace or a record of uninstrumented external data consumption.

Agents can open a contextual panel by revision-protected writes to the current conversation's native `friday-view` document. The JSON body must match the strict shared FridayView schema. Initial history stays quiet; a new authorized revision opens the requested built-in view. The document carries no executable actions or arbitrary destination URLs. It does not grant access, execute a mutation or resolve an approval. Specialist conversations remain attached to their originating agent while showing a panel.

Automatic attention reuses GET `/api/companies/{companyId}/attention` and the existing decision controls. Optional UUID projectId filters apply before ranking/counts/pagination. This endpoint remains board-only; agents use authorized source APIs. Existing grants, source revisions, native routines and scheduler, task ownership and audit writes remain authoritative. Visible native events coalesce refreshes; hidden tabs defer Friday refreshes and motion. There is no new background polling service or store.

Verification sources: real PostgreSQL `friday-awareness.test.ts`, the project-filter case in `attention-service.test.ts`, UI `friday-workspace.test.ts`, `FridayAttention.test.tsx`, `FridayWorkspace.test.tsx`, `useFridayUpdates.test.tsx`, and the opt-in `scripts/agentos-smoke.mjs`. These cover privacy/counts/pages, recorded handoffs, native action reuse, typed view publication, agent-created paused routines, conversation retention and hidden-tab refresh behavior. They do not certify visual rendering, physical voice input/output, external business providers or autonomous production deployment.

Agent Map presentation uses Friday's particle renderer for employee glyphs, with pastel declared-role colours and separate solid task/evidence points. Project/application/agent-filtered maps include only employees related to the loaded authorized work; company/portfolio overviews also include available roster employees. Deterministic collision spacing, data-bounded fit, pan, zoom and focus keep records inspectable; Open task reaches the native task inspector. Running visible employees share one capped animation clock; idle, hidden, offscreen and reduced-motion glyphs do not animate. Only recorded pending handoffs/running assignments animate edges. Verification: `FridayWorkGraph.test.tsx`, `FridayWork.test.tsx`, `AgentMapSphere.test.tsx`, and `friday-graph.test.ts`; browser rendering remains unverified.

AgentOS visual identity uses Friday particle artwork for product marks, installed icons, offline/loading states and default employee portraits. Existing uploaded portraits, appearance palette IDs and compatibility URLs remain valid; inherited mascot playback is not loaded by these product components. `scripts/generate-agentos-brand.mjs` deterministically derives SVG/PNG/ICO assets from Friday geometry. Home conversation remains borderless with increased left inset; a docked workspace conversation has an opaque panel. Asset, portrait, onboarding and offline regression tests verify paths/contracts; live browser rendering remains unverified.

Performance extends `managed-applications/work`: open Performance in the company/project/department workspace, choose a month and record source-backed monthly totals. Company figures are separate from project attribution. Scope is resolved by the server before the 500-revision history bound; unrelated projects cannot truncate a selected report. Department coverage includes every accessible project, even those with no report. Missing coverage, mixed financial bases/currencies and truncated history withhold totals; errors hide cached figures, sources and history. Navigation to another company/project/department resets the panel scope. Immutable revisions preserve original evidence. `AgentOSPerformance.test.tsx` covers scope navigation, missing reports, truncation and failed refreshes; `company-performance.test.ts` adds actual database scope/privacy checks, unexecuted in the restricted local sandbox. Live collection from business providers remains unqualified.

Friday's existing `coordination` and `work` capabilities include on-demand diagnosis through GET `/api/companies/{companyId}/friday/diagnostics` (optional projectId, bounded limit/offset). Ask Friday to diagnose a problem: the native conversation directive is injected on new and resumed turns, so installed coordinators receive the guidance after backend activation. The response distinguishes checked/unknown results, shows observation time and native source paths, and pages readable blocked tasks and historical task/conversation failures. Conversation failures require participant identity as well as native task/project privacy. Speech installation readiness does not certify microphone input, playback or latency; saved restart readiness is administrator-only; external connection/capacity checks remain unknown. No inference, provider probes, automatic repairs or polling occur.

Friday and Agent Map particles now use an interior tint without an outer halo; map particles match their category dots. Decision rows initially show a one-line statement, brief context and native actions; expanding reveals proposal details and notes. Required inputs, stale-target blocking and destructive confirmations remain native. Persisted user-facing replies may begin playback while run housekeeping finishes; sentence-first speech and one-chunk local synthesis lookahead reduce serial waiting. This is not token-stream speech or a measured latency result. Interruption and conversation changes stop further lookahead. Runtime guidance asks for a complete useful answer and revision-protected `research` documents for useful source findings.

Local Laya triage adds a read-only diagnostic with explicit disabled, setup-required, unloaded, warming, ready, busy and unavailable states. The check never starts or stops a worker, runs inference, downloads models or changes operator configuration. Configured files alone do not verify model loading; a loaded model does not establish prediction quality. No paid fallback is introduced.

Verification: 113 focused UI tests passed (voice/session, orb/map, decisions), UI/server semantic checks and token gates passed; 22 no-listener diagnostic tests cover actual SQL construction, controlled permission/failure paths, seven local-triage states without inference, direct route handlers, API discovery and dynamic prompt insertion. PostgreSQL privacy execution, browser visuals, physical audio, live agent use, provider readiness and runtime activation remain unverified. The initial diagnostic SQL assertion failure and two invalid UI test-fixture types were corrected; no failed live acceptance was relabeled as passed.


### AgentOS review fixes — 2026-11-04

The department tree is now under Departments; selecting a department opens its
projects. Projects lists actual active projects. Routine creation and editing
use focused dialogs with native saves, errors and revision checks. Performance
rejects stale/malformed payloads with a retryable message; the exact reported
undefined-type browser stack still needs a user retest after restart. Main/map
spheres tint only their interiors with matching dot colors. Decisions use a
compact statement/context/action view and retain full expansion/native gates.
Voice can play a committed reply before unrelated run cleanup and prepares only
one subsequent local speech chunk ahead. Focused source tests pass; browser,
physical audio and native runtime activation are tracked separately in the
[execution log](../../doc/plans/2026-11-04-agentos-platform-fixes.md).

Voice settings now includes an optional response-timing disclosure. It measures
the latest final local transcription (including setup/preview waits), native
message acknowledgment and first playback start using a monotonic clock.
Playback requires Audio.play resolution or browser speech onstart. These are
separate operations, not a correlated total; agent-response/end-to-end timing
is explicitly unmeasured. Durations stay in memory, clear on conversation
changes, and cancelled/stale work cannot overwrite the current scope. The voice
session regressions cover those boundaries; physical audible latency still
requires a user/device check.

The workspace passes the active conversation's company and session key to the
timing panel separately from the selected business settings scope. Platform
Friday's timings therefore remain inspectable while viewing business settings;
the settings API stays company-bound. Missing, mismatched or fully unbound voice
contexts show no retained measurements. `FridayWorkspaceVoiceTiming.test.tsx`
exercises this complete component path.
