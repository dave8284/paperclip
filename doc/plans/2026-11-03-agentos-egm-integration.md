# AgentOS Elephant–Goldfish integration — 3 November 2026

Status: research, the instruction/evidence slice and a native server-prepared
context receipt are implemented. Live independent-review isolation, qualified
packet dispatch and evaluated lesson promotion remain unqualified. No running employee, company,
provider account or deployed runtime was changed by this work.

## What EGM supplies

Google's Elephant–Goldfish Model pairs an author with substantial context with
fresh reviewers that assess a supplied artifact from distinct perspectives. It
is a collection of prompts, standards and host instructions, not a memory
database, model-training system, agent scheduler or hosted Google service. That
fits AgentOS as a method within its existing tasks, documents, native reviews
and capability system. It does not establish that an agent remembers everything
or improves automatically. [Official project](https://github.com/google/elephant-goldfish-model),
[privacy model](https://github.com/google/elephant-goldfish-model/blob/main/docs/privacy.md).

The upstream repository uses Apache License 2.0. The existing AgentOS bundle
retains the upstream license and copies four reviewer personas and four document
standards unchanged. AgentOS-specific orchestration and evidence instructions
are adaptations; this is not a Google-supported AgentOS integration.
[Upstream license](https://github.com/google/elephant-goldfish-model/blob/main/LICENSE).

### Research and revision evidence

| Source inspected | Finding and application |
| --- | --- |
| Local `AgentOS/.runtime/reference/elephant-goldfish-model`, pinned `b3a35956759bf7f024af2ff061b2e0b44b438e4c` | Existing source for the four bundled personas, four standards and license. Keep the pin and copied sources unchanged in this slice. |
| [Current harness guidance](https://github.com/google/elephant-goldfish-model/blob/main/docs/harnesses.md) | Parent conversation exclusion and host instruction exclusion are different properties. Include both in qualification and record the exact harness/configuration. |
| [Upstream issue 237](https://github.com/google/elephant-goldfish-model/issues/237) | Reports host/project instructions entering nominally fresh reviewers on Codex and Antigravity. A fresh dispatch flag is insufficient evidence. This report is a reason to test AgentOS, not evidence that this AgentOS deployment has been tested. |
| [Current testing guidance](https://github.com/google/elephant-goldfish-model/blob/main/TESTING.md) | Native launch and child completion traces provide stronger evidence than a parent-authored receipt. Installation, execution and isolation need separate checks. |
| [Review architecture](https://github.com/google/elephant-goldfish-model/blob/main/docs/designs/review.md) and [review skill](https://github.com/google/elephant-goldfish-model/blob/main/skills/egm-review/SKILL.md) | Reuse packet preparation, persona/standard pairing, independent findings and author resolution. Keep native AgentOS ownership and authorization. |
| [Review loop](https://github.com/google/elephant-goldfish-model/blob/main/skills/egm-review-loop/SKILL.md) | Use bounded rounds and explicit failure reporting. A silent, interrupted or failed reviewer is not a clean review. Do not import a repeated human confirmation ritual where the user already authorized the work. |

Current upstream uses hyphenated skill directories where the local pin uses
underscores. The current official documents were read through the web, but an
exact current upstream HEAD and full commit comparison could not be confirmed:
local `git ls-remote` could not resolve GitHub and the web commit endpoints did
not yield a usable comparison. These are dated research observations, not a
claim that the pin is current or that every upstream change was reviewed. A
future source refresh must record an exact revision, review its diff and retain
license/attribution before changing the vendored files.

## Native AgentOS ownership

The context-rich owner keeps the authoritative plan, project/source references,
decisions and evidence. A reviewer receives a frozen, scoped packet and a
specific question. It should challenge the artifact without inheriting the
author's entire conversation or unrelated private memory. Required system and
authorization instructions still apply; isolation never justifies stripping
access rules.

| Concern | Existing owner and intended use |
| --- | --- |
| Rich work context | Revisioned native task documents: `plan` and `context-packet`, linked to the company, project, task and accountable owner. Include source versions, constraints, grants, assumptions and evidence. |
| Assignment and review result | Existing native review request/participant flow owns the assigned reviewer, task/run binding, permission checks and acceptance or requested changes. The skill is not an alternate task engine. |
| Reviewer execution | A dedicated native review run needs an explicit, qualified context route. A fresh subagent flag, separate agent name or ordinary employee reset does not alone establish this. |
| Findings and resolution | Preserve `review-<reviewTaskId>` and `review-resolution` documents with the reviewed revision, findings, uncertainty, dispositions and fix/verification evidence. Native review state remains authoritative. |
| Reusable lessons | Keep `lesson-proposal` separate from the reviewed artifact. A lesson becomes reusable only through an authorized, versioned capability/knowledge path with evaluation and rollback evidence. If that path is unavailable, the proposal stays proposed. |
| Model choice | The method can use the user's supported models and existing routing. It does not require a Google model, new paid service or a second orchestration backend. |

Relevant native seams inspected:

- [`native-review-participant.ts`](../../server/src/services/native-runtime/native-review-participant.ts)
  ties assigned native review context to interaction, source run, task, company
  and reviewer, including stale-generation checks. This is assignment evidence,
  not proof of clean reviewer context.
- [`paperclip-runner-tool-authority.ts`](../../server/src/services/native-runtime/paperclip-runner-tool-authority.ts)
  limits native review capabilities to assigned-work inspection and review
  resolution. Qualification must establish the actual enforced tools for the
  chosen adapter; a read-only prompt is insufficient.
- [`plan-review-context.ts`](../../server/src/services/plan-review-context.ts)
  provides bounded document/annotation/review context. Its accumulated review
  history may be useful to an owner but should not automatically become a fresh
  reviewer's packet.
- The administrative session-reset route in
  [`agents.ts`](../../server/src/routes/agents.ts) checks board authority. Do not
  reset a shared employee's unrelated session to manufacture reviewer freshness.
- Native task document writes use revision-aware updates. Reject or rebase a
  stale document write rather than overwriting a newer packet or resolution.

No new memory store, table, recurring polling worker or scheduler is necessary
for the instruction/evidence slice. Further execution belongs to the existing
native runtime and task lifecycle.

## Implemented now

The bundled [`agentos-context-review` skill](../../packages/skills-catalog/catalog/bundled/paperclip-operations/agentos-context-review/SKILL.md)
now separates parent conversation, host instructions/memory, source-read
coverage, actual tool restrictions and native outcomes. Its new
[`qualification.md`](../../packages/skills-catalog/catalog/bundled/paperclip-operations/agentos-context-review/references/qualification.md)
defines the packet manifest and bounded qualification workflow. Dispatch,
evidence/learning and source references carry the same limitations. The package
artifact assertion now requires this reference to ship with the skill.

[`scripts/agentos-context-review-proof.mjs`](../../scripts/agentos-context-review-proof.mjs)
adds a concrete local evidence auditor. It reads only an explicitly selected
pair of retained Codex JSONL traces and a private manifest. It checks native
spawn/result binding to the child session, fresh dispatch settings, a single
completed child turn, no child tool calls, the actual `UNKNOWN` answer, and
separate parent-only/host markers. It rejects missing evidence and observed
leaks instead of treating them as success. Output omits marker values and raw
transcripts and includes SHA-256 digests of the selected exports. It makes no
model calls, discovers no unrelated sessions and writes no application data.

Run it from the source checkout:

```sh
node scripts/agentos-context-review-proof.mjs /path/to/private-probe-manifest.json
```

The manifest format and exit statuses are documented in the qualification
reference. This is a maintainer helper, not an installed employee capability.
It audits a deliberately prepared marker probe; it does not authenticate the
export producer or qualify native task ownership, source coverage, write
containment, every memory provider or review quality. Passing its synthetic unit
tests does not qualify a live runtime.

The native runtime selection boundary also now prepares
`runnerProfileJson.nativeReviewContextReceipt` for an admitted native completion
review. The receipt is derived from the validated assignment and exact saved
execution under the existing run-row lock. It records prompt/context and
instruction/skill digests, provider/session identity, the source decision/run,
the reviewer report run and the authoritative resolution interaction. It does
not accept a parent-supplied receipt from wake or profile data. Recovery retains
an existing receipt only after exact schema/content comparison against the
saved admitted execution, including a full canonical execution digest, and
revalidation of the company/task/reviewer-scoped historical native source graph.
Losing or changing current wake context does not erase that valid historical
evidence or make it current execution authority. Cancellation before selection
does not persist a new receipt. Non-review runs receive no new review receipt.

The receipt's stage is explicitly `server_prepared`. Provider delivery is
`not_observed`; conversation/host-memory isolation, source reads and write
containment remain `unverified`. A working instruction copy is declared when
present; its later contents are not certified by the pinned bundle digest.
The findings/resolution IDs identify native records to inspect, not proof that
a review report or final disposition already exists. This adds durable
preparation evidence without changing review authority, tool grants or outcomes.
It is implemented in
[`native-review-context-receipt.ts`](../../server/src/services/native-runtime/native-review-context-receipt.ts)
and the existing
[`runtime-selection.ts`](../../server/src/services/heartbeat/runtime-selection.ts)
persistence boundary.

The trust boundary is the internally written, locked run row, not a receipt
signature. The inspected agent/run routes and shared mutation schemas do not
accept `runnerProfileJson`. Runtime-mode selection constructs a closed native
profile, and this persistence boundary overwrites any supplied receipt field;
other inspected writers in queue admission, native preparation and status-effect
committers write their own internal fields. Retention reads the existing DB
profile, never a caller's replacement profile. Strict equality rejects extra
fields, altered qualification claims, swapped references and input changes.
Historical references are checked by one scoped database lookup only when a
saved receipt and execution exist. These checks establish internal consistency
within that storage boundary; they do not authenticate an arbitrary export or
protect against an attacker who can rewrite authoritative database rows.

## Remaining execution, in dependency order

1. **Qualify the real adapter context boundary.** Use disposable synthetic work
   under existing authorization. Record exact runtime/model/adapter versions,
   instruction files, memory providers, tool grants and context construction.
   Probe a parent-only marker and separate markers in each relevant host source.
   Retain native parent/child traces, actual child output and the injection
   recipe. Record each dimension as passed, failed, unverified or not run. The
   offline helper can audit supported Codex trace pairs; other schemas need
   explicit support. Do not use production employees or credentials as probes.
2. **Connect that qualified route to native review dispatch.** Bind the frozen
   packet/persona/standard revision to the actual assigned native review run.
   Use the native request/result flow and preserve its authority checks and
   cancellation semantics. The server-prepared receipt is now implemented;
   still needed are an explicit frozen EGM packet and actual provider-delivery,
   source-read and isolation evidence. Keep review tools constrained by the
   owning runtime. Native completion review is not automatically an EGM review.
3. **Prove the full finding/resolution loop.** Dispatch a real synthetic packet
   and inspect native successful reads of the target, persona and standard.
   Exercise missing source, stale revision, denied access, prohibited mutation,
   interruption and retry. None may silently become a clean review. Preserve
   failed attempts. Resolve findings against a corrected revision with evidence;
   bounded rounds end in accepted work or an explicit unresolved outcome.
4. **Evaluate reusable lessons before activation.** Select a genuinely repeated
   failure, propose a scoped instruction/skill change, compare baseline and
   candidate on held-out representative tasks, inspect regressions, and retain
   version/rollback evidence. Use the existing authorized capability lifecycle
   if it supports these operations. Missing support is a tracked integration
   gap, not permission to invent an activation API or claim automatic learning.

Completion requires evidence across all four steps. A skill installation,
prompt-only reviewer, passing marker probe, or stored lesson proposal alone
does not complete the integration.

## Verification ledger

- Offline auditor: **9/9 targeted tests passed on Node 24.22.1**, covering a bounded positive case, host and
  parent leakage despite an `UNKNOWN` answer, missing host evidence, unbound
  parent receipts, tool use, multiple completed turns, missing/late markers,
  inherited/contradictory context flags, exact trace loading, digests and invalid
  JSON. These exercise auditor behavior, not a live model or employee.
- Catalog manifest regenerated from the current shared sources and validates:
  **18 catalog skills**. The narrow package artifact test **passed (1/1)**,
  including the new qualification reference. Validation and the artifact test
  also passed on Node 24.22.1. The initial tsx CLI attempt could not create its
  sandbox IPC socket; using Node's `--import` loader completed generation and
  validation. The initial package test could not write the default npm cache;
  a task-specific `/private/tmp` cache completed the test without changing user
  configuration. No broad application test suite was run for this slice.
- All four bundled personas, four standards and the license are byte-identical
  to the local pinned upstream reference. Scoped `git diff --check` passed.
- Native receipt and existing assignment binding tests: **29/29 passed** on
  Node 24.22.1. Real persistence, recovery, cancellation and spoofed-receipt cases,
  including missing/drifted context and corrupted stored receipt metadata,
  were added to `runtime-selection.test.ts`, but this database suite was **not
  executed**: the session's embedded PostgreSQL attempts consistently failed
  with a sandbox listen permission error. Integrated type validation and the
  database assertions remain unproven until those checks run on a supported
  test host. No model or employee was invoked for this evidence slice.
- Live review isolation, qualified native packet dispatch, source-read/tool
  containment checks, end-to-end findings/resolution and lesson promotion:
  **not run / not completed by this slice**.
