# Application portfolio — agent access

Product map: [Application portfolio and operation](../feature-map/managed-applications.md).

Feature ID: `managed-applications`.

## `registry`

Capability ID: `managed-applications/registry`.

Review: `baseline`.

API: `present` — GET/POST /api/companies/{companyId}/managed-applications; GET/PATCH /api/companies/{companyId}/managed-applications/{id}; POST /api/companies/{companyId}/managed-applications/{id}/projects; DELETE /api/companies/{companyId}/managed-applications/{id}/projects/{projectId}.

Agent access: `partial` — standard company agents can read and link accessible initiative projects through authenticated REST and the OpenAPI catalog used by native search_api/call_api when enabled. Registration, brief/lifecycle edits and unlinking also allow the native applications:manage grant. Friday binding transfers that grant atomically and requires an operator with users:manage_permissions; restricted keys and project ACLs still apply.

Policy: company admission and the home project's canonical read ACL; both project ACLs for links; restricted skill/task keys rejected. Link writes are idempotent and audited; links grant no audience access. Viewer mutations fail. Native run fallback admission still applies.

Evidence: `verified` — [route/service database tests](../../server/src/__tests__/managed-applications.test.ts) exercise injected standard-agent and board identities against PostgreSQL. Native runner transport and a live provider were not exercised by those tests.

Verification: `passed` — create once under concurrent retries, reject a changed payload under the same key, preserve later edits on replay, reject private/foreign links, check one audit on repeated linking and roll back on audit failure.

Gaps: live native runner API fallback admission needs separate qualification; application-wide pause is not implemented; registry authority is now an explicit native grant.

## `work`

Capability ID: `managed-applications/work`.

Review: `baseline`.

API: `present` — GET /api/companies/{companyId}/managed-applications/{id}/work with bounded offset/limit and optional projectId/assigneeAgentId. Agent assignment aggregates cover all accessible work in the selected projects before task pagination and agent filtering. The portfolio includes distinct assigned-agent/project-lead counts. Native issue execution and work-product endpoints supply selected-task detail.

Agent access: `available` — authenticated standard-agent REST; native API catalog discovery when generic tools are enabled.

Policy: company, home-project, linked-project and issue ACLs before aggregation/pagination; hidden and conversational records excluded through the canonical execution-issue predicate. Run and output reads retain native authorization.

Evidence: `verified` — [database tests](../../server/src/__tests__/managed-applications.test.ts) cover private and hidden tasks before counts, selected project filters and pagination. Visual execution is not certified by this test.

Verification: `passed` — compare counts with permitted records and reject private application/project IDs in the database tests. Audience removal in an open browser still needs its manual journey.

Gaps: browser live-run/animation/reconnect qualification remains a separate acceptance journey.

## `coordination`

Capability ID: `managed-applications/coordination`.

Review: `baseline`.

API: `present` — native POST /api/companies/{companyId}/issues with a stable kickoff idempotency key; native team catalog preview/install endpoints and routine APIs.

Agent access: `partial` — ordinary task delegation and permitted routine/agent operations; team installation requires its native hiring grant. The UI kickoff is an operator action.

Policy: native single-assignee checkout, responsible-user intersection, budgets, approvals, connections, runner mode and capability grants. Package content supplies behavior, not authority. Routines are initially paused.

Evidence: `source-only` — [kickoff](../../ui/src/pages/ApplicationDetail.tsx), [team package](../../packages/teams-catalog/catalog/bundled/company-defaults/agentos-operators/TEAM.md), [team routes](../../server/src/routes/teams-catalog.ts).

Verification: `not-run` — configure adapters, create a planning task, observe real delegated work and outputs, activate a routine and verify restart recovery. Local operator package installation was exercised separately; it does not certify these execution journeys.

Gaps: configured model/provider execution, evaluated role improvement and full end-to-end business workflows need live proof.

## `connections`

Capability ID: `managed-applications/connections`.

Review: `baseline`.

API: `present` — native GET /api/companies/{companyId}/ai-connections, GET /api/companies/{companyId}/tools/connections and GET /api/tool-connections/{connectionId}/catalog. Model setup links use the existing Apps connection flow.

Agent access: `operator-only` — this management view uses board APIs; agents use the native installed tool and connection-request surfaces.

Policy: existing connection ownership, installations, grants and invocation approvals. A catalog write tool is not evidence that a given agent can invoke it.

Evidence: `source-only` — [operating connections page](../../ui/src/pages/OperatingConnections.tsx), [tool client](../../ui/src/api/tools.ts).

Verification: `not-run` — inspect authorized management state; use native per-agent access testing and a real provider receipt to qualify execution.

Gaps: no preconfigured Google Cloud account, no qualified Google Cloud deployment, and no application-specific provider resource mapping in this release.

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
