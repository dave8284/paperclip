# Agent OS functional refinement

User decisions: departments group projects; Stripe live changes require explicit approval. Deployment stays local. Implementation happens directly in this checkout.

## Latest accepted refinements

- Friday occupies the full white home canvas. Orb click toggles a far-left,
  borderless, shadow-free transcript; the top-right mic controls listening.
  Speech never opens the transcript by itself. Live words occupy the status area
  below the orb. Listening, thinking and speaking have distinct colours.
  Enabled voice supports interruption and continued turns during execution.
- Agent OS does not mount the legacy command palette. Ordinary clarification
  stays conversational; real action approvals retain native resolution.
- Settings is last in the bottom-left navigation, below Saved displays. It owns
  Company profile/deletion, Voice, Connectors and Models. Company deletion does
  not appear in Workforce or ordinary work headers.
- Company selection scopes all views. Departments appear above Projects in the
  sidebar; department heads and native project leads are explicitly assigned.
  Avoid a duplicate Departments/Projects tab layer.
- Decisions expose native approve/disapprove or their actual effect choices
  without an opening modal. Alternative instructions and discussion retain source
  context. Blockers with no binary resolution must not pretend an approval ran.
- Employee map nodes use Friday-style pastel dotted orbs, with distinct solid
  task/evidence records, real activity, drill-down and zoom controls.
- Company Performance has department/project filters and source-backed monthly
  revisions. Missing metrics stay missing. The separate Model Intelligence
  product has a central task-family/profile/outcome learning library; company-wide
  private receipts are administrator-only.
- Higgsfield account MCP is in the catalog; the operator deferred provider sign-in.
  Supabase CLI now uses the intended GitHub-linked account and a new Free-plan
  AgentOS project. Its company connection is project-pinned and a native storage
  read passed. The local application database has not been migrated.
- Google `elephant-goldfish-model` is the verified source for the requested
  context-rich planning / isolated-review method. Native Agent OS records,
  grants and audit remain authoritative; a role label never grants data access.

The owner explicitly requested parallel subagents for these final refinements.
Their changes are reviewed and tested together in this checkout; no platform
agent is asked to implement the application itself.

## Ownership and delivery

- Friday UI: persistent opt-in voice session across routes, automatic silence turn boundary, inline transcript on home, minimised transcript on navigation. Native chat owns sending, history and runtime approval resolution.
- Local speech: isolated Whisper + Kokoro worker owned by the server, private stdin/stdout protocol, bounded requests and resource expiry. No login daemon, API billing, retained microphone recordings or runtime model downloads.
- Company structure: new company-scoped department metadata and project memberships. Native projects retain authorization, tasks and workspaces. Composite foreign keys prevent cross-company grouping. Department deletion leaves projects intact. Mutations are transactional and audited.
- Record UI: visible task detail replaces map/work until Back; native decision resolvers plus full task context and alternatives; audit table; dedicated projects/departments navigation and Settings workspace.
- Routines: native routine definitions, triggers, runs, tasks and output references. Diagram distinguishes recorded execution from next-trigger configuration. Create paused, review then start; no fictional publish/measure events.
- Artefacts: native immutable attachments and document revisions, preview/download and per-task file history. Do not infer that every pair of similarly named files is a revision chain.
- Stripe: native Apps connection and vault, catalog classification and invocation ledger. A stored Stripe application identity imposes per-action review before otherwise permitted writes; reads retain native grants. No live Stripe action is executed by this implementation session.
- Model intelligence: `@agentos/model-intelligence` now owns SQLite selection/evaluation receipts, evidence-gated policy, task pins, rollback and a standalone authenticated HTTP API. Agent OS embeds the same library at native execution admission, keeps subscription/account checks in the existing runtime, records the selection in the native run, and exposes reviewed outcomes in Administration. Classification is a transparent task-text heuristic. Only historically observed same-agent subscription models with versioned instructions qualify as alternatives; current entitlement still needs runtime admission. Resumed native sessions retain their current execution contract. A completed process is not quality evidence, and subscription receipts are not API list-price charges.

## Verification ledger

Initial local synthetic voice round trip: Kokoro generated a sample in 3.82 seconds, first Whisper transcription took 25.13 seconds and recovered the sentence. After loading, repeated transcription took 0.06–0.08 seconds. After the application restart, the actual localhost HTTP endpoints generated speech in 6.0 seconds and transcribed it in 6.88 seconds, recovering the exact sentence. These are synthetic measurements, not microphone/browser proof or a promised end-to-end conversation latency. See [local speech setup](../friday-local-voice.md).

The live server reports voice installed, department endpoints available and Model Intelligence connected with zero production selections/evaluations. No fabricated training data was inserted. The native Friday instruction bundle was revision-updated to describe departments, navigation, speech, retained outputs and explicit Stripe write approval; no agent task was started to implement this work.

Workspace typecheck, full production build, Storybook build and UI token gates passed. Targeted tests cover voice turn completion/remounts/identity boundaries, project navigation, task details, department privacy and deletion semantics, Stripe policy floors, actual model-receipt reconciliation, project audit scope, durable learning receipts, qualification and regression rollback. The independent product also passes a real HTTP authentication/receipt round trip, and 122 regression tests pass across native execution configuration, activity, Friday awareness and routines. The full repository test suite is tracked separately below; do not infer its status from these targeted checks.

Browser integration retry still fails before connecting (`sandboxPolicy` missing). Do not claim browser, microphone, visual or mobile acceptance from component tests. Existing credentials stay in the private runtime environment. No cloud backend or tunnel is enabled.

Implementation/checks in progress; update this ledger with final results and remaining limits.

## User verification

