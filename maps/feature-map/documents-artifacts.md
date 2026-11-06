---
navigation: {"section":"Tasks and conversations","sectionOrder":20,"order":70}
---

# Documents, attachments, and work products

People read and revise task documents, annotate specific content, open attached files, and inspect the outputs an agent hands back. The artifact library provides another route to the same work.

Feature ID: `documents-artifacts`.

Implementation: [task documents](../../ui/src/components/IssueDocumentsSection.tsx), [artifact library](../../ui/src/pages/Artifacts.tsx), [document panel](../../ui/src/components/task-side-panel/TaskDocumentPanel.tsx).

Agent access: [companion](../agent-access-map/documents-artifacts.md).

## Sub-features

- `documents`: `documents-artifacts/documents` — edit versioned task documents and inspect or restore revisions.
- `annotations`: `documents-artifacts/annotations` — attach feedback to document content and inspect resolution state.
- `attachments`: `documents-artifacts/attachments` — upload, preview, and download allowed files with company access checks.
- `work-products`: `documents-artifacts/work-products` — link deliverables to their source task, resource, and review context.
- `library`: `documents-artifacts/library` — search, filter, group, and open artifact stacks.

## How to get to it (user POV)

### `task-document`

Open a document from the task thread or document side panel.

### `task-output`

Open an attachment, output card, or file link from a task.
For direct uploads, use the task side panel's **Open a new tab → Artifacts →
Upload files** or drop files anywhere in that panel. On mobile, open
**More actions → Properties** first. Agent conversations do not expose this upload path.

### `artifact-library`

Open `/artifacts` and its grouping, search, and media controls.

## Driving it with Playwright and the Paperclip CLI

Preconditions: follow the [baseline](./README.md#before-driving-a-journey). Use a task with a text document, a small attachment, and a generated work product. Use nonsensitive fixture files.

### `task-document`

Automated: [documents service](../../server/src/__tests__/documents-service.test.ts), [annotations](../../server/src/__tests__/document-annotations-service.test.ts), and [revision restore](../../server/src/__tests__/issue-document-restore-routes.test.ts) cover server contracts.

Manual: Edit a paragraph, save, reload, and compare revisions. Add an annotation to a specific selection and inspect it after another edit. Resolve it through the supported action. Restore a disposable revision and confirm the new current document and history agree.

### `task-output`

Automated: [attachment routes](../../server/src/__tests__/issue-attachment-routes.test.ts) and [work products](../../server/src/__tests__/work-products.test.ts) cover data/access behavior; [artifact arrival browser suite](../../tests/e2e/artifact-tab-arrival.spec.ts) targets arrival. [Artifact uploads](../../tests/e2e/artifact-uploads.spec.ts) drives file selection/drop, filename collisions, retry, and preservation of paused/unassigned tasks.

Manual: Upload a small Markdown file and CSV through Artifacts. Markdown becomes
a versioned task document; other files become attachments. Read the document,
download the CSV and compare bytes, then reload. Upload the same Markdown filename
again and verify a separate suffixed document without overwriting the original.
On a paused unassigned task, confirm upload does not start work or add comments.
Verify agent-produced work products separately using an eligible test run.
Test an inaccessible user/company and explicit missing workspace-only resources.

### `artifact-library`

Automated: [artifact page](../../ui/src/pages/Artifacts.test.tsx) covers grouping, search requests, and pagination using mocks.

The native library route now applies company discovery and task/project read
authorization. [Route contracts](../../server/src/__tests__/company-artifacts-route-contract.test.ts)
and [SQL construction checks](../../server/src/__tests__/company-search-sql.test.ts)
passed on 2026-11-04 using controlled dependencies and generated SQL. Added
[persisted regressions](../../server/src/__tests__/company-artifacts-service.test.ts)
remain unrun because this host cannot start the required PostgreSQL/socket fixture.

Manual: Find the task’s output through search and grouping, open its stack, page through results, and reload a direct stack link. Confirm the same file/content appears as from the task. Deny private task outputs and empty groups; a shared child must not reveal a private parent's title. Explicit task access without project membership should retain the artifact while omitting the private project id/name. Repeat with the actual agent and responsible user, including revoked access.

## Gotchas

- A local path is not automatically an uploaded artifact accessible to another user.
- A preview screenshot is not proof that download bytes or revision references are correct.
- Version conflicts and stale annotations must stay visible rather than silently targeting different content.

### Storybook verification

#### `documents`

Capability ID: `documents-artifacts/documents`.

Scope: ui
Storybook: Writable/read-only document, save pending/failure/conflict, revision history/historical preview and restore confirmation.
Production: Persist edited body and reload; append-only restore creates new revision; reject stale writes and inaccessible company/task.
Sources: Source: [IssueDocumentsSection.tsx](../../ui/src/components/IssueDocumentsSection.tsx), [TaskDocumentPanel.tsx](../../ui/src/components/task-side-panel/TaskDocumentPanel.tsx), [documents.ts](../../server/src/services/documents.ts). Tests: [IssueDocumentsSection.test.tsx](../../ui/src/components/IssueDocumentsSection.test.tsx), [document-revisions.test.ts](../../ui/src/lib/document-revisions.test.ts), [documents-service.test.ts](../../server/src/__tests__/documents-service.test.ts), [issue-document-restore-routes.test.ts](../../server/src/__tests__/issue-document-restore-routes.test.ts)

### Documentation scope: Artifacts and work products

Document/attachment/library/work-product journeys are mapped; every media preview type, storage backend, annotation conflict, and runtime-resource lifecycle variant remains separate.


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
