---
navigation: {"section":"Tasks and conversations","sectionOrder":20,"order":20}
---

# Delegation, dependencies, and signoff

A larger task can coordinate child work, dependencies, reviewers, and execution controls while preserving a clear owner and a traceable completion decision.

The native EGM preparation API freezes same-task document revisions and a named
persona/standard before author completion. Prepared packets are inspectable and
can be cleared by receipt before binding; bound requests use native cancellation.
The native local subscription-backed Codex path admits a fresh packet-only review
with frozen-source reads and structured findings. Findings remain separate from
the owner's resolution and task approval. Other provider/runtime combinations
fail closed; source and protocol checks are separate from real-account qualification.

First admission validates the frozen packet before runtime selection, then retains
its review receipt only after the run's native task identity commits and before
workspace synchronization or provider dispatch. A preparation failure preserves
the historical failed run. The owner can retry that exact run through the existing
run retry control if the saved reviewer assignment is still pending. The retry
creates a new attempt; the company's task remains assigned to its worker.

Internal platform applications also expose an owner request form that prepares
a native backlog task, isolated repository selection, independent review stage
and locked request document. Artefact detail also lets the owner review and edit
text from an exact saved document revision or text attachment, then explicitly
publish that copy into an accessible company's internal platform task. Only the
selected text crosses the boundary; original references stay in the source
company's audit. The destination copy is locked and independent of the original.
The release/recovery journey remains open; preparing a task does not start work
or grant deployment or permission changes.
The owner publication path passes desktop/mobile acceptance on a disposable
instance, including exact copied text, retained source provenance, independent
review selection and duplicate-free retry. This does not qualify actual agent
implementation, independent review execution or release.

Feature ID: `task-coordination`.

Implementation: [task thread](../../ui/src/pages/IssueDetail.tsx), [execution policy](../../server/src/services/issues.ts).

Agent access: [companion](../agent-access-map/task-coordination.md).

## Sub-features

- `delegation`: `task-coordination/delegation` — inspect parent/child tasks and the original request behind delegated work.
- `dependencies`: `task-coordination/dependencies` — show blocking tasks and wake eligible work when prerequisites resolve.
- `signoff`: `task-coordination/signoff` — apply the configured implementation/review completion policy.
- `tree-control`: `task-coordination/tree-control` — pause or resume a task tree without bypassing its gates.

## How to get to it (user POV)

### `task-relationships`

Open the task’s parent/child and dependency links in task detail.

### `review-and-controls`

Native governance waits preserve an already pending review's status decision and
version. A late child-result turn must not invalidate the queued reviewer while
leaving its card pending. The PostgreSQL control-plane fixture exercises that
sequence through subsequent reviewer admission/resolution; current live proof is
tracked in the AgentOS completion ledger.
An authoritatively withdrawn plain confirmation reaches its assignee as cancelled
administrative context with the recorded reason; it is never approval. Governed
tool/secret actions retain separate checks. Real PostgreSQL withdrawal tests cover
native service withdrawal through runtime response materialization.

Inspect the task’s execution policy and available review, pause, resume, or stop controls.

## Driving it with Playwright and the Paperclip API

Preconditions: follow the [baseline](./README.md#before-driving-a-journey). Prepare a parent, child, and dependent task plus implementer/reviewer agents. Record execution policy and use a disposable tree.

Parent/dependency navigation and inherited tree holds can be checked on unassigned
tasks. Agents are required for the continuation and signoff portion. A tree pause
creates a hold; it does not change task statuses to a paused status.

### `task-relationships`

Automated: [dependency wakeups](../../server/src/__tests__/issue-dependency-wakeups-routes.test.ts) checks server behavior; visual relationship navigation remains a manual check.

Manual: Block one task on another, finish the prerequisite, and observe the dependent task’s eligible continuation. Follow parent/child links back to the source request. Verify no duplicate run or false parent completion occurs.

### `review-and-controls`

Automated: [execution policy](../../server/src/__tests__/issue-execution-policy.test.ts), [tree control](../../server/src/__tests__/issue-tree-control-service.test.ts), and [signoff browser suite](../../tests/e2e/signoff-policy.spec.ts) target these layers. A linked suite is not a claim that its current run is green.

The source continuation's [saved retry evidence](../../server/src/services/native-runtime/native-review-retry.test.ts)
and focused [registered route checks](../../server/src/__tests__/agent-live-run-routes.test.ts)
pass without a listener. They cover preselection preparation failure, existing
model-rejection retry, exact saved identity, current pending assignment and denied
caller/task access. The [database retry scenario](../../server/src/services/native-runtime/native-provider-failure.integration.test.ts)
adds saved-context recovery, forged-context rejection, duplicate receipt and
native reviewer claim while retaining the worker assignee. It is authored and
typechecked but unrun here. The fresh-run [selection fixture](../../server/src/services/heartbeat/runtime-selection.test.ts)
starts with legacy/null native identity; its PostgreSQL execution and real-account
first admission/retry remain separate acceptance checks.

Manual: Complete implementation under a review-required policy and confirm it waits for the required review outcome. Exercise rejection and later approval. Pause the parent while child work is pending, then verify resumption respects budget and ownership gates.

For a review that fails before provider dispatch, retry the selected failed run
once and inspect its new attempt, unchanged historical record and unchanged task
assignee. Resolve or reassign the review before a second attempt and verify the
stale retry is rejected. Native session, process, cleanup, pause, budget and task
holds remain enforced; retry acknowledgement alone does not prove execution.

## Gotchas

- Review completion and task completion are different events under some policies.
- Pausing a tree must not be “tested” by changing statuses until the screen looks quiet.
- Use [questions and approvals](./questions-and-approvals.md) for decision forms and [recovery](./recovery.md) for interrupted work.
