# Source and limits

The Elephant–Goldfish Model is Google's open-source design/review method:
[google/elephant-goldfish-model](https://github.com/google/elephant-goldfish-model).
The bundled upstream files are pinned to commit
`b3a35956759bf7f024af2ff061b2e0b44b438e4c` and retain the
[Apache License 2.0](upstream/LICENSE).

The four reviewer prompts under `upstream/agents/` and four document standards
under `upstream/resources/document_standards/` are copied unchanged from that
revision. Attribution belongs to the upstream project and its contributors. This
package's `SKILL.md`, scope/handoff rules, dispatch packet and native evidence
workflow are AgentOS adaptations, not a Google-supported AgentOS integration.

The original method pairs a context-rich author with fresh reviewers that lack
the preceding conversation. We use those prompts inside native AgentOS tasks;
we do not install the upstream plugin into the developer's Codex, require a
Google provider, or add any subscription or memory service.

This catalog package supplies instructions and supporting reference files.
Installing it does not provision a CEO, enforce project/task isolation, reset
harness sessions automatically, add a memory engine, expose hidden model
reasoning or certify any adapter's freshness. Those controls require native
authorization/runtime support and measured validation. Where support is missing,
the skill records an explicit limitation rather than claiming independent review.

## Upstream review on 3 November 2026

The pinned reference remains unchanged. Current upstream documentation now uses
hyphenated skill directories and distinguishes parent-turn isolation from
host-instruction exclusion. [Harness documentation](https://github.com/google/elephant-goldfish-model/blob/main/docs/harnesses.md)
and [issue 237](https://github.com/google/elephant-goldfish-model/issues/237)
describe project/user instruction injection despite fresh-context dispatch on
some hosts. Those moving links are research references, not imported updates or
qualification of this AgentOS runtime. The adaptation adds explicit evidence
dimensions and a bounded local audit recipe; it does not claim to fix host
instruction injection. Upstream's exact current HEAD could not be confirmed in
this session, so no pin or bundled upstream source has been advanced.
