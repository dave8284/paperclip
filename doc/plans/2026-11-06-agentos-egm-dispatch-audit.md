# Native EGM dispatch audit — 6 November 2026

This records the source audit and subsequent frozen-packet preparation
implementation. It does not qualify a live provider. No provider, employee
session or deployed runtime configuration was changed.
It follows [the existing integration plan](2026-11-03-agentos-egm-integration.md).

## What actually exists

Native completion review does execute a separate assigned reviewer. The
`bind_reviewer` effect commits its interaction and wake together and sets
`forceFreshSession: true` (`status-decision-committer.ts`). Queue admission locks
the issue/wake/run, and `native-review-participant.ts` checks company, task,
source decision/run, reviewer, status generation and current invokability.
Session preparation excludes the prior task session; runtime selection excludes
the normal fresh-session handoff, previous-turn text and case context for this
review. Recovery preserves the admitted execution and its actual ownership.
This is executable ordinary review, not only a written intention to review.

It is **not a frozen packet-only EGM dispatch**:

- The native assignment context identifies an interaction and status decision.
  There is no typed packet/plan/persona/standard revision binding. The review
  prompt serializes the interaction's persisted fields as untrusted evidence.
- Runtime selection still constructs the employee's normal instruction bundle,
  skill snapshot, working instruction copy and connection-instruction snapshot.
  Planning tasks may also receive `buildPlanReviewContext`, including accumulated
  annotations. These are not a declared EGM source allowlist.
- Native review tools are limited to task inspection and resolving the assigned
  review, but `get_task_history` reads author comments; `get_task_context` includes
  task, child and previous-review context; document reads use current documents
  or all revisions, not an admitted packet revision. These reads retain ordinary
  task authorization but do not enforce fresh-review context exclusion.
- Assigned MCP relay is suppressed for native review in the executor. Provider
  shell/file access still follows the configured runtime/environment policy.
  The tool authority explicitly documents this limit; it does not enforce an
  EGM read-only workspace or exclude project/employee memory injection.
- The saved receipt accurately says `server_prepared`, delivery `not_observed`
  and isolation/source coverage/write containment `unverified`. Its exact input
  digest and native references are useful preparation evidence, not observations
  of provider context, source reads or completed findings.

Source owners: `services/native-runtime/status-decision-committer.ts`,
`native-review-dispatch.ts`, `native-review-participant.ts`,
`native-review-prompt.ts`, `native-review-context-receipt.ts`,
`paperclip-runner-tool-authority.ts`, `native-session-executor.ts`,
`runtime-context.ts`; `services/heartbeat/session-preparation.ts` and
`runtime-selection.ts`. All paths are under `server/src`.

## Smallest useful native implementation

Add an explicit EGM review contract to the existing native review lifecycle,
without changing every ordinary completion review into EGM:

1. Bind a revisioned native `context-packet` document, exact plan revision,
   approved source revisions, one selected bundled persona/standard version and
   one question to the review interaction. The existing owner prepares the
   packet. A server loader validates company/task ownership and current source
   access, reads exact revisions, enforces size/count bounds and calculates
   digests. Caller-supplied hashes or text never establish source provenance.
   Add an exact scoped revision read to the document owner rather than scanning
   all historical bodies or introducing another knowledge store.
2. Persist that verified frozen input with the admitted execution under the
   existing run lock. Retries recover those revisions and recheck current
   authorization; they do not silently substitute a newer plan or packet.
   Missing, revoked, stale or incomplete sources stop EGM preparation with a
   precise unavailable state, never a zero-findings success.
3. Route that contract through a declared packet-review runtime capability.
   Preserve mandatory system/authorization instructions and manifest them.
   Exclude ordinary task-history/planning-history/handoff injection and optional
   employee memory; forbid tools that retrieve those excluded surfaces. Expose
   only the frozen source set plus native findings/completion operations. A
   fresh-session flag alone does not establish this capability. Unsupported
   runtime/context controls return `independent_review_unavailable`; they must
   not silently execute and label an ordinary review Goldfish.
4. Bind actual provider launch/source-read/completion events to the saved packet
   digest, run and normalized session. Keep preparation, delivery, source
   coverage, isolation and write containment separate. Record structured
   findings and the target revision in a native report; the accountable owner
   resolves findings separately. EGM findings must not approve a release or
   invent financial/data authority through `resolve_review`.
5. Verify the native flow with synthetic fixtures for exact revision selection,
   changed authorization, cancellation before dispatch, retry/recovery,
   prohibited history/document reads, missing source, interrupted review and
   structured findings. Then perform the existing bounded real-adapter probe
   under authorized disposable execution, retaining failures and actual traces.

