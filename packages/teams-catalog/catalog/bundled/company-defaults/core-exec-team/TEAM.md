---
name: Core Exec Team
description: Default leadership and engineering team for bootstrapping an AgentOS company with a CEO, CTO, QA Engineer, starter project, and a recurring CEO heartbeat review task.
schema: agentcompanies/v1
slug: core-exec-team
category: company-defaults
key: paperclipai/bundled/company-defaults/core-exec-team
manager: agents/ceo/AGENTS.md
includes:
  - agents/cto/AGENTS.md
  - agents/qa/AGENTS.md
  - projects/first-project/PROJECT.md
defaultInstall: true
recommendedForCompanyTypes:
  - startup
  - software
  - generalist
tags:
  - default
  - executive
  - engineering
  - qa
requiredSkills:
  - paperclipai/bundled/paperclip-operations/task-planning
  - paperclipai/bundled/paperclip-operations/issue-triage
  - paperclipai/bundled/software-development/github-pr-workflow
  - paperclipai/bundled/quality/qa-acceptance
---

# Core Exec Team

The Core Exec Team is a bundled starter option for a new AgentOS company. Its CEO, CTO and QA roles offer one way to plan, deliver and verify a board direction; this structure is not required for every task. The CEO may manage specialists directly for smaller work or appoint department heads as the company's needs grow. Heads hire and manage their own staff within current company permissions, budgets and approval policy. Friday and the owner remain at board level.

## Contents

- `CEO` — strategy, prioritization, delegation. Uses `task-planning` and `issue-triage` to keep the inbox moving.
- `CTO` — technical execution and engineering oversight. Reports to CEO. Uses `github-pr-workflow` for code review and merge hygiene.
- `QA` — verifies fixes and captures evidence. Reports to CTO. Uses `qa-acceptance` for structured acceptance reports.
- `first-project` — starter project under the CTO for converting the company goal into the first implementation task.
- `first-heartbeat` — recurring CEO heartbeat to review priorities and confirm the next useful task.

## Migration notes

This entry mirrors the historical `server/src/onboarding-assets/ceo/` template family while staying inside the catalog package boundary. Each agent has a short role description in `AGENTS.md`. Runtime procedures come from the harness, repository instructions, and installed skills. Legacy persona files are not part of catalog imports.
