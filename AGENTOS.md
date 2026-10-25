# AgentOS on Paperclip

This fork adds Friday, an application portfolio and a reusable operating team to Paperclip. Friday is the home screen: an original pulsing point-cloud orb, native typed/voice conversation, and an on-demand workspace. Open **Portfolio** for the galaxy, **Conversation** for the full thread, **Displays** for generated HTML and saved reusable displays, and **Explore** for native dashboards/projects/agents/connections. Install **AgentOS Operators**, bind its Friday agent under Configure Friday, and connect a model subscription through the native account setup. You can also register an existing repository or a new idea from **Applications**.

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

Open http://localhost:3100/friday. The data directory contains the local database, workspaces, configuration and artifacts; keep it outside Git. Use the normal Paperclip onboarding/configuration flow for model credentials and agent authentication.

## Operating the team

- **Install operating team** opens the native catalog preview/installer. The package contains eight roles with versioned content and two initially paused routines.
- **Start planning** creates a native task with a stable operation key. Existing applications receive an adoption brief; new ideas receive a first-release brief. The coordinator selects the specialists it needs.
- **Operating connections** shows model account status, organization connection health and discovered read/write tools. Connect a model account there, then configure per-agent bindings, installations, permissions and approvals through native settings.
- Enable recurring reviews after runtime setup. Native routines run independently of the browser while the server and workers are running.
- Use native project, task, agent and routine controls for pauses and budgets. Application lifecycle is descriptive and is not a global stop switch.

GitHub CLI access used to maintain the fork does not automatically connect runtime agents to GitHub, Vercel, Google Cloud or a business account. A stored repository URL is not a provider permission grant. Google Cloud deployment and external business workflows remain unqualified until the corresponding accounts and environments are configured.

The [implementation and qualification plan](doc/plans/2026-10-25-agentos-platform.md) tracks what is implemented and what remains. [Feature/access recipes](maps/feature-map/managed-applications.md) describe the testable behavior. [Docker](doc/DOCKER.md) and [deployment modes](doc/DEPLOYMENT-MODES.md) cover the existing persistent hosting path.

The [Friday operating model](doc/plans/2026-10-25-agentos-platform.md#friday-and-delegated-operating-loops) defines the operating architecture: conversation as the primary control surface, dedicated leads owning recurring pipelines, yes/no agenda decisions, a platform-wide galaxy, and delegated platform engineering through verified deployment. The combined conversation/galaxy, explicit coordinator binding, internal platform classification, native registry delegation and subscription-only admission are implemented. Live lead creation, recurring business loops, quota queuing and verified self-deployment still require the remaining integration and qualification work; a role instruction is not proof of an executed workflow.

Friday supports typing, browser dictation into an editable draft, reply playback, voice selection and opt-in spoken new replies. Browser dictation may process audio through the browser provider; availability varies. No separately billed speech API is used. Microphone and audible playback must be qualified in a supported browser. See [Web Speech behavior](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API).

Binding Friday creates a subscription-only operating profile. Runtime admission refuses unmanaged credentials; actual resolved API-key connections are rejected for native agents, decision helpers, fast responses and credential reads. Changing a personal default cannot evade this policy. This does not enforce account-wide concurrency or prevent arbitrary code from contacting external services; those require the planned runtime capability and capacity controls.

Internal platform work uses `kind=platform`. The normal portfolio defaults to `kind=application`; Friday can read both with `kind=all`. Moving an entry between kinds retains its project links, tasks and history. The galaxy caps overview dots at 500 task associations per application page and identifies truncation; application drill-down provides task pagination.

For an opt-in check against an owned local instance, run `node scripts/agentos-smoke.mjs`. It exercises both onboarding paths, native task aggregation, coordinator binding, authenticated subordinate hiring/project leadership and graph classification, then removes its disposable company. It invokes no model or external provider and does not certify a browser journey.

Upstream: [paperclipai/paperclip](https://github.com/paperclipai/paperclip). Original MIT license and history are preserved. No upstream release publishing or cloud credentials are required by the AgentOS fork checks.


Friday can publish small, self-contained HTML displays through native attachment and artifact work-product APIs. Newly published displays open beside the orb; existing history does not open itself on arrival during initial loading. The native HTML preview isolates inline code from the parent application. Stop preview removes the frame, and Raw/Download retain access to the source. Displays are immutable snapshots, not autonomous deployments or privileged platform extensions.

Save for reuse writes a revision-controlled `friday-canvas-{attachmentId}` document in the current conversation. Friday's instructions explain how to resolve those references, refresh data and publish a new version. Turning a useful display into a permanent component remains a delegated engineering/release task. No separate scheduler, credential store, canvas database or paid voice API was introduced. The renderer is original Canvas code, visually inspired by [HorizonX's Solving Orb](https://horizonx.so/tools/orb-solving); its points indicate presence and are distinct from the portfolio's record-backed task dots.
