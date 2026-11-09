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

`GET /api/companies/{companyId}/friday/work?dataAccess=tools` adds a bounded
operator projection to the existing `work` capability; ordinary work reads do
not load it. Native effective-profile configuration remains board/company-only.
Stored actions independently require the same board, company and
`tools:view_audit` authority as native gateway audit, including its existing
local-operator/instance-admin exceptions. A Friday/standard agent's work-read
authority never admits either management projection. Company-shared portfolio
mandate summaries omit it entirely.

The [projection](../../server/src/services/friday-data-access.ts) delegates
configured selection to the native tool-profile resolver, for up to eight
authorized in-scope employees and 100 links. Stored `tool_invocations` are
company-filtered and restricted to the already-authorized loaded task IDs before
their 100-row cap. Unlinked/private/foreign task actions and their counts are
not included. Related agent/catalog/connection IDs are joined to the same
company. Only identity, tool classification, status and observation times are
projected; arguments/results, provider schemas and credentials are omitted.
Configured permissions and observed actions have separate access/cap flags.
Profile inclusion is not proof of effective credential/policy admission, nor of
an executed data read/write. Only explicit recorded read/write/destructive
classifications receive those labels; other risk classes stay unknown. Exact
provider dataset/file identity is outside this native evidence contract.

[PostgreSQL route checks](../../server/src/__tests__/friday-awareness.test.ts)
cover these authority boundaries, loaded-task paging, private/foreign/unlinked
exclusion, output minimization, outcomes and caps. UI checks use the actual
graph component for action-to-source-task navigation and failed-refresh
suppression. They do not certify an external provider operation.

Voice is a browser capability: explicit microphone activation writes final transcripts to the existing draft, playback is stoppable, and automatic new-reply speech is opt-in. There is no paid speech API fallback. Component tests cover transcript/permission/cleanup behavior; a real microphone and audible playback are not yet qualified. Live model coordination, account-wide quota queuing and self-deployment remain separate qualification gates.


Friday is now the company landing view, mobile Home and company-switch destination. Native dashboard routes remain available. Its generic conversation focus slot folds history while retaining the original sender, queue, runtime questions, approvals and recovery. Pending inline connection requests and failures reveal their native history controls. The original Canvas orb reports browser voice and observed native-run states; reduced-motion and hidden-page handling stop animation.

The existing `work` and `coordination` capabilities also include on-demand generated displays. Agent publication uses native HTML attachment/artifact work products, resolved against the same conversation's authorized attachment list. The workspace reuses the opaque-origin HTML preview and its bounded text loader. Save for reuse creates a native revision-controlled document `friday-canvas-{attachmentId}` with JSON `{version:1,attachmentId,workProductId}`; it does not modify the published file or the agent's privileges. Reusing a display means reading the saved source and publishing a new attachment. Platform component promotion remains a reviewed engineering change. No new API or permission key is added.

Native live-table publication uses the existing task-document read/upsert tool or `GET/PUT /api/issues/{conversationIssueId}/documents/friday-display-{slug}`, with normal document ownership and baseRevisionId conflict checks. A strict version-1 descriptor contains a table title, tasks/projects source, target company UUID, optional project UUID, bounded page size and supported status filter. The source document must match the current authorized conversation/company; target scope must match the selected accessible company/project. The UI then reauthorizes the document and reads `GET /api/companies/{companyId}/friday/work` under the viewing actor. This is data-only presentation: it grants no company/project permission or agent access to the viewer's response, introduces no query/URL/code proxy, and changes no mutations or approval gates. Stop unmounts the reader; errors suppress cached rows. UI/parser tests establish bounded rendering behavior, not agent publication or live-browser proof. Arbitrary generated-component promotion remains open.

The descriptor's registered `kind` may be `table`, `list` or `board`; boards require
task data. If the saved definition read fails, Retry saved display reauthorizes
the document and uses its current revision before requesting any source data. It
does not reuse a cached descriptor or rows after a failed read.

Friday's visible speaking state follows the existing observed playback timing,
not the synthesis request. This changes no speech endpoint or actor authority.
The operator/company voice API still owns local speech preparation, transcription
and synthesis; UI transition checks do not establish physical audio acceptance.

Before Friday connects, fallback typing uses the native tab-scoped draft store
keyed to the confirmed account and coordinator company. A ready conversation
offers an explicit append to its native composer, never sends automatically or
overwrites an existing draft, and keeps the saved copy when a pending native
submission or unavailable storage prevents a confirmed handoff. This adds no
server endpoint, permission or autonomous submission path.