The owner tested Talk to Friday in the running local application and confirmed: “She hears me and speaks back.” This verifies their live microphone/reply path. Automated browser visual checks, navigation during speech, room-noise tolerance and mobile testing are still unverified.

Model admission now freezes its candidate/context request in the native run before calling the independent store. A retry can tolerate additional observed candidates while preserving the original selection; profile/context changes fail explicitly. The retry regression and existing native execution-configuration suite pass (29 tests combined).

## Live transcription refinement

After confirming voice worked, the owner requested faster visible dictation and an upper-right microphone. Local speech now prepares when the visible Friday interface connects, previews bounded audio while the user speaks, and sends only the final turn after silence. The live transcript appears above Prefer to type. The mic is red/slashed when muted and blue when enabled; the listening orb is blue. Models expire after five idle minutes to avoid repeated cold starts during a conversation.

The actual local preparation request took 2.88 seconds. Subsequent 1.2, 2.4 and 4.8-second sample snapshots returned in 0.082, 0.063 and 0.064 seconds respectively; longer snapshots refined the initial words. These synthetic timings exclude the capture interval and agent response. Tests prove preview/final separation, stale-preview rejection after identity changes, live transcript placement and mic state. User acceptance of this latest visual/preview refinement is still pending.

## Checkpoint status

The full repository suite and the broad UI suite are still running at this implementation checkpoint; their completion is not claimed. Focused checks and build results above passed. The working local revision is being saved to the existing `agentos/platform` fork branch; no cloud deployment, paid inference, live Stripe change or autonomous platform-build task was started.

## UI regression follow-up

The broad UI run completed: 807 files passed, with 9,166 passing tests and eight failures in five files. Inspection found stale expectations for the Agent OS title/loading text, the new department refresh, the learning setup label, and a shell fixture missing the now-required approved registration. Those expectations/fixtures were corrected without weakening the production access gate. All 35 tests in those five files then passed on a focused rerun; the final administration fixture also passed separately. UI typecheck and the final production UI build passed.

The full repository run remains in progress and has reported server failures, including workspace/runner cases spanning long machine-suspension intervals. These are not assumed to be harmless or pre-existing; a focused reproduction is being run. Do not describe the repository-wide suite as green. The local backend was restarted while no company runs were active and its speech preparation endpoint returned ready. Implementation commit `cc82f5a68` is confirmed on the remote `agentos/platform` branch.

Five sampled server failures were rerun: the chat-thread, Core workspace selection, temporary Git scan, and native Runner wrong-model cases passed. The `local_new_primary` workspace-source-trust case still timed out waiting for a resumed run to finish. The same case also failed waiting for its first run on the prior server revision `008e97c14`, in a separate detached worktree using the installed dependency/build folders. That comparison is evidence of a baseline timing problem, not proof that all remaining server failures are pre-existing. The full repository run is still incomplete; its output is retained locally at `/tmp/agentos-full-tests.log`. Voice checks, the final UI build and the corrected UI regression checks passed. No full-application or browser acceptance is claimed.

## Integrated refinement checkpoint

The latest settings, voice, decisions and map work was implemented by three Codex
subagents and reviewed together directly in this checkout. Native platform agents
did not implement these changes. Settings owns company deletion, voice preferences,
connectors and model controls; department and project leaders now have real
assignments. Friday's work awareness includes permission-filtered accountability,
with bounded reporting-chain traversal and no extra grants. Decisions retain
their actual native effects. Project maps exclude unrelated employees, and running
map orbs share a visibility-aware animation clock.

Validation passed: full workspace typecheck and production build; the full UI
suite with three workers (821 files, 9,221 tests); final performance, model,
department and awareness tests (18 tests); additional accountability/privacy and
concurrency checks; both catalog validators, skill/team packaging tests, UI token
gates, migration safety and structural map checks. The final home Settings entry
passed five focused tests after that broad UI run. A preceding parallel UI run
was stopped under excessive local build/test load; its timing failures are not
claimed as product regressions or as passing evidence. The bounded UI run is the
completed result. Build output still warns about large frontend chunks.

The repository-wide suite is **not green**: its broader run was stopped after a
workspace-preparation stall. That file subsequently passed all 59 tests in
isolation, but this does not certify the remainder of the full suite. Logs are
local under `/tmp/agentos-full-refinement-tests.log`,
`/tmp/agentos-workspace-stall-repro.log`, `/tmp/agentos-ui-final-bounded.log`,
`/tmp/agentos-final-domain-tests.log`, `/tmp/agentos-integrated-typecheck.log` and
`/tmp/agentos-integrated-build.log`.

The local server restarted with zero live runs. Migration 0387 is applied and
health reports no pending migrations. Friday, departments, performance, models
and local voice endpoints returned successfully. The live work read included
14 tasks and ownership context for three projects; no synthetic work or financial
reports were inserted. Browser connection still fails before bootstrap, so the
latest appearance, mobile layout, acoustic interruption and physical microphone
behavior remain unverified.

The new Supabase Free-plan AgentOS project is CLI-linked and installed as the
project-pinned company connection. A native `list_storage_buckets` invocation
passed. Thirteen reads are enabled and four write-capable operations require
review. The application database remains local; no existing Supabase project or
application data was migrated. Higgsfield catalog/preflight/client setup is ready,
but the owner deferred sign-in and no media was generated.

The bundled `agentos-context-review` skill includes the pinned Google EGM reviewer
prompts, standards and license. It was installed through the native catalog and
assigned additively to all seven current company employees. Their existing
instruction files were preserved and revision-updated with scoped handoff and
accountability guidance. No employee run was launched. This supplies an auditable
review method; it does not add automatic harness isolation, a new memory engine,
or visibility into private model internals. Actual review isolation still needs
runtime evidence.
