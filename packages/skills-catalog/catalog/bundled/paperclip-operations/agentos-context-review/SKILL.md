---
name: agentos-context-review
description: Keep Agent OS delegation scoped and review substantial plans with fresh Elephant–Goldfish reviewers. Use for cross-team handoffs, design uncertainty or evidence-backed capability lessons; ordinary clear tasks do not need a review ceremony.
key: paperclipai/bundled/paperclip-operations/agentos-context-review
recommendedForRoles:
  - general
  - manager
  - pm
  - engineer
  - qa
tags:
  - agentos
  - delegation
  - context
  - review
  - learning
---

# Agent OS context and independent review

Keep one context-rich owner accountable for a plan, then use fresh reviewers to
test whether the plan explains itself. This adapts Google's Elephant–Goldfish
Model (EGM) to native Agent OS tasks, documents and audit records. It is a review
method, not a memory database, model trainer or new authorization layer.

## Choose the appropriate depth

For a clear, bounded task, execute within the existing authority and record its
result. For substantial design uncertainty, a cross-team dependency or a proposed
capability improvement, use the following workflow. Existing authorization stays
valid; this skill creates no extra confirmation ritual. Real spending, release,
staffing and instruction-change approvals remain in their native controls.

1. **Bound the work.** Read the assigned task, its company/project, native grants
   and owning manager. Use [scope and handoff rules](references/scope-and-handoffs.md)
   for portfolio → company → department → project → task delegation. A role title
   never grants access. Keep private company facts in their company context.
2. **Prepare a reviewable plan.** The accountable owner is the Elephant. Save the
   outcome, requirements, relevant evidence, dependencies, limits, decisions,
   acceptance checks and rollback in the native task's `plan` document. Record its
   exact revision. Do not ship the preceding conversation as the specification.
3. **Verify fresh-context support.** Inspect the actual harness capabilities.
   Create a fresh reviewer with no conversation/history inheritance and no
   persistent employee/company memory injection. Disable automatic inherited
   context where supported; provide only the bounded review packet and required
   permission/policy instructions. A reused employee session or a request to
   “forget the conversation” is not independent review. If isolation cannot be
   established, mark `independent_review_unavailable`, record why, and ask the
   accountable lead for another harness or review route. A disclosed ordinary
   review may continue within scope, but must never be relabelled Goldfish.
4. **Review with evidence.** Use [review dispatch](references/review-dispatch.md)
   to select the smallest useful set of packaged EGM reviewer prompts and
   standards. Give each reviewer the immutable plan revision, acceptance criteria,
   authorized source excerpts/references and one review question. Do not send the
   author's preferred answer, previous findings, hidden reasoning or unrelated
   memory. Reviewers return findings; they do not mutate source or approve release.
5. **Reconcile and verify.** The owner records each finding, evidence, disposition
   and changed plan revision. Do not erase disagreeing findings. Re-review a
   material correction once with a fresh packet; unresolved blockers return to
   the responsible lead or Friday as a concrete decision. Stop at the task's
   existing time/budget limits. Tests and release checks still verify execution.
6. **Preserve the learning.** Save outputs and bounded rationale using
   [native evidence records](references/evidence-and-learning.md). Propose a
   sanitized reusable lesson only after observed evidence supports it. The
   existing employee capability/version review process owns promotion and
   company opt-in; never rewrite shared memory or skills silently.

Use the configured subscription harness and native capacity controls. No paid
provider, remote memory service or Google account is required by this skill.
Native routines/events own recurrence; do not start a background review poller.

The bundled upstream prompts, standards, commit and Apache-2.0 license are listed
in [source attribution](references/source.md). This package does not assert that
the selected harness has passed an end-to-end isolation test.
