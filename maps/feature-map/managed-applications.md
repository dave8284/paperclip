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
- `coordination`: `managed-applications/coordination` — assign a planning task to a configured coordinator and select a reusable operating team.
- `connections`: `managed-applications/connections` — inspect organization connection health and discovered read/write capabilities.

## How to get to it (user POV)

### `portfolio`

Open `/applications` or the Applications sidebar entry. Add an application with its name, brief and existing repository, or select Start from an idea. Open its detail and use Work map, Kanban, Task list and project filtering. Select a dot to inspect the real task, reported execution and work products. Zoom, fit and pan the map. Native task links expose plans, history, reviews and outputs.

### `operating-team`

Choose Install operating team, or open `/teams-catalog?search=AgentOS`. Preview the package and choose runtime adapters. For a new organization select the full-organization package option. The daily portfolio and weekly role reviews install as paused routines. Configure accounts and activate them through Routines. Assign the application planning task to the coordinator.

### `operating-connections`

Open `/operating-connections`. Inspect model account status, use a native provider setup link, and configure agent bindings. Inspect a tool connection's reported health and active tool catalog; use Configure access to enter its native permissions page. These are organization resources, not inferred application deployment health.

## Driving it with the API and UI

Preconditions: an isolated instance and a company; a configured adapter is additionally required for real agent execution.

### `portfolio`

Automated: [database and access tests](../../server/src/__tests__/managed-applications.test.ts) cover concurrent idempotency, cross-company and private-resource denial, hidden-task filtering, counts, pagination, agent linking and rollback after audit failure. [registration recovery](../../ui/src/pages/Applications.test.tsx) tests lost responses and reloads with mocked API boundaries.

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

Voice is a browser capability: explicit microphone activation writes final transcripts to the existing draft, playback is stoppable, and automatic new-reply speech is opt-in. There is no paid speech API fallback. Component tests cover transcript/permission/cleanup behavior; a real microphone and audible playback are not yet qualified. Live model coordination, account-wide quota queuing and self-deployment remain separate qualification gates.


Friday is now the company landing view, mobile Home and company-switch destination. Native dashboard routes remain available. Its generic conversation focus slot folds history while retaining the original sender, queue, runtime questions, approvals and recovery. Pending inline connection requests and failures reveal their native history controls. The original Canvas orb reports browser voice and observed native-run states; reduced-motion and hidden-page handling stop animation.

The existing `work` and `coordination` capabilities also include on-demand generated displays. Agent publication uses native HTML attachment/artifact work products, resolved against the same conversation's authorized attachment list. The workspace reuses the opaque-origin HTML preview and its bounded text loader. Save for reuse creates a native revision-controlled document `friday-canvas-{attachmentId}` with JSON `{version:1,attachmentId,workProductId}`; it does not modify the published file or the agent's privileges. Reusing a display means reading the saved source and publishing a new attachment. Platform component promotion remains a reviewed engineering change. No new API or permission key is added.

Verification: FridayWorkspace, TaskChatThread, FridayVoiceControls and existing HTML/attachment tests cover arrival, stale-access suppression, saved references, original sending, inline decision visibility and preview isolation attributes. `scripts/agentos-smoke.mjs` additionally checks authenticated agent upload/registration and revision-protected reusable-reference writes against an owned local instance. Real browser animation, microphone and model-driven generation require live qualification.

Friday voice refinement: the light home folds the native composer behind “Type to Friday…”, while keeping its imperative voice sender mounted. Voice turns use native submission receipts and retain drafts on failure or pending review; new replies speak by default with a remembered mute preference and explicit browser-audio errors. Unbound profile-managed agents inherit a compatible coordinator connection choice, subject to the existing native grant and subscription checks. Personal credentials are not propagated; account pools require explicit assignment. Component integration and real-database policy tests cover these boundaries; physical microphone and audio playback remain unqualified.


Friday workspace refinement extends the existing `work` and `coordination` capabilities. `/friday` has an automatic native attention agenda and badge, a project/application/agent-scoped Work panel (galaxy, Kanban, activity and combined modes), agent/skills selection with persistent native individual conversations, routines, artifact browsing and the native audit trail. Source links and the native task inspector retain details; Explore retains management pages. New task/project controls draft a request in the existing composer. URL state supports browser history and preserves a specialist's conversation while opening its display.

GET `/api/companies/{companyId}/friday/work` is a request-driven projection of native records, including projects without application registration. Standard company discovery access is required; restricted agent keys are rejected. Project/task privacy precedes totals and pagination, application scope uses its home-project boundary, and handoffs retain native case-source authorization. Query filters are projectId/applicationId/agentId, status, limit/offset and projectOffset. Project counts and task status totals cover the full authorized scope; rows, assignments, evidence and handoffs are capped with pagination/truncation fields. Messages and work products supply actual dots. Current assignment, task creation, subtask relationships and native case handoffs are distinct edge types. Only observed running assignments or pending recorded handoffs move. This is not a complete distributed trace or a record of uninstrumented external data consumption.

Agents can open a contextual panel by revision-protected writes to the current conversation's native `friday-view` document. The JSON body must match the strict shared FridayView schema. Initial history stays quiet; a new authorized revision opens the requested built-in view. The document carries no executable actions or arbitrary destination URLs. It does not grant access, execute a mutation or resolve an approval. Specialist conversations remain attached to their originating agent while showing a panel.

Automatic attention reuses GET `/api/companies/{companyId}/attention` and the existing decision controls. Optional UUID projectId filters apply before ranking/counts/pagination. This endpoint remains board-only; agents use authorized source APIs. Existing grants, source revisions, native routines and scheduler, task ownership and audit writes remain authoritative. Visible native events coalesce refreshes; hidden tabs defer Friday refreshes and motion. There is no new background polling service or store.

Verification sources: real PostgreSQL `friday-awareness.test.ts`, the project-filter case in `attention-service.test.ts`, UI `friday-workspace.test.ts`, `FridayAttention.test.tsx`, `FridayWorkspace.test.tsx`, `useFridayUpdates.test.tsx`, and the opt-in `scripts/agentos-smoke.mjs`. These cover privacy/counts/pages, recorded handoffs, native action reuse, typed view publication, agent-created paused routines, conversation retention and hidden-tab refresh behavior. They do not certify visual rendering, physical voice input/output, external business providers or autonomous production deployment.
