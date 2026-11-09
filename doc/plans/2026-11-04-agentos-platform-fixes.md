# AgentOS platform fixes — 2026-11-04

This is the execution log for the user's latest platform review. Source changes,
focused verification, runtime activation, and human acceptance are tracked
separately. Existing company permissions, approval gates, subscription funding
policy, and audit history remain authoritative.

## Checklist

| ID | Requirement and acceptance | State | Verification / remaining work |
| --- | --- | --- | --- |
| F01 | Artefacts present as files and folders, grouped by project and useful information type (including recorded web research), with clear output provenance and access to the file/detail. | Implemented; focused checks passed | Project/type folders, native file/source links, revision detail, cumulative pagination, explicit research collection. UI folder/open/pagination check passed. Only saved research is shown; raw searches are not retroactively invented. |
| F02 | Routines: Edit loop opens a working editor; Create loop opens a usable creation flow; save/error states are visible. | Implemented; focused checks passed | Create and Edit open focused dialogs, with native save/retry behavior, scope reset and restored trigger focus. 19 routine/Performance checks passed. Browser acceptance pending. |
| F03 | Performance opens without the reported undefined `type` crash. | Guard implemented; user retest needed | Older/malformed Performance data now shows a retryable error, including retained cached data. Exact reported undefined type stack was not reproduced; do not claim its live cause established. |
| F04 | Agent Map spheres have no dark surround; sphere fill matches its dot color. | Implemented; focused checks passed | Shared canvas now tints inside the particle boundary; map dots/interior share the role swatch. Human visual retest pending. |
| F05 | Departments contain Product/Engineering; selecting a department displays its projects. Projects navigation contains projects. | Implemented; focused checks passed | Department tree now follows Departments; clicking a department opens its projects. Separate Projects tree lists actual active projects. Scoped navigation check passed. |
| F06 | Friday voice starts responding sooner and can provide complete answers; playback failures are visible. | Implemented; focused checks passed | Native final-answer chunks and scoped cancellation are loaded. Stable message identity prevents completion replay; conversation-socket refresh and two-read history hydration pass 563 integrated UI cases. The third actual muted native trial played all three chunks once, but its 6.064-second start delay remains failed latency evidence. Updated loaded timing and physical audio acceptance remain open; see the current completion ledger. |
| F07 | Admin Users exposes discoverable edit/delete actions and retains server authorization, last-admin and ownership safeguards. | Implemented; focused checks passed | Explicit Edit/Delete row buttons, focused management panel, native revision and confirmation flows. Rename, self-delete disabled, and ownership-conflict feedback checked. |
| F08 | Model Intelligence shows task suitability, computation route (Jev/LLM/rules), context-rich/fresh-review strategy, observed latency/outcomes and unknowns. | Implemented; focused checks passed | Admin analytics separate task cohorts, local Laya vs external decisions/LLM usage, requested Elephant/Goldfish strategy and prepared review evidence. Unknown quality, isolation and hardware cost remain explicit. |
| F09 | Friday can inspect platform diagnostics and explain actionable problems within the caller's authorized scope. | Implemented; focused checks passed | On-demand native diagnostics API + discovery + runtime conversation guidance. Scoped blocked work and participant-bound conversation/task failures, voice file readiness, admin restart status and explicit unknowns. 22 diagnostics checks passed, including local-model readiness; no broad provider probe. |
| F10 | Starting connector catalog contains OpenAI, Anthropic, Stripe, Higgsfield, Supabase, Vercel, Google and Calendly. | Implemented; focused checks passed | Both settings and /apps show the eight-entry catalog (Google uses native google-workspace setup). Other existing connections remain accessible behind an optional control. Catalog/permissions check passed. |
| F11 | Main Friday sphere has no brown/grey shadow. | Implemented; focused checks passed | Removed renderer halo around main Friday. Human visual retest pending. |
| F12 | Decision cards show a one-line decision, short context and approval actions; opening a card shows full details and plan. | Implemented; focused checks passed | Compact native decision actions with concise context; expansion retains complete body, plan and required/destructive confirmations. Decision UI tests passed. |
| F13 | Implement bounded System One triage: local open-source Laya first (latest user choice), hosted Jev retained as an optional gated provider; explicit abstention and traceable analytics. | Implemented; local inference verified | Pinned local Laya SDK/weights installed separately from voice. Native four-question shadow pipeline ran offline within its deadline and correctly abstained on contradictory suggestions. Native app activation remains pending; automatic route promotion requires measured quality. |
| F14 | Restart button performs the supported restart or displays a useful error; supervisor identity matching is correct. | Implemented; activation blocked | Supervisor boot identity and same-request retry/snapshot handling fixed; 15 native/in-process checks passed. Verified custom launchd lifecycle, but sandbox denies ps preflight. Operator helper prepared; runtime still needs graceful activation. |

## Process

