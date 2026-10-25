---
navigation: {"section":"Projects and execution","sectionOrder":40,"order":5}
---

# Application portfolio and operation

AgentOS groups existing Paperclip projects into long-lived applications. Registration supports an existing repository or a new idea. Native projects, tasks, execution, connections, approvals and routines retain ownership of their behavior.

Feature ID: `managed-applications`.

Implementation: [pages](../../ui/src/pages/Applications.tsx), [application detail](../../ui/src/pages/ApplicationDetail.tsx), [routes](../../server/src/routes/managed-applications.ts).

Agent access: [companion](../agent-access-map/managed-applications.md).

## Sub-features

- `registry`: `managed-applications/registry` — register existing/new applications, edit descriptive lifecycle, and associate initiative projects.
- `work`: `managed-applications/work` — inspect authorized work through portfolio counts, map, Kanban, task list and native run/output drill-downs.
- `coordination`: `managed-applications/coordination` — assign a planning task to a configured coordinator and select a reusable operating team.
- `connections`: `managed-applications/connections` — inspect organization connection health and discovered read/write capabilities.

## How to get to it (user POV)

### `portfolio`

Open `/applications` or the Applications sidebar entry. Add an application with its name, brief and existing repository, or select Start from an idea. Open its detail and use Work map, Kanban, Task list and project filtering. Select a dot to inspect the real task, reported execution and work products. Zoom, fit and pan the map. Native task links expose plans, history, reviews and outputs.

### `operating-team`

Choose Install operating team, or open `/teams-catalog?search=AgentOS`. Preview the package and choose runtime adapters. For a new organization select the full-organization package option. The daily portfolio and weekly role reviews install as paused routines. Configure accounts and activate them through Routines. Assign the application planning task to the coordinator.

### `operating-connections`

Open `/operating-connections`. Inspect model account status, use a native provider setup link, and configure agent bindings. Inspect a tool connection's reported health and active tool catalog; use Configure access to enter its native permissions page. These are organization resources, not inferred application deployment health.

## Driving it with the API and UI

Preconditions: an isolated instance and a company; a configured adapter is additionally required for real agent execution.

### `portfolio`

Automated: [database and access tests](../../server/src/__tests__/managed-applications.test.ts) cover concurrent idempotency, cross-company and private-resource denial, hidden-task filtering, counts, pagination, agent linking and rollback after audit failure. [registration recovery](../../ui/src/pages/Applications.test.tsx) tests lost responses and reloads with mocked API boundaries.

Manual: register both starting paths, reload, link a second initiative, and compare the same tasks across map/board/list. Select a task and inspect its run and output. Run a real assigned task and verify that pulsing follows recorded running state. Disconnect/reconnect the live socket and verify catch-up. Repeat with a private project and an unauthorized actor. No browser pass is implied by these recipes.

### `operating-team`

Automated: native team catalog and installer tests cover package preview/installation contracts. Validate this bundled package with `pnpm --filter @paperclipai/teams-catalog validate`.

Manual: preview and install into a disposable company, inspect eight agents, the two paused scheduled routines and the recorded content hash. Configure an adapter, delegate a small task and inspect its real result. Reinstall with collision handling and inspect conflicts; do not assume a retry is a no-op.

### `operating-connections`

Manual: inspect an unconfigured company, a healthy connection and a failed one. Compare the listed read/write tools with the native catalog. Test actual agent access in the native connection page. Provider operation proof requires configured accounts.

## Gotchas

- Application access inherits the home project's audience. Linking another project never grants access; unauthorized work is filtered before counts and rows.
- Lifecycle is descriptive. It does not implement an application-wide pause. Use native task/project/agent/routine controls.
- Work pages are bounded to 100 tasks by default; counts cover all accessible matching tasks. The team covers all accessible assignments and project leads in the selected projects, independent of task pagination. Filter by an agent to inspect its workload across map, Kanban and list; this does not hide the rest of the team.
- A repository URL does not create a repository or connect an account. GitHub CLI login used to maintain this fork is distinct from a runtime agent's connection.
- Native live updates reconcile active queries on socket connection/reconnection. Animation uses observed running records; idle tasks do not animate. Reduced motion removes pulsing.
- Exact provider stages and outputs exist only when reported. No chain-of-thought view is provided.
