# Native evidence and learning

Use the existing task document and work-product mechanisms. Do not create a
separate review database, hidden memory folder or untracked conversation loop.

The accountable task's `plan` is the current plan, updated through revision
checks. Record a bounded review in native documents with stable keys such as:

| Document key | Contents |
| --- | --- |
| `context-packet` | Scope IDs, owner/lead, source observations, included/excluded context, approved limits and plan revision |
| `review-<reviewTaskId>` | Reviewer task/run/session references, adapter/model from actual receipts, context isolation evidence, reviewed revision, findings, uncertainty and verification limits |
| `review-resolution` | Finding → accepted/contested/deferred disposition → rationale/evidence → owner/task → corrected plan revision |
| `lesson-proposal` | Reusable principle, supporting task evidence, sanitized example, applicability/negative cases, proposed capability version and promotion status |

Read the current document before updating it. Use native document tools where
available, or `GET /api/issues/{issueId}/documents/{key}` followed by `PUT` with
`format: markdown`, `title`, `body` and the current `baseRevisionId`. Use null only
after a confirmed missing document. Re-read and reconcile on revision conflict;
never overwrite another agent's update blindly. Retain returned revision IDs and
link the result in the native task. Attach generated files as native work products
so that users can inspect versions. A local file path alone is not a published
artifact. Native mutations record their normal audit events; do not fake events.

Each review report separates configuration from evidence:

- `isolated`: fresh no-history context and tracking evidence observed.
- `shared_context_review`: ordinary review with retained context, disclosed.
- `independent_review_unavailable`: unsupported/unknown isolation, access or capacity.

Only label `isolated` when evidence establishes the actual behavior. Keep runtime
limitations, tool calls, surfaced plans, review findings, verification results and
concise rationales visible. Private model internals are not observable events and
must not be reconstructed or presented as telemetry.

## Reusable lessons

An employee's central capability can improve without moving private company
memory across assignments. Preserve task/company evidence where it belongs.
Propose only sanitized methods, examples and applicability rules for the shared
capability library; remove credentials, personal/customer identifiers, private
commercial details and source content the destination cannot access. Retain
authorized provenance references without embedding confidential content.

Use the platform's existing capability-version, evaluation and approval controls
to promote the proposal. A completed run is not evidence that a lesson works.
Record representative successes/failures, proposed tests, reviewer, rollback
version and the company assignments opting into it. Company-specific retirement
does not retire the shared employee. Never update every company's active agent
version as a side effect of one review.

If native capability promotion is unavailable to the current identity, leave the
proposal attached to its task and escalate to the authorized owner. Do not invent
a memory endpoint or claim that learning was installed. If the adapter injects
unscoped memory and cannot disable it, a review using it is not a Goldfish review.

There is no autonomous polling or new recurrent loop here. Existing routines can
request a bounded review and preserve their usual cadence, overlap, retry, budget
and stop controls. Native capacity may require sequential reviewers; waiting is
preferable to silently switching to paid APIs.