1. Inspect the actual implementation and identify the failing boundary.
2. Make a targeted change using existing native services and permissions.
3. Run focused checks for the changed behavior; run affected type/build checks
   after integration. The user requested practical checks, not deep testing.
4. Record result and any runtime or human retest gap per item.
5. Activate changes using the supported runtime lifecycle where available.
6. Give the user a short, explicit final visual/audio test list.

## Execution log

- Baseline: clean `agentos/platform` at `a7afe8243`; local health is healthy.
  Supervisor status still records last restart at 2026-11-03 11:11:10 UTC and
  27 changed paths. Git HEAD in public health is not proof of loaded server code.
- Restart investigation: supervisor health token exposes restart status but may
  omit the process identity that its restart request validation requires.
  Investigating the native contract; no authentication bypass or manual marker.
- Navigation inspection: department tree is rendered below the Projects row;
  correcting placement and department selection semantics.
- Admin inspection: native rename/access/delete functionality already exists,
  but entry points are hidden behind the person's name. Making actions explicit.
- Browser control is unavailable in this session. Focused component/service
  checks are possible; no live-browser or physical-audio acceptance is claimed.
- Asked whether separately billed hosted Jev use should remain disabled or
  receive an explicit capped trial. Implementation proceeds independently.

## Related records

- [Original action plan](2026-11-03-agentos-action-plan.md)
- [Requirements reconciliation](2026-11-03-agentos-requirements-reconciliation.md)
- [Model Intelligence / Jev proposal](2026-10-27-agentos-model-intelligence.md)


### Focused check evidence

- Files/navigation/catalog: 3 tests passed in `/private/tmp/agentos-files-navigation-connectors-20261104.log`.
- Admin edit/delete: 1 interaction test passed in `/private/tmp/agentos-admin-people-actions-20261104.log`. Native account ownership/admin protections are reused; no real user was deleted.
- Workspace integration: 16 tests passed in `/private/tmp/agentos-workspace-integration-20261104.log`.
- Voice/orbs/decisions: 110 focused tests passed in `/private/tmp/agentos-friday-voice-decisions-first.log`. This is not physical microphone/speaker or visual acceptance.
- The backend supervisor belongs to the custom launchd service `com.agentos.backend`, rather than the generic Paperclip service registration. Native activation/recovery investigation continues.

### Open-source model steering

The user answered the billing question by asking to start with an open-source
alternative. This supersedes a hosted Jev trial; no paid exception was granted.
Local Laya is the first candidate. It is a distinct model and will be named as
such in receipts and analytics. Source and model cards identify Apache-2.0.

