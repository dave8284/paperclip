---
navigation: {"section":"Tasks and conversations","sectionOrder":20,"order":30}
---

# Inbox, decisions, and search

People find work that needs their attention, distinguish unread activity from required decisions, archive handled items, and search across the company.

Feature ID: `inbox-search`.

Implementation: [inbox](../../ui/src/pages/Inbox.tsx), [decisions](../../ui/src/pages/WhatNeedsMe.tsx), [search](../../ui/src/pages/Search.tsx).

Agent access: [companion](../agent-access-map/inbox-search.md).

## Sub-features

- `views`: `inbox-search/views` — use Mine, Recent, Unread, Blocked, and broader task views.
- `triage`: `inbox-search/triage` — read or archive attention items without pretending the underlying task is complete.
- `decisions`: `inbox-search/decisions` — open the source of a decision and act in the right context.
- `search`: `inbox-search/search` — query company work and follow a result to its original record.
- `toasts`: `inbox-search/toasts` — receive live task notifications only for personal participation or explicit mentions.

## How to get to it (user POV)

### `inbox`

Use Inbox links or the corresponding task views when the combined list is enabled.

### `decisions`

Open `/decisions`, then a queue at `/decisions/queues/:key` and its source item.

### `search`

Open `/search` or the navigation search entry. Search across tasks, conversations, comments,
documents, artifacts, employees, projects and routines; the Routines tab opens
matching native routine definitions. Routine search accepts project, employee
assignee, priority and updated-time filters. Task statuses, human assignees and
task labels do not match routine definitions. An empty routine query does not
list the whole company. The Conversations scope narrows the native task/comment/document
search to persistent agent chats with the same authorization, snippets and source links.
It does not index provider sessions or copy transcripts.

### `toasts`

Keep a company page open while another person or agent updates a task.
See [toast semantics](../../doc/TOASTS.md) for eligibility and suppression rules.

## Driving it with Playwright and the Paperclip CLI

