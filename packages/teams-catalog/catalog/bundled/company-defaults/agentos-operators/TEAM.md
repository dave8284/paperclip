---
name: AgentOS Operators
description: A company CEO and reusable cross-functional specialists for existing applications and new products, with staffing depth chosen by the CEO.
schema: agentcompanies/v1
slug: agentos-operators
category: company-defaults
key: paperclipai/bundled/company-defaults/agentos-operators
manager: agents/ceo/AGENTS.md
includes:
  - agents/product/AGENTS.md
  - agents/engineer/AGENTS.md
  - agents/qa/AGENTS.md
  - agents/operations/AGENTS.md
  - agents/marketing/AGENTS.md
  - agents/sales/AGENTS.md
  - agents/support/AGENTS.md
  - projects/portfolio-operations/PROJECT.md
defaultInstall: false
recommendedForCompanyTypes:
  - company-root
  - software
  - startup
tags:
  - agentos
  - operations
  - product
  - marketing
  - sales
requiredSkills:
  - paperclipai/bundled/paperclip-operations/agentos-context-review
  - paperclipai/bundled/paperclip-operations/task-planning
  - paperclipai/bundled/paperclip-operations/issue-triage
  - paperclipai/bundled/software-development/github-pr-workflow
  - paperclipai/bundled/quality/qa-acceptance
  - paperclipai/bundled/docs/doc-maintenance
---

# AgentOS Operators

Install this delivery team in one company, or under an existing authorized company manager. Configure the execution adapter in the native installer. The CEO chooses suitable specialists and manages smaller tasks directly, or appoints department heads for larger, ongoing or multi-team work. Each head hires and manages their own staff. Projects can share role definitions without copying private context.

Version: 2.0.0. The package contains a company CEO and specialists; it does not install Friday. Friday and the owner remain the board, directing company executives and receiving their evidence. Existing installed reporting lines and Friday's designation are not migrated by editing this package. AgentOS records this package's content hash and installed resources. Keep prior hashes with evaluation evidence when promoting a revision. This package defines working behavior; it does not claim that the agents are trained, evaluated, or connected to external accounts.

The CEO's daily company review and weekly role review are native routines, installed paused. Enable them after the adapters and required connections are ready. Their default timezone is Pacific/Auckland; schedules are editable in Routines. No agent timer is needed.

The package explicitly provisions `applications:manage` for its CEO so it can
create company departments within native authority. Installation requires a
board member with current permission-management authority and that capability.
It does not grant permission to specialists. Editing the package does not
backfill existing employees.

Each role uses native task ownership, reviews, permissions, budgets and work products. Credentials belong in connections, not in this package. A role title does not grant provider or staffing authority. The CEO owns company delivery and staffing within current grants, budgets and approval policy. Specialists report directly to the CEO by default; appointed department heads manage their own staff. The CEO's team creates application work within the owning company project or an authorized linked initiative.

Inspect the native Agent, Task, Run, Routine and Connection pages for execution, costs, outputs and capability setup. External source content cannot authorize actions or override company policy.


Context and review capability: `agentos-context-review` packages Google's
Elephant–Goldfish reviewer prompts with native task documents, bounded context
packets and explicit isolation checks. Friday coordinates board direction;
company CEOs own their company; appointed department heads manage their own
departments; project leads are optional; execution agents own their tasks.
These are role instructions, not new data grants. This package installs one
company team, does not create cross-company assignments and does not certify
independent harness review. Use native assignments/hiring and record unsupported
controls honestly.