- SDK pin: `laya==0.4.22` ([published package](https://pypi.org/project/laya/0.4.22/), [source metadata](https://github.com/NandhaKishorM/laya/blob/main/pyproject.toml)).
- Model: `convaiinnovations/laya`, revision `7b928d828b7b0e022f929d9bd2e44165aa270148`, explicit checkpoint subfolder; [publisher metadata](https://huggingface.co/api/models/convaiinnovations/laya).
- Start with local shadow observations, not routing authority. The publisher's
  [model card](https://huggingface.co/convaiinnovations/laya#honest-limits) reports
  weak zero-shot results for some task sets and stronger domain-tuned results.
  Neither result establishes accuracy on AgentOS work. Confidence is not an
  accepted-output score.
- A bounded resident worker should warm on demand, avoid delaying the first
  task while cold, handle one inference at a time, abstain on busy/deadline or
  truncated input, and unload after idle time. No automatic hosted fallback.
- Model download/installation, actual inference and native activation are
  separate acceptance gates. Local hardware use is not a metered API charge,
  but its compute cost is unmeasured, not free.

### Restart activation handoff

The local custom launchd job `com.agentos.backend` owns this checkout's
`pnpm dev:once --data-dir ../.runtime` lifecycle. The native supervisor dropped
the first accepted restart request because its token-authenticated health
response omitted the boot identity; a retained hot-restart intent then caused
EEXIST on retry. Source now preserves requests with missing probe identity,
exposes only the boot identity to the supervisor token, and resumes only a
matching pending request with active-run preflight retained under native locks.

The workspace-owned helper is `scripts/restart-agentos-local.py`. It checks the
actual launchd configuration, unique listener, process ancestry/start time,
native database/recovery preparation and unchanged process identity before
sending SIGTERM to the HTTP server only. It never force-kills or signals the
supervisor. After launchd relaunches, it requires healthy HTTP and a matching
native recovery report with no lost runs.

Read-only `--check` reached `/bin/ps`, which this session cannot execute (EPERM),
so no runtime signal or manual restart-marker change was performed. Run from
a normal local terminal after the source checks are complete:

```sh
python3 /Users/dave/cursor-tutor-1/AgentOS/paperclip/scripts/restart-agentos-local.py
```

Stop on any helper error; do not replace it with a force-kill. After success,
refresh the browser and use the final manual checklist below.

### Final manual acceptance

1. Open Performance; if the exact type error remains, capture its stack/error detail.
2. Create a paused loop, edit it, save and reopen it; confirm the changes persist.
3. Open a department, its project and its artefact folders; open a file/research record.
4. Check the main/map sphere colors and absence of the dark surround.
5. Ask Friday a question needing a few sentences; check time to first audible
   response, completeness and interruption. Source tests do not measure these.
6. Check compact decision title/context/actions and expanded plan; test only an
   approval whose effects you intend to authorize.
7. Open Admin → Users and inspect Edit/Delete (use a disposable account for deletion).
8. Check the eight connectors, Model Intelligence local runtime/receipts, and
   ask Friday to diagnose the current company. Unknown checks should remain explicit.

### Local Laya verification and limits

- Prepared isolated `.runtime/laya/venv`; existing voice dependencies unchanged.
  `scripts/local-triage-models.json` pins 35 wheel artifacts and five checkpoint
  files by size, URL and SHA256. `scripts/setup-local-triage.py` verifies them,
  installs offline with required hashes and checks imports/dependencies.
- The repository-owned resident Python worker rechecks all checkpoint hashes
  and SDK version before readiness. It is CPU-only, network-offline, receives
  bounded typed requests over stdin, and does not log task text. Native
  admission retains its selected subscription model and review requirements.
- Initial three-option synthetic smoke: 7.290 s cold model load, 444 ms first
  inference, 95 ms warm inference; `/private/tmp/agentos-laya-smoke-20261105.log`.
- Full native four-question synthetic smoke: the first call returned warming
  in 3.35 ms; readiness followed in 4.38 s. Inferences took 1,199 ms and 611 ms
  (600 input tokens, zero output tokens). Both produced contradictory fit/profile
  suggestions, so the policy abstained and retained the native route. Evidence:
  `/private/tmp/agentos-laya-native-adapter-smoke-r2.log`. These are execution
  and guard checks, not quality benchmarks or a claim of faster accepted work.
- The pinned checkpoint warns about invalid calibration in its 11+ option
  bucket. This adapter restricts questions to at most ten options, preserves
  unknown, and abstains when candidate/input/token bounds cannot be met.
- Local hardware cost is unpriced. No hosted Jev or other paid inference was
  used. A local model's score does not establish correctness or authority.

### Integrated verification

- UI production build passed (`/private/tmp/agentos-platform-ui-build-20261104.log`),
  with existing chunk-size/mixed-import warnings.
- Integrated UI semantic check passed (`/private/tmp/agentos-platform-ui-semantic-20261104.log`).
- Design token gates and map structure checks passed.
- Native launchd handoff helper's four controlled lifecycle tests passed
  (`/private/tmp/agentos-local-restart-handoff-tests-final-20261105.log`). They
  verify refusing failed preparation, replacement/PID reuse, unbound or malformed
  reports and lost runs; they do not exercise the actual macOS restart.

### Final source checkpoint

- Local triage: 60 focused server tests, five Python wrapper tests and eight
  analytics/admin UI tests passed; shared build, server semantics and token
  gates passed. Evidence: `/private/tmp/agentos-local-triage-services-r3.log`,
  `agentos-local-triage-python.log`, `agentos-local-triage-ui.log`,
  `agentos-local-triage-server-semantic-r2.log`, `agentos-local-triage-token-gates.log`.
- Friday diagnostics now includes read-only local-model readiness. Its seven
  states never trigger model warming, shutdown or inference. The final 22
  focused checks passed: `/private/tmp/agentos-friday-local-triage-diagnostics-20261105.log`.
- Root UI actions/catalog/folders/navigation: final four checks passed at
  `/private/tmp/agentos-root-ui-final-20261105.log`.
- Broader PostgreSQL/browser/audio acceptance was not run; the user requested
  focused checks and will perform the final visual/audio retest.

All fourteen items now have a concrete source change and recorded verification
or a stated retest gap. Runtime activation remains pending the guarded terminal
restart. The exact Performance type-error cause and actual voice responsiveness
remain user acceptance items, not asserted fixes proven in the running app.


### Local configuration prepared — 2026-11-05 NZDT

Set only the three authorized `PAPERCLIP_LOCAL_TRIAGE_*` keys in the protected
instance `.env` to enable local Laya with absolute interpreter/model paths.
All non-triage lines were verified unchanged against a private backup; both
files are mode 0600. No environment contents or credentials are committed.
The live server was not restarted, so this is prepared configuration, not live
activation. Native operator preparation can reuse the existing accepted intent
when fresh OS/database preflight succeeds outside this session's process sandbox.

Independent reviews found and corrected the supervisor identity/retry mismatch,
worker EPIPE handling, installer environment isolation and restart-report binding.
Final source review has no known blocker. The pending acceptance gaps remain
those listed above; prior wider requirements (including actual current dashboard
landing screenshots and end-to-end business workflows) are not closed by this
fix batch.
