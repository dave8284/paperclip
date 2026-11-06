# Documents, attachments, and work products — agent access

Product map: [Documents, attachments, and work
products](../feature-map/documents-artifacts.md).

Feature ID: `documents-artifacts`.

Review date: 2026-10-12. Source commit: `f981fa3cc10cb8663a87dec60345fbff46d54d0a`.

This is a source-reviewed baseline of representative operations and known gaps.
Each capability needs operation-level review before its entire scope can be
qualified. No live agent execution is claimed. Follow the [map contract](../README.md)
for format, permission checks, evidence and maintenance.

## `documents`

Capability ID: `documents-artifacts/documents`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/issues/{id}/documents`.
- `PUT /api/issues/{id}/documents/{key}`.
- `POST /api/issues/{id}/documents/{key}/revisions/{revisionId}/restore`.

Agent access: `available` — Native list/read/write documents; other-task bridge; REST /
CLI / MCP.

Policy: Task/resource visibility, mutation/checkout ownership, revision/lock guards and
permitted deliverable context.

Evidence: `source-only` — [implementation](../../server/src/routes/issues.ts#L10299) at
the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Supported. Native helpers focus on the active task; generic API or explicit
other-task tools cover additional scope.

## `annotations`

Capability ID: `documents-artifacts/annotations`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/issues/{id}/documents/{key}/annotations`.
- `PATCH /api/issues/{id}/documents/{key}/annotations/{threadId}`.

Agent access: `available` — REST / native call_api.

Policy: Task/resource visibility, mutation/checkout ownership, revision/lock guards and
permitted deliverable context.

Evidence: `source-only` — [implementation](../../server/src/routes/issues.ts#L10299) at
the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Annotation operations exist without a special annotation tool; check revision
anchors and resolver authority.

## `attachments`

Capability ID: `documents-artifacts/attachments`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/companies/{companyId}/issues/{issueId}/attachments`.
- `GET /api/assets/{assetId}/content`.

Agent access: `available` — Native register_deliverable and API multipart/binary
support; REST / CLI / MCP transfers.

Policy: Task/resource visibility, mutation/checkout ownership, revision/lock guards and
permitted deliverable context.

Evidence: `source-only` — [implementation](../../server/src/routes/issues.ts#L10299) at
the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Queue and HTTP/2 sandbox callbacks admit `GET /api/assets/{assetId}/content`,
including screenshot references in task descriptions. The controller still checks
company and task visibility before opening storage.

Gaps: Native API uploads are bounded; attachment reading has target/provider and
permission conditions.

## `work-products`

Capability ID: `documents-artifacts/work-products`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/issues/{id}/work-products`.
- `PATCH /api/work-products/{id}`.

Agent access: `available` — Native register_deliverable for file outputs; REST / native
call_api for metadata.

Policy: Task/resource visibility, mutation/checkout ownership, revision/lock guards and
permitted deliverable context.

Evidence: `source-only` — [implementation](../../server/src/routes/issues.ts#L10299) at
the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: A registered reference does not prove uploaded bytes, external delivery, or
accepted review.

## `library`

Capability ID: `documents-artifacts/library`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/companies/{companyId}/artifacts`.

Agent access: `available` — REST / native call_api.

Policy: Company access and native `company_scope:read` admission are required.
Task and project SQL predicates retain the actual actor and responsible/authorizing
user intersection. A task grant can retain its artifacts while inaccessible
project id/name are redacted. Group selection and ancestor traversal apply the
same task visibility, including empty groups; readable children do not disclose
private parent titles. Starred results use the current board user's identity.

Evidence: `source-only` — 2026-11-04 changes reviewed against base commit
`16997c75b`; [route admission](../../server/src/routes/companies.ts),
[artifact and grouping service](../../server/src/services/company-artifacts.ts),
and [native authorization](../../server/src/services/authorization.ts).

Verification: `not-run` — live agent/database access remains unverified. Four
[route contract tests](../../server/src/__tests__/company-artifacts-route-contract.test.ts)
pass with controlled dependencies, and three
[SQL construction tests](../../server/src/__tests__/company-search-sql.test.ts)
pass without a listener. These cover admission, actual-actor predicate forwarding,
project redaction and selected-group filtering, not persisted access. Added
[database regressions](../../server/src/__tests__/company-artifacts-service.test.ts)
remain unrun under the host's PostgreSQL/socket restriction. With actual
agent/run credentials, verify permitted outputs, private task/company denial,
task-sharing project redaction, and hidden empty/ancestor groups.

Gaps: Library search/filter uses the artifact API; no new tool is needed merely
to mirror the UI. Live agent execution and persisted privacy acceptance remain
open; source and controlled-dependency checks do not qualify them.


### AgentOS files and saved research — 2026-11-04

The library projection also drives project/type folders in Friday. The UI keeps
loaded pages together, labels counts as loaded, and preserves native file and
source-task access. Explicit native document keys `research`, `sources`, and
`web-search` (including suffixed variants), or artifact work-product metadata
`collection: "research"`, add the optional `collection` hint. Other outputs keep
their original types. No raw run logs or arbitrary web calls are exposed by this
view. Saving research uses existing revision-protected task documents and the
same company/task/project authorization; tagging a record grants no access.
The focused folder/pagination/detail UI check passed; browser and real stored
record acceptance remain separate.

After an access refresh fails, Friday's file browser hides cached project/file
names and any selected detail. Selection resolves against the current authorized
list, so a file removed by a successful refresh is no longer displayed. Document
and attachment detail reads also withhold cached content, history and links after
failure; Retry restores only successfully reread content. The
[access-refresh regressions](../../ui/src/components/AgentOSArtifactAccess.test.tsx)
and existing folder behavior check pass. A work product previews its backing file
only when that content path matches the task's current authorized attachment
list. If the backing file disappears, its cached preview and file links disappear
too; the source task remains available for provenance. These checks use
controlled query responses; real stored authorization and browser acceptance
remain separate.

Reopening a native attachment preview re-reads its authorized task list and then
its content without an HTTP cache. Pending or failed reads hide cached text;
401/403/404 content responses also hide download links. Retry rechecks the task
list, and closing the preview aborts its active fetch. No polling is added.
