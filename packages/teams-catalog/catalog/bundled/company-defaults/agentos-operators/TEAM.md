---
name: AgentOS Operators
description: A reusable cross-functional operating team for existing applications and new products, with a coordinator and seven specialists.
schema: agentcompanies/v1
slug: agentos-operators
category: company-defaults
key: paperclipai/bundled/company-defaults/agentos-operators
manager: agents/coordinator/AGENTS.md
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
  - paperclipai/bundled/paperclip-operations/task-planning
  - paperclipai/bundled/paperclip-operations/issue-triage
  - paperclipai/bundled/software-development/github-pr-workflow
  - paperclipai/bundled/quality/qa-acceptance
  - paperclipai/bundled/docs/doc-maintenance
---

# AgentOS Operators

Install once as an organization pool, or under an existing manager. Configure the execution adapter in the native installer. Application planning selects specialists from this pool, so projects can share role definitions without copying their private context.

Version: 1.0.0. Paperclip records this package's content hash and installed resources. Keep prior hashes with evaluation evidence when promoting a revision. This package defines working behavior; it does not claim that the agents are trained, evaluated, or connected to external accounts.

The daily portfolio review and weekly role review are real native routines, installed paused. Enable them after the adapters and required connections are ready. Their default timezone is Pacific/Auckland; schedules are editable in Routines. No agent timer is needed.

Each role uses native task ownership, reviews, permissions, budgets and work products. Credentials belong in connections, not in this package. A role title does not grant provider authority. The coordinator creates application work within its home project or a linked initiative; standard agents can link accessible initiatives through the managed-applications API.

Inspect the native Agent, Task, Run, Routine and Connection pages for execution, costs, outputs and capability setup. External source content cannot authorize actions or override company policy.