Verification: FridayWorkspace, TaskChatThread, FridayVoiceControls and existing HTML/attachment tests cover arrival, stale-access suppression, saved references, original sending, inline decision visibility and preview isolation attributes. `scripts/agentos-smoke.mjs` additionally checks authenticated agent upload/registration and revision-protected reusable-reference writes against an owned local instance. Real browser animation, microphone and model-driven generation require live qualification.

Friday voice refinement: the light home folds the native composer behind “Type to Friday…”, while keeping its imperative voice sender mounted. Voice turns use native submission receipts and retain drafts on failure or pending review; new replies speak by default with a remembered mute preference and explicit browser-audio errors. Unbound profile-managed agents inherit a compatible coordinator connection choice, subject to the existing native grant and subscription checks. Personal credentials are not propagated; account pools require explicit assignment. Component integration and real-database policy tests cover these boundaries; physical microphone and audio playback remain unqualified.


Friday workspace refinement extends the existing `work` and `coordination` capabilities. `/friday` has an automatic native attention agenda and badge, a project/application/agent-scoped Work panel (galaxy, Kanban, activity and combined modes), agent/skills selection with persistent native individual conversations, routines, artifact browsing and the native audit trail. Source links and the native task inspector retain details; Explore retains management pages. New task/project controls draft a request in the existing composer. URL state supports browser history and preserves a specialist's conversation while opening its display.

GET `/api/companies/{companyId}/friday/work` is a request-driven projection of native records, including projects without application registration. Standard company discovery access is required; restricted agent keys are rejected. Project/task privacy precedes totals and pagination, application scope uses its home-project boundary, and handoffs retain native case-source authorization. Query filters are projectId/applicationId/agentId, status, limit/offset and projectOffset. Project counts and task status totals cover the full authorized scope; rows, assignments, evidence and handoffs are capped with pagination/truncation fields. Messages and work products supply actual dots. Current assignment, task creation, subtask relationships and native case handoffs are distinct edge types. Only observed running assignments or pending recorded handoffs move. This is not a complete distributed trace or a record of uninstrumented external data consumption.

Agents can open a contextual panel by revision-protected writes to the current conversation's native `friday-view` document. The JSON body must match the strict shared FridayView schema. Initial history stays quiet; a new authorized revision opens the requested built-in view. The document carries no executable actions or arbitrary destination URLs. It does not grant access, execute a mutation or resolve an approval. Specialist conversations remain attached to their originating agent while showing a panel.

Automatic attention reuses GET `/api/companies/{companyId}/attention` and the existing decision controls. Optional UUID projectId filters apply before ranking/counts/pagination. This endpoint remains board-only; agents use authorized source APIs. Existing grants, source revisions, native routines and scheduler, task ownership and audit writes remain authoritative. Visible native events coalesce refreshes; hidden tabs defer Friday refreshes and motion. There is no new background polling service or store.

Verification sources: real PostgreSQL `friday-awareness.test.ts`, the project-filter case in `attention-service.test.ts`, UI `friday-workspace.test.ts`, `FridayAttention.test.tsx`, `FridayWorkspace.test.tsx`, `useFridayUpdates.test.tsx`, and the opt-in `scripts/agentos-smoke.mjs`. These cover privacy/counts/pages, recorded handoffs, native action reuse, typed view publication, agent-created paused routines, conversation retention and hidden-tab refresh behavior. They do not certify visual rendering, physical voice input/output, external business providers or autonomous production deployment.

Agent Map glyph/spacing/zoom changes are browser presentation only and add no data API or grant. Focused maps restrict roster display to employees linked by projected assignments, project leads, tasks, evidence or handoffs. Company/portfolio overviews retain authorized available employees. Task/evidence selection preserves native IDs and opens existing authorized task detail. Particle glyphs are not claimed as additional data records or an external execution trace; motion follows observed runs and recorded pending handoffs. DOM/data tests cover scope, task opening and shared animation cleanup, not visual or live-agent verification.

Performance within `managed-applications/work` uses GET/POST `/api/companies/{companyId}/friday/performance`, discoverable through native API search/call. Reads require standard company discovery and native project visibility. The query accepts a reporting month and `scope=all|company|project|department`; project/department require `scopeId`, while all/company reject it. Omitted scope retains the existing all-scope API behavior. The response includes authorized `scopeProjectIds`, including unreported projects, and explicitly marks history truncation. Scope and project privacy precede the bounded history query. Foreign/inaccessible project IDs and foreign department IDs return not found. Writes retain `applications:manage`, project visibility, immutable audit and expected-report conflict control. UI/schema tests passed; PostgreSQL read-scope and privacy cases are written but not run in this sandbox. These are operator/agent-authenticated native records; no provider collection, financial reconciliation or live agent use is implied.