Steps 1–2 can be built and checked without starting a provider. They should be
described as frozen packet preparation until steps 3–5 are supported and
observed. Selecting a supported runtime from actual capability evidence is an
implementation decision; absent such evidence, the correct state remains
unavailable. The current repository does not justify claiming a qualified
runtime or removing policy instructions to create one.

## Follow-on scope

Evaluated lesson promotion remains separate from packet dispatch. A report can
propose a sanitized lesson; it cannot silently update shared instructions,
activate a capability or claim improved model performance. The capability owner
and company opt-in/recovery controls remain authoritative.

## Implemented preparation boundary

The native API exposes `PUT`, `GET` and `DELETE` at
`/api/issues/{issueId}/runs/{sourceRunId}/egm-packet`. This is the active author's
source run, so the author prepares before `paperclip_finish` requests a named
reviewer. It does not depend on racing a queued review or manually pausing an
employee. The strict request body is:

```json
{
  "reviewerAgentId": "<named reviewer UUID>",
  "packet": { "documentId": "<context-packet UUID>", "revisionId": "<exact revision UUID>" },
  "target": { "documentId": "<plan UUID>", "revisionId": "<exact revision UUID>" },
  "sources": [],
  "persona": "comprehension",
  "question": "Can a new reader correctly explain the intended behavior?"
}
```

Sources are exact document/revision pairs from the same task, with at most eight
supporting documents, 64 KiB per document and 256 KiB for prepared content.
The reader joins company/task/document/revision identity and bounds body bytes
in SQL. Initial packet/plan revisions must be current; shared document-row locks
serialize this check with revision-aware writers. Later reads use the exact
frozen revisions, even when newer revisions exist. Persona/standard content must
match bundled catalog hashes and is retained with its package/bundle version.

Preparation and clear lock native finalization, issue and source run in order.
An accepted author result blocks new preparation; a stopped/changed owner or
bound interaction blocks clear. Explicit receipt-bound clear can recover an
unbound reviewer mismatch after result submission while the exact author run
still owns the active task. It changes no result or bound review. Identical retry returns the saved receipt,
while a changed request requires clear/reprepare. `DELETE` requires the current
`requestSha256`; after binding use existing authorized native interaction
cancellation. Existing cancellation policy remains unchanged.

Current creator, author, named reviewer, responsible-user and external-authorizer
ceilings are checked separately. Retained creator identity includes its original
company/key-scope limits, without credentials or cached grants. Checks drop
request membership/memo caches, use the native run/issue responsible-user owner,
and recheck account approval, company membership and native task authorization.
Each read revalidates exact document existence/content; `GET` is `no-store`.
Activity records contain IDs and digests, never source bodies.

The native `bind_reviewer` effect consumes only the matching prepared request and
stamps immutable, server-owned `payload.egmPacketPreparation` linkage. A prepared
request with another reviewer conflicts; it cannot fall back to ordinary review.
The assigned review run retains `nativeEgmPacketReceipt` after locked assignment,
generation and source checks. Its stage is `server_prepared`, delivery is
`not_observed`, execution is `independent_review_unavailable`, and isolation,
source reads and write containment remain `unverified`. Runtime selection and
the executor both refuse ordinary dispatch of this marked review, including a
missing/changed marker on a prepared source. Mandatory policy instructions are
unchanged. Ordinary reviews without a prepared EGM request retain their flow.

Steps 3–5 remain open. These changes provide a prepared artifact, native binding,
reversible opt-in and honest unavailable boundary; they do not implement or
demonstrate packet-only provider execution.

Verification: 33 focused owner/route/receipt/SQL and actual bundled-content tests
passed (`/private/tmp/agentos-egm-handoff-tests-20261107.log`). After adding the
common executor fence, its two cases plus the 14 owner checks passed
(`/private/tmp/agentos-egm-executor-clear-final-20261107.log`). The executor checks
use the real exported executor with injected backends and both runnerd modes;
they verify no provider/backend/environment preparation or spawn is called.
The common fence precedes warm-session retirement and attachment staging.
Server semantic checking passed after the final fence
(`/private/tmp/agentos-egm-executor-final-tsc-20261107.log`). The owner tests use controlled
native authorization/database results; exact revision tests inspect real Drizzle
SQL. They do not prove persisted concurrent PostgreSQL behavior. Existing HTTP
and embedded-PostgreSQL integration require listeners unavailable in this
sandbox. No provider or live database was used. Earlier failed test fixtures
remain logged; the fixture was corrected to the actual native `user` table.
The real bundled-content check caught the catalog's `sha256:` content-hash
prefix; the retained schema now preserves that native format. Catalog shipped
checks (11) and npm artifact check (1) passed; the artifact retry used a
task-local writable npm cache after the default cache was denied. No default
cache permissions were changed. Catalog generation, maps and diff checks passed.
