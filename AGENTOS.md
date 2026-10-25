# AgentOS on Paperclip

This fork adds an application portfolio and reusable operating team to Paperclip. Start at **Applications**, add an existing repository or a new idea, install **AgentOS Operators**, configure an execution connection, and assign the planning task to its coordinator.

The map, Kanban and task list use saved native tasks. Selecting a dot exposes reported execution and work products; native task and agent pages provide the complete history. A pulsing dot means a recorded running execution. Empty or idle work is not animated.

Application team summaries cover all accessible task assignments and project leads, including those beyond the current task page. Filter by a project or agent to inspect its work across the same views. Operator-owned work is labelled separately from unassigned tasks.

## Run from source

Use Node >=24.11, pnpm 9.15.4 and rustup. The runner pins its Rust version in `packages/paperclip-runner/rust-toolchain.toml`.

```sh
pnpm install --frozen-lockfile
pnpm --filter @paperclipai/plugin-sdk build
node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts onboard --data-dir ../.runtime --no-install-service
pnpm dev:once --data-dir ../.runtime
```

Open http://localhost:3100/applications. The data directory contains the local database, workspaces, configuration and artifacts; keep it outside Git. Use the normal Paperclip onboarding/configuration flow for model credentials and agent authentication.

## Operating the team

- **Install operating team** opens the native catalog preview/installer. The package contains eight roles with versioned content and two initially paused routines.
- **Start planning** creates a native task with a stable operation key. Existing applications receive an adoption brief; new ideas receive a first-release brief. The coordinator selects the specialists it needs.
- **Operating connections** shows model account status, organization connection health and discovered read/write tools. Connect a model account there, then configure per-agent bindings, installations, permissions and approvals through native settings.
- Enable recurring reviews after runtime setup. Native routines run independently of the browser while the server and workers are running.
- Use native project, task, agent and routine controls for pauses and budgets. Application lifecycle is descriptive and is not a global stop switch.

GitHub CLI access used to maintain the fork does not automatically connect runtime agents to GitHub, Vercel, Google Cloud or a business account. A stored repository URL is not a provider permission grant. Google Cloud deployment and external business workflows remain unqualified until the corresponding accounts and environments are configured.

The [implementation and qualification plan](doc/plans/2026-10-25-agentos-platform.md) tracks what is implemented and what remains. [Feature/access recipes](maps/feature-map/managed-applications.md) describe the testable behavior. [Docker](doc/DOCKER.md) and [deployment modes](doc/DEPLOYMENT-MODES.md) cover the existing persistent hosting path.

The [Friday operating model](doc/plans/2026-10-25-agentos-platform.md#friday-and-delegated-operating-loops) defines the next build: conversation as the primary control surface, dedicated leads owning recurring pipelines, yes/no agenda decisions, a platform-wide galaxy, and delegated platform engineering through verified deployment. These capabilities are planned; installing the initial role package does not implement them.

For an opt-in check against an owned local instance, run `node scripts/agentos-smoke.mjs`. It exercises both onboarding paths and native task aggregation, then removes its disposable company. It invokes no model or external provider and does not certify a browser journey.

Upstream: [paperclipai/paperclip](https://github.com/paperclipai/paperclip). Original MIT license and history are preserved. No upstream release publishing or cloud credentials are required by the AgentOS fork checks.