Within `managed-applications/coordination` and `managed-applications/work`, API `present`: GET `/api/companies/{companyId}/friday/diagnostics`, discovered via native `search_api`/`call_api` as a read in Standard, Ask and Plan modes. Agent access `partial`: current-company standard agent credentials and fresh native company admission are required; task/project read predicates precede bounded pages. Failed conversation discovery additionally matches the board conversation owner or the assigned conversation agent plus its responsible user and any external authorizer. Hidden, company-wide and unbound runs are excluded; no raw run output, provider payload, credential or private deployment path is returned. Instance restart readiness remains administrator-only and connection/capacity probing is not implemented. The endpoint never repairs, restarts, polls or changes billing/authority. Each checked result has a native source path; per-check nextOffset and observation time bound coverage.

The same authorized diagnostic response includes `local_triage` with a safe `localTriageStatus` enum. It uses read-only worker inspection and exposes no model path, credentials, task inputs or logs. Disabled/setup-required/cold/warming/ready/busy/unavailable distinguish installation and resource state; no check starts, stops or infers with the model. Configuration remains instance-operator controlled; no paid fallback or routing authority follows from readiness.

Evidence `source-only`: `friday-diagnostics.test.ts` and `friday-diagnostics-contract.test.ts` passed using actual Drizzle SQL construction, controlled authorization/results and direct handlers without a listener, including local-triage states and private failure suppression without inference. Native API discovery and bound-company URL construction are exercised; real PostgreSQL privacy, active-run transport, live Friday diagnosis and deployed readiness are not verified. Dynamic native conversation guidance (including resume deltas) supplies diagnosis, complete spoken answers and revision-protected research publication instructions; template edits alone are not claimed to update an installed agent. Voice playback consumes persisted native comments and the existing authorized native progress/final projection for the exact conversation agent, never reasoning or raw tool output. Local synthesis retains one bounded lookahead chunk and existing opt-in/hold/scope controls. No new mutation permission or provider fallback is introduced.


### AgentOS review fixes — 2026-11-04

The department tree is now under Departments; selecting a department opens its
projects. Projects lists actual active projects. Routine creation and editing
use focused dialogs with native saves, errors and revision checks. Performance
rejects stale/malformed payloads with a retryable message; the exact reported
undefined-type browser stack still needs a user retest after restart. Main/map
spheres tint only their interiors with matching dot colors. Decisions use a
compact statement/context/action view and retain full expansion/native gates.
Voice can play normalized user-facing assistant progress while tools continue,
and final-answer sentences before persistence, reconciling the same native run's
saved comment without replay. Stable message completion closes each speech buffer;
current playback plus the latest waiting update bounds lag without extra inference
jobs. Final answers replace unspoken progress; interruption cancels both. Reasoning,
raw tool output, missing source identity, pending native interactions and
foreign employee streams are excluded. Cancellation propagates through the
existing board/company voice POST request to its owned local worker; it grants
no additional authority and preserves other queued callers and the separate
recognition lane. Provider generation, capture and playback remain separate.
Stable normalized native item identity prevents delta/completion replay; missing
identity falls back to the persisted comment. The existing conversation-company
socket supplies only a run/sequence hint for coalesced authorized event reads,
not answer text or selected-company authority. Historical terminal reads are
bounded to two, with current/settling runs prioritized; scope teardown cancels
active reads and queued work. This adds no socket, endpoint, grant or agent action.
The queue wakes only for new text or request completion and has one synthesis
lookahead; idle expiry and hidden-page/scope teardown remain. Focused tests pass; browser,
physical audio and native runtime activation are tracked separately in the
[execution log](../../doc/plans/2026-11-04-agentos-platform-fixes.md).

Voice timing disclosure (2026-11-05) adds no endpoint, agent grant, persistent
record, telemetry or background polling. It observes client operation boundaries
using a monotonic clock and stores durations only in memory. Scope changes reset
measurements; cancelled/stale callbacks cannot attribute old work to the new
conversation. Native reply/run correlation is absent, so agent-response and
end-to-end timings remain unmeasured rather than inferred from overlapping turns.

Inspection requires the explicitly active conversation company/session pair;
the display's business company is not substituted for Friday's platform context.
The settings API retains its original selected-company scope. Missing,
mismatched and fully unbound voice contexts cannot expose retained timings.
