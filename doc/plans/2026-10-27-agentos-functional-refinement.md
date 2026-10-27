# Agent OS functional refinement

User decisions: departments group projects; Stripe live changes require explicit approval. Deployment stays local. Implementation happens directly in this checkout.

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
