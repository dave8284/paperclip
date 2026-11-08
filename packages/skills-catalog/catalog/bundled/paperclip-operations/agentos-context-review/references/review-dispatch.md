# Fresh reviewer dispatch

These local files are included in the skill installation. Read the selected
persona and standard, then pass them with the packet to a genuinely fresh
reviewer. The upstream paths beginning `resources/` are relative to the bundled
`upstream/` directory below, not the application's repository root.

| Review question | Persona | Standard |
| --- | --- | --- |
| Does this solve the root problem at the right scope? | [Zoom out](upstream/agents/zoom_out.md) | [Zoom out standard](upstream/resources/document_standards/zoom-out-standard.md) |
| Could a new reader correctly explain the intended behavior? | [Comprehension](upstream/agents/comprehension.md) | [Re-implementation standard](upstream/resources/document_standards/re-implementation-standard.md) |
| What assumptions, failure cases or design risks are unsupported? | [Design critic](upstream/agents/design_critic.md) | [Feature specification standard](upstream/resources/document_standards/feature-spec-standard.md) |
| Can an executor implement and verify this without unresolved material design choices? | [Implementation readiness](upstream/agents/implementation_readiness.md) | [Implementation readiness standard](upstream/resources/document_standards/implementation-readiness-standard.md) |

Use `Mode: REVIEW` and provide `Target Standard` explicitly. Include the complete
current target document, or a clearly identified section with sufficient context.
Routine implementation details may stay with the executor; unresolved material
scope, data, permissions or release choices belong in the plan. The AgentOS
owner decides what review depth the actual task needs. Do not spawn every persona
for every task or repeatedly review until the reviewer agrees with the author.

## Packet

### Native preparation API

An active native author run can freeze its packet before submitting its result:
`PUT /api/issues/{issueId}/runs/{sourceRunId}/egm-packet`. Supply
`reviewerAgentId`, exact `{documentId, revisionId}` pairs in `packet` (the task's
`context-packet` document), `target` (its `plan` document), and `sources`, plus
`persona` (`zoom_out`, `comprehension`, `design_critic` or
`implementation_readiness`) and `question`. All sources belong to the same task.
At most eight supporting documents are allowed, each at most 64 KiB; total
prepared content is bounded to 256 KiB. The native owner loads the selected
packaged persona/standard and calculates the receipt. Do not supply hashes or
claimed isolation evidence.

`GET` on the same resource reauthorizes and returns the exact saved packet.
Before binding, `DELETE` with `{ "requestSha256": "<receipt>" }` clears it while
the exact author run still owns the active task. This explicit opt-out can also
recover an unbound reviewer mismatch after result submission; it changes no
submitted result. New preparation after submission is forbidden. Once bound, an authorized operator
uses native review cancellation. Prepare while the author run is active, then
name the same reviewer in its native completion request; another reviewer
conflicts instead of silently running an ordinary review.

Preparation returns `stage: server_prepared`, `execution:
pending_native_admission` and `providerDelivery: not_observed`. The retained
packet's conservative `independent_review_unavailable` field describes
preparation alone. It is not the final execution verdict. Native Codex supports
the separate packet-review path: isolated home, a private empty workspace,
per-turn session, no inherited conversation/planning/employee memory, and only
`read_egm_source` and `submit_egm_findings` tools. Other or ordinary execution
paths reject an opted-in packet rather than silently dropping isolation.

After preparation, use the native completion tool with
`reportedWorkDisposition: needs_review` and an attention request
`{ "kind": "review", "ownerClass": "agent", "targetAgentId": "<same reviewer>",
"summary": "Review the prepared frozen packet" }`. Supply the other fields
required by the actual completion contract. Wait for its receipt and yield;
creating a separate ordinary review task does not activate this packet path.

Inspect the admitted reviewer run, frozen source-read receipts, findings
document and execution evidence before describing isolation or success. A
preparation response, configured profile or successful process alone proves
neither. The packet reviewer records findings against the exact target; it does
not approve the task or resolve the native review interaction. The accountable
owner records finding dispositions and any corrected revisions separately.
Missing sources, unsupported execution or an interrupted review remain blocked
or `not_run`. An explicitly chosen ordinary review requires clearing/cancelling
the packet opt-in and must retain its weaker classification. The qualification
requirements below still apply.

### Review contents

```text
Mode: REVIEW
Owning task: <native task ID and authorized company/project>
Review task/run: <native tracking reference>
Target: <plan document key, revision ID, source revision/hash, selected section>
Outcome and acceptance: <specified behavior and measurable checks>
Authorized evidence: <bounded source excerpts or read-only references>
Persona and Target Standard: <exact packaged file paths/text above>
Scope limits: <read-only, permitted sources, budget and stopping condition>
Question: <one concrete review question>
Context isolation: <fresh session mechanism and available receipt>
Output: findings with severity, target location, evidence, impact, suggested
        correction and any unavailable verification. Do not edit or approve.
```

Use a fresh independent context for each reviewer. Disable conversation forking,
session reuse, automatic workspace memory and retrieval of the owner's chat.
When the harness requires permission/system instructions, retain them and list
them in the context manifest; never strip authorization rules to get “zero
context.” Restrict tools to authorized read-only sources where the harness
supports that control. Instructions asking for read-only behavior alone are not
an enforced tool sandbox: record the actual enforcement level.

Fresh parent turns and host instruction exclusion are separate properties. Read
[qualification](qualification.md) before describing a review as isolated. A
clean parent-marker probe cannot establish that an employee's instruction files
or automatic memory were absent. Give substantive assumptions as explicit review
criteria, and record required instructions that remain in context.

A native child task gives auditability but does not itself prove freshness: some
adapters resume an employee's existing session. Inspect the run/session identity
and adapter's supported context-reset mechanism. If a harness subagent is used,
record its run/event identifier under the owning native review task. Record all
sources permitted to enter context. Do not call a review independently verified
when reset/no-history behavior is only presumed or when no usable receipt exists.

The reviewer returns concise findings and visible evidence, not private hidden
reasoning. The owner stores the report in AgentOS, maps each finding to an action
or explicit disposition and updates the plan revision. The report cannot satisfy
a financial approval or authorize broader data access.
