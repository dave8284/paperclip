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
scope, data, permissions or release choices belong in the plan. The Agent OS
owner decides what review depth the actual task needs. Do not spawn every persona
for every task or repeatedly review until the reviewer agrees with the author.

## Packet

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

A native child task gives auditability but does not itself prove freshness: some
adapters resume an employee's existing session. Inspect the run/session identity
and adapter's supported context-reset mechanism. If a harness subagent is used,
record its run/event identifier under the owning native review task. Record all
sources permitted to enter context. Do not call a review independently verified
when reset/no-history behavior is only presumed or when no usable receipt exists.

The reviewer returns concise findings and visible evidence, not private hidden
reasoning. The owner stores the report in Agent OS, maps each finding to an action
or explicit disposition and updates the plan revision. The report cannot satisfy
a financial approval or authorize broader data access.
