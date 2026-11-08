# Delegation, dependencies, and signoff — agent access

Product map: [Delegation, dependencies, and
signoff](../feature-map/task-coordination.md).

Feature ID: `task-coordination`.

Review date: 2026-10-12. Source commit: `58e16dbddfc9c8d0cf60867f9d9847f0feda055b`.
Native REST transport reconciled in this change; see the
[shared transport contract](README.md#native-rest-transport).

This is a source-reviewed baseline of representative operations and known gaps.
Each capability needs operation-level review before its entire scope can be
qualified. No live agent execution is claimed. Follow the [map contract](../README.md)
for format, permission checks, evidence and maintenance.

## `delegation`

Capability ID: `task-coordination/delegation`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/companies/{companyId}/issues`.

Agent access: `available` — Native create_task/reassign_task; REST / CLI / MCP.

Policy: Task visibility/mutation, task-assignment and ownership policy; review audience
independent; tree controls board-only.

Evidence: `source-only` —
[implementation](../../server/src/routes/issue-tree-control.ts#L95) at the reviewed
commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Parent/child and provenance paths exist; same-company assignment does not remove
protected task/resource policy.

## `dependencies`

Capability ID: `task-coordination/dependencies`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `PATCH /api/issues/{id}`.

Agent access: `available` — Native set_dependencies for the current task; agent REST
/ native `call_api` under mutation and checkout policy.

Policy: Task visibility/mutation, task-assignment and ownership policy; review audience
independent; tree controls board-only.

Evidence: `source-only` —
[implementation](../../server/src/routes/issue-tree-control.ts#L95) at the reviewed
commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Dedicated set_dependencies is current-task scoped. Generic `call_api`
forwards blockedByIssueIds to the REST route and retains its ownership checks.

## `signoff`

Capability ID: `task-coordination/signoff`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `PATCH /api/issues/{id}`.
- `POST /api/issues/{id}/interactions`.
- `PUT|GET|DELETE /api/issues/{id}/runs/{sourceRunId}/egm-packet` prepares,
  inspects or clears exact native document revisions before review admission.
  Current creator/run/responsible-user/reviewer ceilings and source access are
  rechecked; clear requires its receipt. Bound packets use native cancellation.
  Preparation grants no new task access. Qualified native isolated Codex runs
  admit a durable packet-review purpose; other runtimes remain unavailable.
  `read_egm_source` reads only its frozen source manifest; `submit_egm_findings`
  saves one revisioned findings document after complete source coverage. History,
  current-document reads, ordinary writes and `resolve_review` are denied in
  packet mode. The task stays in review for separate accountable-owner resolution.
- `POST /api/agents/{id}/wakeup` with exact `failedRunId` and
  `reason=retry_failed_run` retains the existing board-only retry path. The server
  selects saved review identity; caller-supplied review/task overrides do not
  authorize a new assignment.
- `POST /api/companies/{companyId}/friday/platform-changes` prepares an explicit
  current platform owner's request in a selected internal application. Agents
  cannot authorize it. Native tasks, managed isolated workspace selection,
  independent review stages, immutable document revisions and activity receipts
  own the record and retries. Exact local sources retain company/task access.
  Optional explicit publication copies owner-selected text into a locked native
  destination document; it requires current source/destination owner authority,
  source readability and the original hash, including after serialization waits
  and on replay. Original private references remain in the source audit. It
  grants no standing cross-company access, execution or release authority.
- `GET /api/companies/{companyId}/friday/platform-component-sources/{issueId}/documents/{documentId}/revisions/{revisionId}`
  returns only an exact authorized revision's literal text and SHA-256, bounded
  to 256 KiB with no-store caching. This preview requires current platform-owner
  and native source-task read authority. Agent and MCP OAuth identities are
  denied; the existing native attachment endpoint owns attachment reads.

Agent access: `partial` — Native paperclip_finish/paperclip_block and assigned
resolve_review; legacy agent REST disposition. Exact failed-review retry remains
restricted to the board actor. An agent cannot use this endpoint to grant itself
another run or impersonate the owner.

Policy: Task visibility/mutation, task-assignment and ownership policy; review audience
independent; tree controls board-only. For packet first admission, frozen binding
validation precedes native selection; strict receipt admission follows the
committed native identity before workspace synchronization/provider dispatch.
Exact review retry requires the selected failed company/agent/task and a current
pending native reviewer assignment. The preparation-failure exception requires
the persisted native-runner claim, legacy/preparing state and no committed native
selection, session, process or execution-input evidence. The failed run is not
relabeled native. Route and queue rederive the saved review pair, while normal
cleanup, pause, budget, task and native claim/dispatch gates remain authoritative.
The task's worker assignee does not change; a provisional failed-run identity
cannot authorize review receipt admission.

Evidence: `source-only` —
[implementation](../../server/src/routes/issue-tree-control.ts#L95) at the reviewed
commit above. The 8 November source continuation adds
[retry eligibility](../../server/src/services/native-runtime/native-review-retry.ts),
[route authorization](../../server/src/routes/agents.ts),
[queue revalidation](../../server/src/services/heartbeat/queue.ts) and
[native selection ordering](../../server/src/services/heartbeat/runtime-selection.ts).
Loaded-runtime and live qualification remain separate in the
[execution checkpoint](../../doc/plans/2026-11-06-agentos-completion-ledger.md).

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Focused source verification: saved-evidence and registered-route cases pass for
the exact preselection failure and existing model-rejection path, including
stale/resolved review, wrong company/agent/task, missing native-runner claim,
already-selected/started execution and denied user access. PostgreSQL first-run
selection and retry/duplicate/native-claim cases are authored and typechecked,
but unrun under the current listener restrictions. Current native identity and
review authority must still be demonstrated in the actual runtime.

Gaps: Review policy determines final completion; formal board approval is a different
boundary.

## `tree-control`

Capability ID: `task-coordination/tree-control`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/issues/{id}/tree-control/preview`.
- `POST /api/issues/{id}/tree-holds`.
- `POST /api/issues/{id}/tree-holds/{holdId}/release`.

Agent access: `restricted` — Board-only task-tree APIs.

Policy: Task visibility/mutation, task-assignment and ownership policy; review audience
independent; tree controls board-only.

Evidence: `source-only` —
[implementation](../../server/src/routes/issue-tree-control.ts#L95) at the reviewed
commit above.

Verification: `not-run` — assert the documented agent denial with an owned test fixture;
verify any listed agent request/result path separately. A delegated operation needs its
own policy and access review.

Gaps: Even reads/state/preview require board. There is no agent tree-control path just
from company/task permissions.
