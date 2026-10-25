# Application portfolio — agent access

Product map: [Application portfolio and operation](../feature-map/managed-applications.md).

Feature ID: `managed-applications`.

## `registry`

Capability ID: `managed-applications/registry`.

Review: `baseline`.

API: `present` — GET/POST /api/companies/{companyId}/managed-applications; GET/PATCH /api/companies/{companyId}/managed-applications/{id}; POST /api/companies/{companyId}/managed-applications/{id}/projects; DELETE /api/companies/{companyId}/managed-applications/{id}/projects/{projectId}.

Agent access: `partial` — standard company agents can read and link accessible initiative projects through authenticated REST and the OpenAPI catalog used by native search_api/call_api when enabled. Registration, brief/lifecycle edits and unlinking are operator-only.

Policy: company admission and the home project's canonical read ACL; both project ACLs for links; restricted skill/task keys rejected. Link writes are idempotent and audited; links grant no audience access. Viewer mutations fail. Native run fallback admission still applies.

Evidence: `verified` — [route/service database tests](../../server/src/__tests__/managed-applications.test.ts) exercise injected standard-agent and board identities against PostgreSQL. Native runner transport and a live provider were not exercised by those tests.

Verification: `passed` — create once under concurrent retries, reject a changed payload under the same key, preserve later edits on replay, reject private/foreign links, check one audit on repeated linking and roll back on audit failure.

Gaps: live native runner API fallback admission needs separate qualification; application-wide pause and agent registration authority are not implemented.

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
