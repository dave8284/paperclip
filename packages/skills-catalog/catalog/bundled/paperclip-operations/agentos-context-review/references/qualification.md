# Review qualification and exact limits

Treat three different properties separately: excluding the author's conversation,
excluding unwanted host/project/employee memory, and preventing reviewer writes.
A fresh-session switch establishes none of the other properties automatically.
System and authorization instructions remain mandatory. Record which host
instructions were included and which contain assumptions that the review must
challenge. Never remove an access rule to make a reviewer appear context-free.

## Native ownership

Use the assigned task's revisioned `plan`, `context-packet`, review report and
`review-resolution` documents. Existing native review requests, linked tasks and
run records own assignment, completion, authority and audit. A mention or a
comment does not launch a review. Session reset is a separate administrative
operation, not a substitute for a dedicated reviewer, and must not reset a shared
employee's unrelated task/session.

Before assigning a review, write a packet manifest containing:

- Company/project/owning-task and accountable owner; exact document revision and
  source revision/digests; requested persona, standard and review question.
- Explicit included source references; excluded author conversation, prior review
  answers, private employee memory and out-of-scope company material.
- Observed harness/version, native task/run/session identities and freshness
  mechanism. Keep requested settings distinct from actual launch receipts.
- Included system/project instructions and memory providers, tool authorization,
  execution limits and read-only enforcement level.
- Findings format and stopping condition. A failed or silent reviewer is `not_run`,
  never a successful review with zero findings.

Record these independent evidence dimensions in the review report:

| Dimension | Required observation |
| --- | --- |
| Native ownership | Actual owning/review task, run/session and child launch/completion records |
| Parent conversation | Fresh launch plus a bounded parent-only marker probe, with actual child output |
| Host instructions/memory | Separate injected-marker probe and manifest of host-added instructions/memory; unknown surfaces remain unknown |
| Source coverage | Successful native read results for the exact target, persona and standard; naming a file does not prove it was read |
| Read-only execution | Actual harness/tool restriction evidence; a prompt saying read-only is only a convention |
| Outcome | Structured findings, uncertainty and the reviewed revision, followed by explicit resolution/evidence |

Do not collapse these into a single `isolated=true`. A passing probe means only
the tested runtime/configuration and marker surfaces passed. Changing harness,
instruction injection or memory configuration invalidates that qualification.

## Bounded qualification workflow

1. Use a disposable synthetic task/workspace under already-authorized execution.
   Do not use customer data or credentials as markers. Do not start production
   employee work merely to test this skill.
2. Put a distinct random marker in the parent-only prompt and each host instruction
   surface being tested. Verify those markers appear in the parent's actual
   retained input. Keep marker values out of the child dispatch and public report.
3. Launch a fresh child whose sole task is to use no tools and return any visible
   marker, or exactly `UNKNOWN`. Retain the child's actual trace and answer. A
   parent summary cannot substitute for it.
4. Inspect parent-turn exclusion and host-instruction exclusion separately. If a
   tested host marker enters the child, record that source and use a cleaner
   supported runtime/context route, or label the result a scoped ordinary review.
5. In a second synthetic task, dispatch the real packet/persona/standard. Inspect
   source reads, tool restrictions, findings and completion. Run a deliberate
   missing-source case and a reviewer interruption; neither may become a clean
   review. Keep the initial failures after any successful recovery.
6. Save the packet, review, finding dispositions, corrected revision and bounded
   proof links in native documents. Propose a reusable lesson separately; no
   global skill/memory update follows automatically.

Platform maintainers have a read-only auditor at
`scripts/agentos-context-review-proof.mjs` in the AgentOS source checkout. It accepts
only an explicitly selected pair of retained Codex traces and a private manifest:

```json
{
  "schemaVersion": 1,
  "traceFormat": "codex-rollout-v1",
  "parentTrace": "parent-probe.jsonl",
  "childTrace": "child-probe.jsonl",
  "parentMarker": "<unique synthetic parent marker, at least 24 characters>",
  "hostMarkers": ["<distinct synthetic host-instruction marker>"]
}
```

Run `node scripts/agentos-context-review-proof.mjs <private-manifest.json>`.
Paths are relative to the manifest. It never starts a model, fetches credentials,
discovers unrelated sessions or mutates AgentOS. It requires native spawn/result
binding to the child session, fresh launch arguments, one completed child turn,
no child tools, the real `UNKNOWN` answer and marker absence from the child trace.
Untested host markers remain `not_run`. Unsupported trace schemas stay unverified.
Exit 0 means the bounded probe passed; 1 means failed; 2 means incomplete/invalid.
Its source hashes identify the audited exports; they do not authenticate their
producer or replace protected original run records. A passing synthetic test of
the auditor does not qualify any live runtime.