Preconditions: follow the [baseline](./README.md#before-driving-a-journey). Seed assigned, unread, blocked, and resolved tasks plus a pending decision. Record the combined Inbox/Tasks experimental setting.

### `inbox`

Automated: [archive routes](../../server/src/__tests__/inbox-archive-routes.test.ts) cover server mutations. [Task-list helpers](../../ui/src/pages/Issues.test.tsx) cover search URLs, pagination, and presentation constants; they do not render the combined Inbox/Tasks page. Reading, archiving, and navigating that page remain manual checks.

Automated: [Issue service regressions](../../server/src/__tests__/issues-service.test.ts)
cover exclusion of historical automatic read cleanup from user participation,
unread counts, and activity timestamps while retaining explicit user decisions
and audit history.

Automated: [Source regressions](../../server/src/__tests__/issues-creation-visibility.test.ts) cover channel attribution, imported comments, direct participation, addressed requests, unread results, and access checks. [Routine regressions](../../server/src/__tests__/routines-service.test.ts) cover fresh, coalesced, and skipped manual runs.
The source regressions also create an addressed request through the service for a
human assignee. They check unread lists, flags, and counts, plus exclusion of
historical questions and closed requests while preserving authorization requests.

Manual: Seed GitHub, Slack, scheduled routine, and manual routine tasks. Attribution, imported comments, and reading alone keep them outside Mine. Direct board/API comments, human assignment, and open addressed requests admit them. Resolve the request and check that another valid reason is needed. Inbox discovery and Blocked hide unrelated automation by default; the **show agent-created tasks** checkbox reveals it without subscribing the user. Reload and verify membership, unread badges, archive/resurfacing, and preference persistence.

Manual: Read an unread task, return to Unread, archive a handled item, and reload. Verify personal triage state changes while task status stays correct. Switch users and companies to check isolation.

Seed a completed task whose only activity under the viewing user is automatic
read cleanup. Refresh Mine and Unread: the task must not appear through that
participation, while the cleanup remains in activity history. Record an explicit
user recovery decision on a separate task and verify it still counts. This
browser journey remains manual.

### `decisions`

Automated: [decision queues](../../server/src/__tests__/decision-queues-routes.test.ts) covers route behavior. End-to-end queue-to-source navigation is manual.

Manual: Open a pending decision, follow its source, resolve it through the supported control, and reload the queue. Confirm it retires only after the decision persisted and unrelated pending items remain.

### `search`

Automated: [search page](../../ui/src/pages/Search.test.tsx) covers routine links,
counts, failed refreshes and company transitions; failed or changed scopes hide
cached results and snippets. [SQL construction regressions](../../server/src/__tests__/company-search-sql.test.ts)
check that routine rows, counts and facets retain attached-project and parent-task
privacy, and artifact project metadata is filtered in the left join while an
explicitly shared task's artifact remains discoverable. These run without a
network listener. [Company search service regressions](../../server/src/__tests__/company-search-service.test.ts)
cover persisted artifact privacy/counts/loosen suggestions, shared-task project
redaction, routine scope isolation, facets, filtering and ranking before the
bounded page. These DB additions remain unrun on the 2026-11-04 host because
PostgreSQL/socket setup is blocked by EPERM; generated SQL is not persisted
privacy proof.

Manual: Search a unique task title and content phrase, open the result, and compare
the actual record. Repeat for a routine title/description, including a paused
routine, project/employee filters and its native detail link. Test a private
project, private parent task, explicitly shared task artifact, no results and a
second company. Verify counts and pages omit denied records, private project
names stay hidden on shared artifacts, and revoked access or a company switch
clears previous results. Live browser and actual agent access remain separate
verification.

### `toasts`

Automated: [persisted eligibility](../../server/src/__tests__/task-toast-eligibility.test.ts)
checks creation, assignment, comments, mentions, deliberate edits, excluded read
activity, company isolation, local-board, and persisted run-task attribution.
[Socket delivery](../../server/src/__tests__/live-events-toast.test.ts) checks
viewer-specific projection; [UI delivery](../../ui/src/context/LiveUpdatesProvider.hook.test.tsx)
checks eligibility gating, cache updates, stale callbacks, and existing suppression.
[UI cache handling](../../ui/src/context/LiveUpdatesProvider.test.ts) checks visible
comment refresh when authenticated events omit hydration metadata.
The `task toasts follow personal involvement in multiplayer` case in the
[authenticated browser suite](../../tests/e2e/multi-user-authenticated.spec.ts)
exercises quiet unrelated updates, read-only visits, first/historical mentions,
self-activity, and visible-task suppression against persisted data.

Manual: Use two authenticated browser sessions in the same isolated company.
Create separate tasks for each person and use one shared agent. From a company
task list, verify that the other person's unrelated task updates produce no
toast but still refresh the list. Comment on one of their tasks, then have them
update it: a toast should appear. Repeat using assignment, a deliberate edit,
and a first explicit user mention in a comment or description. Reload before a
later update to prove eligibility does not depend on browser history. Mere
viewing, agent ownership, responsible-user attribution, and parent participation
must remain quiet. Task-linked failures follow the same participation rule;
generic agent errors remain quiet. Repeat while viewing the relevant task and
after switching company/account to verify suppression and isolation.

## Gotchas

- [Command-palette and keyboard entry points](./navigation-preferences.md#palette-shortcuts) also reach search. Verify quick-filter/query handoff separately from opening the full search route.
- Notifications do not grant task access or change Mine membership.
- A feature-map recipe and mocked UI tests do not prove live multiplayer behavior.

- Combined Inbox/Tasks requires both `enableCombinedInboxTasks` and
  `enableStreamlinedUi`. [Standalone Inbox tests](../../ui/src/pages/Inbox.test.tsx)
  render archive/read controls and toolbars; this is not live multi-user evidence.

- Personal archival is not task cancellation or completion.
- Legacy Inbox routes can redirect to the combined task view; record which host actually rendered.
- Search service tests do not establish the relevance quality of every query.

### Storybook verification

#### `views`

Capability ID: `inbox-search/views`.

Scope: ui
Storybook: Mine/Recent/Unread/Blocked and broader task views; combined versus standalone host; loading/empty/error/filter states.
Production: Use persisted personal participation/read data; verify scoped counts and list navigation/reload; automatic read cleanup must not create Mine membership.
Sources: Source: [Inbox.tsx](../../ui/src/pages/Inbox.tsx), [Issues.tsx](../../ui/src/pages/Issues.tsx). Tests: [Inbox.test.tsx](../../ui/src/pages/Inbox.test.tsx), [Issues.test.tsx](../../ui/src/pages/Issues.test.tsx), [issues-service.test.ts](../../server/src/__tests__/issues-service.test.ts)

#### `toasts`

Capability ID: `inbox-search/toasts`.

Scope: ui
Storybook: Eligible live task toast, explicit mention, quiet unrelated event, own-action/visible-task suppression, dedupe and company/account switch.
Production: Persisted participation and mentions determine per-viewer socket eligibility; quiet events still refresh caches; reload retains eligibility, unauthorized resources remain denied.
Sources: Source: [ToastViewport.tsx](../../ui/src/components/ToastViewport.tsx), [ToastContext.tsx](../../ui/src/context/ToastContext.tsx), [LiveUpdatesProvider.tsx](../../ui/src/context/LiveUpdatesProvider.tsx), [task-toast-eligibility.ts](../../server/src/realtime/task-toast-eligibility.ts). Tests: [ToastContext.test.tsx](../../ui/src/context/ToastContext.test.tsx), [ToastViewport.test.tsx](../../ui/src/components/ToastViewport.test.tsx), [LiveUpdatesProvider.hook.test.tsx](../../ui/src/context/LiveUpdatesProvider.hook.test.tsx), [task-toast-eligibility.test.ts](../../server/src/__tests__/task-toast-eligibility.test.ts), [live-events-toast.test.ts](../../server/src/__tests__/live-events-toast.test.ts), [multi-user-authenticated.spec.ts](../../tests/e2e/multi-user-authenticated.spec.ts)


Friday consumes the existing attention feed and native decision controls. `GET /api/companies/{companyId}/attention` accepts optional UUID `projectId`; the filter runs after authorization/enrichment and before counts, ordering and pagination. Global items without that project are omitted from a project-specific feed. Board-only authorization is unchanged. The project-scope/privacy regression is in `server/src/__tests__/attention-service.test.ts`; Friday grouping/native action wiring is in `ui/src/components/FridayAttention.test.tsx`.

Agent OS decision presentation keeps native resolvers visible without expanding a row. Approvals, join requests and generic confirmations expose Approve/Disapprove; typed-effect proposals expose their specific approval choices and native no-effect Disapprove. Required rejection reasons, selected checkbox items, strict target snapshots, destructive tree previews and server authorization remain enforced. Non-binary blockers and connection setup retain their actual action vocabulary. “Discuss with Friday” carries company, project, source and related-task context; a changed proposal is not approval of the original. Source/DOM coverage: `AttentionQueueRow.test.tsx`, `DecisionCard.test.tsx`, `IssueThreadInteractionCard.test.tsx`, and `FridayAttention.test.tsx`. Browser visual verification remains blocked.

### AgentOS proposal presentation

AgentOS requests the native attention feed with `category=proposals` for Decisions and `category=work` for its Work attention list. Category and project filtering happen after native visibility checks and before counts/pagination; unfiltered callers keep the classic feed. Typed decisions, resolvable approvals/join requests, and explicit interaction confirmations are proposals. Raw failed runs, review stalls and operational alerts stay Work; questions stay conversational. Legacy board-approval records without an inline native resolver remain accessible through their Work source link rather than being relabelled as an executable binary approval.

Approval cards load the actual native payload, recommendation, stated approval effect and risks inline. Unreadable, mismatched-company or no-longer-pending proposals cannot be acted on in this presentation. Native typed decisions retain options, input requirements, effect previews and stale-revision guards. Discuss/alternative instructions carry the selected company, project, native source/task identity and observed proposal context to Friday; they never grant approval. `attention-service.test.ts`, `attention-category.test.ts`, `AttentionQueueRow.test.tsx`, `FridayAttention.test.tsx`, and `FridayWorkBlockers.test.tsx` cover filtering, private-source exclusions, pagination, empty categories and native controls. Browser visuals and actual spoken output remain separate verification.

AgentOS keeps View details / Hide details beside the decision title in both states.
The summary below the title prefers recorded proposal context over a repeated
title or generic waiting reason. It observes the existing resolver's detail cache
without an additional request and excludes failed or mismatched-company reads;
the feed supplies the initial fallback. Home previews use the recorded feed
summary too. A deep-linked decision can be collapsed and remains collapsed after
refresh. The row and Friday attention regressions cover this interaction.
