# AgentOS requirements reconciliation

Date: 2026-11-03

This is the acceptance checklist recovered from the previous development conversation. It complements the [master execution plan](2026-10-27-agentos-end-to-end-execution.md), rather than treating that plan's older baseline tables as current status. It includes small interaction requirements as well as the larger operating model.

## Crash-recovery checklist — 7 November 2026

Use the **Status** column below as the single checklist: **Fixed** or **Not fixed**.
All 93 IDs remain in scope. A partly implemented item stays **Not fixed** until
its remaining acceptance passes. Enduring constraints marked **Fixed** still apply.
Explicit deferrals stay **Not fixed**, with the deferral retained in the row.
Older detail is reference material; new updates need only status and the next
required action. Do not recreate this list or ask the owner to repeat it.

Current work: finish actual browser acceptance and landing screenshots, add
recorded tool/resource activity to the graph, and implement native packet-only
independent review. PostgreSQL workforce/capacity and native recovery checks pass.
Next: remaining voice and complete delegated operating-workflow acceptance.
The [execution checkpoint](2026-11-06-agentos-completion-ledger.md) records active
ownership and blockers. No item is closed merely because its source compiles.

## Evidence and limits

- Sources: all 146 saved user messages in session `01a16fe4-6b53-7633-97fe-4de98f1ce2f7`, from 24–27 October UTC / 25–28 October New Zealand time, plus the final assistant checkpoints and the current working tree. `U139`, for example, means the 139th saved user message in that session. Source numbering includes repeated prompts and operational replies.
- At the initial audit, the latest saved implementation commit was `933f79bca` with extensive subsequent uncommitted changes. The first execution checkpoint was subsequently committed and pushed as `e7d080c30`; later evidence is recorded below and in the action ledger. Earlier passing checks do not certify later changes.
- This is a requirements reconciliation and targeted source review, not a fresh full runtime acceptance run. No application behavior, account setting, database record or deployment was changed for this audit.
- The source text only names `IMG_6004.JPG` and `IMG_6005.jpg`; their visual contents were not available in the reviewed conversation. No requirements are invented from those filenames.
- Credentials, verification codes and personal account details are deliberately excluded. The final Google credential handoff was recovered, and both required values were confirmed present privately without printing them.
- **Recorded implemented** means code and/or prior checkpoint evidence exists; it does not claim that every interaction is accepted. **Partial** means a foundation exists but part of the requested behavior or end-to-end evidence is missing. **Pending changes** means relevant uncommitted work exists. **Open** means no completion evidence was found. **Deferred** records an explicit postponement. **Constraint** is an enduring instruction, not an unfinished feature.
- A requirement is accepted only when its full behavior has evidence on the relevant revision. Showing a control, installing instructions, saving a URL, or completing a model turn is insufficient proof of its business outcome.

### Execution updates after the reconciliation

The source requirements remain unchanged; dispositions are refreshed when execution evidence supersedes the initial audit. Historical checkpoint notes below retain what was known at that time. The [action-plan ledger](2026-11-03-agentos-action-plan.md) tracks current execution. On 3 November:

- **O02:** the [concrete staffing proposal](2026-11-03-agentos-workforce.md) is delivered: three departments, seven initial company roles, and explicit responsibilities/escalation. Role configuration does not prove employee execution quality.
- **O10:** migration 0388 is applied and native APIs confirm ordinary company listing excludes Platform Operations while the explicit internal listing retains it. Existing credentials and dependencies were preserved. Browser/Friday operating acceptance remains separate.
- **O11 / A01:** the pre-existing Northstar example now has three departments, four projects, eight tasks, six native versioned documents, three pending decisions, two paused routines with disabled schedules, and an immutable downloadable scope file. The scope has two revisions. Native work aggregation reconciles the projects, tasks, seven assignments and document evidence. Records are explicitly illustrative; no execution results or revenue were fabricated.
- **D01–D05 / V06:** Decisions discussion now opens Friday with exact decision context. The previously contradictory test was corrected and the relevant behavior tests pass. Physical voice and real-browser evidence remain open.
- **O04 / O07:** company-scoped shared-workforce read/bind routes were added under native grants and responsible-owner intersection. Independent review found a revocation race and target-scope omission; fixes and concurrent regression cases are now under review. Database execution is blocked by isolated-listener sandbox restrictions.
- **A05:** official Google EGM research, pinned-source attribution, qualification instructions and a retained-trace auditor are delivered. Native execution isolation and evaluated learning remain open; see the [EGM integration record](2026-11-03-agentos-egm-integration.md).
- **S02:** supplied credentials remain privately configured. Pre-activation review found local-owner responsibility was not fully transferred by the existing claim flow; fix this before enabling authentication.
- **L04:** token gates, structural module maps and diff whitespace checks pass. The initial full UI run exposed 43 failures; all affected files pass focused corrections and a complete rerun is underway. Browser/audio and isolated database checks are not marked passed.

On 4 November, the continuation adds bounded company-local retirement with explicit native grants, employee-awareness reads without company elevation, server-scoped performance reporting, and an independent paired-holdout comparison ledger. These advance **O04/O06, O09/A02, P01 and M05/M06** but do not close live operating or learning acceptance. The [current execution ledger](2026-11-03-agentos-action-plan.md#continuation-checkpoint--2026-11-04) retains exact passing checks, review fixes and unavailable database/browser/audio evidence. Google authentication is active; owner sign-in/claim and authenticated activation of the new backend remain pending.

The next [search and namespace checkpoint](2026-11-03-agentos-action-plan.md#search-and-namespace-checkpoint--2026-11-04) advances **A02/M01/M08** with routine search, artifact visibility repairs, and exact-namespace host credentials in the standalone model service. Focused source/package checks pass; persisted authorization, actual HTTP listeners and hosted product acceptance remain open. The [capability-adoption design](2026-11-04-agentos-capability-adoption.md) identifies native reuse and required migrations; it is not an implementation or accepted learning evidence.

The 6 November continuation advances the same requirement IDs, rather than
replacing this worksheet. Source changes and verification are recorded in the
[current completion checkpoint](2026-11-06-agentos-completion-ledger.md):
**R03** shared subscription admission, **O06** capability adoption and rollback,
**O03/O07/O09** explicit shared-work portfolio reads, **A02/A03/W04** search,
saved views and routine relationships, **A05** frozen EGM packet preparation,
and **X07/M03/M04/M07** model evidence and interactive latency. Migrations/live
activation, current screenshots, physical voice and the real operating journey
remain separate acceptance. Pending choices and explicit deferrals are retained.

On 7 November NZDT, restored process access allowed the existing guarded restart
to complete. Both pending migrations applied; the matching recovery report and
fresh health confirm healthy activation with no lost runs. There were no active
runs, so live delegated-work recovery remains unproven. The completion ledger's
runtime activation entry supersedes earlier process-access/activation blockers;
actual owner login, screenshots, voice and all other unfinished requirements
remain open. The worksheet retains 86 original rows plus X01–X07 (93 total);
the 14-item and 18-item follow-up fix logs refine these rather than replacing them.

## Final choices that supersede earlier wording

1. The product is **AgentOS**, with **Friday** as its fixed coordinator. Earlier permission to keep the Paperclip name was superseded. Preserve required license/attribution outside the ordinary product branding. Sources: U32, U38, U123, U138, U145.
2. The organisation is company → department → project → task/action. Departments group projects. Sources: U63, U115–U116, U123, U135.
3. The board-only tab is **Kanban**; the graph is **Agent Map**. There is no extra Combined tab. Sources: U82–U85.
4. Friday sees the authorised portfolio; CEOs remain company-scoped. Shared employees keep separate company assignments. Sources: U64–U67.
5. A CEO retires its own company assignment, not the global employee. Companies choose whether to adopt shared capability upgrades. Sources: U66–U67.
6. Automatic, proven low-risk **routing-policy** improvements are authorised within the agreed limits. This does not mean automatic adoption of every shared skill or permission change. Sources: U67, U87–U91.
7. Develop and revise AgentOS directly in this development session. The eventual owner-requested platform-engineering workflow is a product capability, not the means of finishing this build. Sources: U58, U80, U141–U142.
8. Keep necessary platform infrastructure and connections, but remove internal Platform Operations from ordinary business-company interaction and records. Do not destroy Friday or connection dependencies. Sources: U139, U141–U142.
9. **Local first until the concept works flawlessly.** Earlier Vercel/tunnel instructions do not authorise restarting public hosting now. Cloud-native operation remains the eventual target. Sources: U92, U108–U114.
10. Settings stays in workspace navigation, but the last correction removes its shortcut from Friday Home. Sources: U123, U136, U139.
11. **Discuss with Friday appears only in Decisions.** It supplies the selected decision's context automatically and opens a right-side panel with a background, with Friday responding. Ordinary home chat remains borderless and explicitly toggled. Sources: U139–U140.
12. Google credentials have been supplied. Higgsfield sign-in was explicitly deferred. Sources: U129, U143–U146.

### Additional requests — 4 November 2026

These extend the recovered 146-message source audit; they are direct requests in
the current conversation, not invented additions to its historical numbering.

| ID | Status | Requested outcome | Current disposition |
| --- | --- | --- | --- |
| X01 | **Not fixed** | Fix Google `redirect_uri_mismatch`; use Google sign-in only, without email/password login. | Google-only UI and disabled password policy are active. Owner has been asked to complete Google sign-out/sign-in; awaiting the actual account result. |
| X02 | **Fixed** | Use Wispr Flow's landing page as a design reference and add several actual dashboard screenshots alongside key features. The user explicitly rejected the mistaken “Whisper-powered voice flow” interpretation. Latest layout correction: large sphere on the right, vertically centered text on the left. | Three actual current-app feature screenshots added and inspected, with labelled Northstar example data and full-size links. Desktop/mobile rendering and image loading pass. |
| X03 | **Fixed** | Replace “A little clarity, a lot in motion” with a meaningful tagline. | “Turn ideas into coordinated action.” now replaces the old wording across landing, footer, sign-in and Friday workspace. |
| X04 | **Fixed** | Make the landing sphere visibly grow and shrink on hover and vary its rotation as the pointer moves. | Real-browser stationary hover visibly grows the sphere; pointer rotation and finite/reduced-motion lifecycle checks pass. |
| X05 | **Not fixed** | Automatically approve the owner's explicitly designated Google account and make it the instance administrator. | Owner provisioning is active. Actual designated-owner Google sign-in/admin acceptance awaits the owner’s interactive login; credentials are already configured. |
| X06 | **Not fixed** | Replace “You're on the list” with a waiting-list thank-you, show confetti, and explain the status button. | The running UI serves “Thank you for joining the waiting list”, finite reduced-motion-aware confetti, and “Refresh approval status” with explicit pending feedback. The action only refetches approval; it does not approve an account or change its priority. Auth/waitlist/confetti checks pass; browser visual acceptance remains open. |
| X07 | **Not fixed** | Implement a triage layer choosing System One decisions versus qualified generative/open LLMs alongside Elephant–Goldfish. The owner clarified “GEP” to Jev, then requested an open-source alternative. | Local Laya is installed with bounded shadow classification, abstention and audit. A real 12-case offline diagnostic rejected every profile suggestion for contradictory answers; no routing promotion is justified. Interactive conversations now skip the non-routing shadow wait. App activation, representative evaluation and current-account qualification remain open; no paid fallback. |

## Foundation and delivery method

| ID | Status | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- | --- |
| F01 | **Fixed** | Maintain an actual GitHub fork of Paperclip, extending its working engine and preserving existing capabilities and history. Push reviewed work to the fork. | U2–U4, U17, U21–U26, U30 | Implemented; reviewed source checkpoint `4057682fd` is committed and pushed to `agentos/platform`. The 6 November completion ledger records its checks and outstanding activation/acceptance. |
| F02 | **Not fixed** | Build the whole platform without requiring the owner to nominate a pilot application first. Support both existing in-flight repositories and new ideas. | U21–U23, U26, U30 | Constraint; registry foundation exists, complete delivery journeys remain open. |
| F03 | **Not fixed** | Retain the requested full plans/design demonstrations and carry accepted refinements into the real application. Existing approval authorises routine implementation; this is not a requirement for another approval/demo before every change. | U8–U12, U16–U19, U21–U22, U42, U76, U80–U82, U90–U91, U98 | Plans/prototypes exist; real-interface acceptance remains incomplete. |
| F04 | **Fixed** | Use parallel development agents where useful; implement here, not by sending platform-build tasks to Friday. | U58, U80, U136–U137, U141 | Constraint; applied during implementation and this audit. |
| F05 | **Fixed** | Explain concrete blockers before substituting another approach, billing model or capability. Ask for genuinely missing inputs; do not repeatedly request authorised routine steps. | U26, U35–U36, U42, U58, U74, U76, U90, U115, U134, U137 | Constraint. |
| F06 | **Fixed** | Hide/archive unnecessary inherited functionality with an inventory and restoration path; retain useful skills, profiles, configuration, audit, chat, routines and artefacts. | U52, U63, U73, U75, U123 | Retained native skills, profiles, chat, routines, artefacts, audit and Settings open in the current shell; per-URL classic restoration and return verified. |

## Companies, workforce and accountability

| ID | Status | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- | --- |
| O01 | **Not fixed** | Create companies representing ventures; group projects under departments; break projects into accountable tasks/actions. Scope navigation and records to the selected company/project. | U63, U82–U83, U115–U116, U123, U135 | Recorded implemented foundation; final integrated journey needs acceptance. |
| O02 | **Fixed** | Supply a concrete staffing proposal: number of divisions, department heads, product/portfolio managers and project leads, responsibilities and escalation paths. | U135, U139 | Delivered: three departments and seven initial roles, with responsibilities and escalation. Role configuration still requires operating/evaluation proof. |
| O03 | **Not fixed** | Friday coordinates the portfolio, understands platform capabilities, navigates supported pages through conversation, searches the web when useful, consults managers/leads, reports back with context, creates work and chooses accountable leads. | U34, U38, U40–U41, U45, U63–U64, U135 | Partial; native awareness/work APIs and explicit company-shared portfolio read mandates are implemented in source. Mandates do not authorize foreign writes or private work; live coordination and delegated execution remain open. |
| O04 | **Not fixed** | CEOs can hire/retire within limits; leads select/delegate specialists as needed. Keep staffing, ownership and changes auditable. | U5–U6, U34, U38, U63, U66 | Persisted staffing, authority/revocation and retirement checks pass. Next: live CEO/lead/specialist delegation. |
| O05 | **Not fixed** | Reuse persistent skilled employees across companies while keeping company-private work and permissions isolated. | U5–U6, U65–U67 | Recorded identity/assignment foundation; complete multi-company operating acceptance remains. |
| O06 | **Not fixed** | Retire only one company's assignment; improve/refine successors; publish evaluated shared capabilities centrally; allow independent company adoption, pins and rollback. | U66–U67 | Migrations active; persisted capability adoption, pins, rollback and company-local lifecycle checks pass. Next: native delivery and evaluated improvement. |
| O07 | **Not fixed** | Portfolio/product managers see their authorised portfolio, project leads their projects, execution agents their assigned work; support escalation through that structure. | U64, U135 | Persisted read mandates, current authority and private-work isolation pass. Next: selected operating grants and cross-company delegation; private scope remains unanswered. |
| O08 | **Not fixed** | Preserve employee profiles, instructions, skills, harness/model selection, subscription bindings and spending controls. Explain which roles are upstream and which were added. | U33, U52, U63, U75 | Recorded implemented foundation; role installation is not proof of expertise. |
| O09 | **Not fixed** | Direct employee chat can answer what that employee is doing across its authorised assignments, projects and companies. | U52, U63, U65 | Persisted employee awareness across authorized assignments, private-work exclusion and immediate revocation pass. Next: live multi-company employee chat. |
| O10 | **Fixed** | Keep AgentOS internal infrastructure out of the business portfolio while preserving Friday, employees, credentials and connections needed to operate. | U32, U139, U141–U142 | Migration and native company filtering verified; Platform Operations is excluded from ordinary business listing while infrastructure remains intact. Rendered/operating acceptance is separate. |
| O11 | **Fixed** | Create a realistic example company with linked departments/projects, work, decisions, routines and artefacts so the complete experience can be inspected. | U139 | Northstar example populated and API-verified: seven paused employees, three departments, four projects, eight tasks, six versioned artifacts, three decisions and two paused routines. It is illustrative, not executed business work. |
| O12 | **Not fixed** | Allow appropriate company/project/task deletion and account administration. Company deletion belongs in Settings, not Workforce. | U99, U123, U135–U136, U139–U142 | Partial; controls/foundations exist; full deletion and internal-dependency preservation journeys need verification. |

## Friday voice and conversation

| ID | Status | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- | --- |
| V01 | **Not fixed** | Friday is the main voice-first interface, with typing available. Talk starts listening without a command/modal flow; Friday replies aloud naturally. Use local/open-source speech without additional paid services. | U43–U45, U49, U51, U82–U83, U115 | Installed local Whisper/Kokoro audio roundtrip passes without paid services. Next: physical microphone, natural live Friday reply and interruption. |
| V02 | **Not fixed** | Show live transcription under Friday in the status area while speaking; make it responsive. Upper-right microphone shows muted red/slashed versus enabled/listening blue. | U86, U120, U134 | Implemented/pending refinements; latest physical-device acceptance remains. |
| V03 | **Not fixed** | End a normal spoken turn, automatically send the message, and receive a spoken reply. Do not misreport a held draft as sent. | U115, U119–U120, U139 | Silence/send/held-draft protections pass focused checks. Next: physical spoken turn through an actual Friday reply. |
| V04 | **Not fixed** | Keep the microphone enabled across navigation until explicitly muted. Support interruption and continued conversation, including during execution. | U115, U134 | Implemented foundation; interruption, room noise and navigation acceptance unverified. |
| V05 | **Not fixed** | Show distinct listening, thinking and speaking states based on actual activity, and clear mic-off state. | U82, U86, U120, U134 | Speaking now begins only on observed playback; preparation, cancellation and mute checks pass. Next: rendered live microphone/reply timing. |
| V06 | **Fixed** | Orb click explicitly toggles the transcript. Keep chat closed otherwise, including navigation and incoming activity; dock Friday bottom-right on work pages. | U49, U52, U82–U83, U99, U115, U134–U135 | Current browser verifies explicit transcript toggle, closed navigation, minimise/reopen and docked placement; unsolicited activity remains closed. |
| V07 | **Fixed** | Home transcript is far-left, borderless and shadow-free, inset from the edge by the requested additional space; Friday owns most of the full white canvas. Docked chat has a readable background. | U50, U82–U83, U99, U134–U135, U139 | Current browser verifies far-left borderless, shadow-free home transcript and opaque white docked conversation. |
| V08 | **Fixed** | Keep durable conversation/history and drafts through navigation. Avoid unnecessary New chat flows and a second central typing modal. | U52, U63, U82–U83 | Native conversation history and account-scoped draft persistence pass checks; draft survives current-browser navigation and reload without an extra typing flow. |
| V09 | **Not fixed** | Ordinary clarification happens in conversation, not command-palette or multiple-choice pop-ups. Preserve real action approval effects. | U121–U123, U134 | Implemented/pending shell changes; verify actual runtime questions. |
| V10 | **Fixed** | Introductory copy disappears after interaction; useful suggestions adapt to current work and user activity. | U123 | Browser verifies intro dismissal and current work suggestions; both home blocker entry points open the real task. Sixteen focused checks pass. |
| V11 | **Not fixed** | Voice preferences belong in Settings. Friday is fixed; remove the ordinary coordinator selector. | U123, U136 | Recorded refinements; verify all entry points. |

## Navigation, branding and visual work

| ID | Status | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- | --- |
| N01 | **Fixed** | Use the selected white Friday design in the actual app; public pages scroll; navigation renders companies/projects in the central canvas instead of unnecessary modals. | U50, U80–U83, U98–U99 | Current white workspace and desktop/mobile public layout verified in Chromium; company/project views open in the canvas and public pages scroll. |
| N02 | **Fixed** | Put Departments above Projects in company navigation; no duplicate Departments/Projects tab layer. Scope Artefacts, Routines, Decisions and other views consistently. | U83, U115, U123, U135 | Department/project hierarchy, nesting and scoped navigation pass browser and component checks; failed structure reads hide stale names. |
| N03 | **Fixed** | Project Home shows work/activity, Kanban shows the board, Agent Map shows the graph. Include Agent Map entry alongside Work. Retain navigation on Audit. | U7, U52, U82–U85 | Project Home, Kanban, Agent Map and actual task drilldown pass browser checks. Audit retains navigation. |
| N04 | **Fixed** | Workforce and audit use inspectable tables, with profile/detail navigation and retained controls. | U52, U63, U83, U115 | Workforce and audit tables, profile/configuration access and retained controls verified in the current browser. |
| N05 | **Fixed** | Settings is last in workspace navigation beneath Saved displays; consolidate company profile/deletion, voice, connectors and model controls. No home Settings shortcut after the final correction. | U115, U123, U136, U139 | Saved displays precedes bottom Settings; Company/Voice/Connectors/Models are consolidated. Friday Home has no Settings shortcut. |
| N06 | **Not fixed** | Top-right profile supports sign-in/out/account switching. Remove redundant Operating connectors and coordinator settings entry points. | U123, U143 | Local-mode profile menu corrected and redundant connector link removed. Actual Google sign-out/account-switch acceptance awaits owner login. |
| N07 | **Not fixed** | Replace visible Paperclip names, logos, loading/mascot animations, avatars and install/browser icons with AgentOS/Friday orb identity. | U83, U138, U145 | Visible rebrand/orbs and catalog copy implemented and checked, preserving machine protocols and legal attribution. Real-browser/install-icon appearance acceptance remains open. |
| N08 | **Fixed** | Suppress unsolicited agent/run notification pop-ups; keep useful errors/context visible inline. Saved displays uses a monitor/TV icon. | U139 | Unsolicited run pop-ups suppressed; inline errors retained. Monitor icon and bottom Saved displays navigation verified. |
| G01 | **Fixed** | Every work/data graph point represents an actual resource or record, not decorative simulated work. Show observed activity and completed work. | U7, U16, U52, U63, U69–U70 | Graph points use authorized native company/project/employee/task/evidence records plus stored tool catalog/invocation records. Counts and observed states are checked. |
| G02 | **Not fixed** | Use attractive vibrant pastel Friday-style employee spheres, colours distinguishing categories, with distinct task/data/evidence points. | U11, U16, U21, U46–U47, U82, U87, U99, U115, U123, U135 | Recorded/pending display work; user visual acceptance outstanding. |
| G03 | **Fixed** | Zoom between portfolio, company, project, employee, task and evidence; pan/back/drill down reliably. Opening a task shows its actual detail, completion and outputs. | U7, U16, U63, U115 | Portfolio/project/employee/task/evidence navigation, graph pan/zoom/fit and actual task detail pass focused UI and current-browser checks. |
| G04 | **Not fixed** | Show agent relationships, delegations and data interactions; distinguish available datasets/permissions from actual reads/writes. Keep graph, Kanban and activity consistent. | U7, U16, U52, U63, U69–U70 | Authorized configured tools and observed read/write/unknown action receipts now differ in the graph. Exact provider dataset/file identity is not recorded; live provider journey remains. |

## Decisions and proactive coordination

| ID | Status | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- | --- |
| D01 | **Not fixed** | Automatically surface decisions/blockers and a prioritised agenda from work, product feedback and operating signals across the authorised portfolio. | U40, U52–U53, U63 | Partial; native attention exists, proactive proposal generation/full operating loop unproven. |
| D02 | **Not fixed** | Company Decisions aggregates its projects; project Decisions stays scoped. Open a full description/evidence without a redundant Open step. | U63, U83, U115, U123 | Recorded implemented foundation; integrated scope/context acceptance remains. |
| D03 | **Not fixed** | Present an agent's concrete recommended course with understandable Approve/Disapprove actions and actual native effects; accept alternative instructions through conversation. | U40, U115, U123, U135, U139 | Pending refinements; real recommendation → decision → execution journey unproven. Blockers must not pretend to have a binary approval. |
| D04 | **Not fixed** | Discuss with Friday exists only in Decisions, automatically passes the exact source/revision/context, and lets Friday investigate with the relevant lead. | U135, U139–U140 | Context/action behavior implemented and component-tested in Decisions. Live investigation with the relevant lead and actual response remain unverified. |
| D05 | **Not fixed** | Clicking Discuss opens a right-side conversation panel with a background and starts Friday's response/speech. | U139–U140 | Corrected: discussion opens the right-side opaque Friday panel with exact context and requested speech behavior. Real-browser/audio acceptance remains open. |

## Routines, applications and recurring business work

| ID | Status | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- | --- |
| W01 | **Not fixed** | Adopt existing in-flight GitHub applications without losing work, or start from an idea; inspect, plan, form a team, implement, verify and release. | U2–U6, U21–U23, U34, U38, U63 | Registry/native foundations exist; real complete delivery journeys outstanding. |
| W02 | **Not fixed** | Operate development, product management, marketing, sales, support and production maintenance through accountable specialists/leads. | U2–U6, U22, U38–U41 | Roles exist; qualified business workflows outstanding. |
| W03 | **Not fixed** | Friday commissions recurring work; a dedicated lead/agent owns the loop. Agents can create projects, tasks, routines and artefacts under their grants. | U38–U41, U52, U63, U75 | Native APIs/instructions exist; live delegated operating proof incomplete. |
| W04 | **Not fixed** | Routines show connected agents/steps/triggers, live work and outputs in a workflow-style diagram, relationships between multiple loops, and each loop's cycle history. Create/edit loops and triage work when needed. | U115, U123 | Create, edit, save, reload/reopen and retained routine revision history pass in the browser. Native scheduling/task creation passes. Actual completed delegated cycle remains. |
| W05 | **Not fixed** | Run the concrete marketing cycle: create content/video through Higgsfield, publish to TikTok/LinkedIn, inspect comments/reach, revise and repeat with retained outputs and measures. | U39–U41, U115 | End-to-end workflow open; provider capabilities/authority must be qualified. Higgsfield login deferred. |
| W06 | **Not fixed** | Convert application health, comments and feedback into prioritised work and owner decisions; perform authorised repairs/improvements and observe results. | U2–U3, U22, U40 | Full recurring operating journey open. |
| W07 | **Not fixed** | On explicit owner request, Friday can arrange platform features, skills/connectors and release/redeployment with review and independent recovery. | U39–U40, U63 | Future capability open. It is not the method of implementing this current build. |

## Artefacts, knowledge, search and generated views

| ID | Status | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- | --- |
| A01 | **Not fixed** | Retain every produced artefact and relevant version, preview/download and provenance, scoped to company/project/task; store locally now and durably online when deployed. | U52, U63, U75, U115 | Native attachments, revision history and project file/folder views exist. List/revision/attachment authorization failures now hide cached titles, bodies and links; seven focused regressions pass. Complete live production/history acceptance remains open. |
| A02 | **Not fixed** | Search/retrieve across company, project, task and employee, including relevant routines, artefacts, conversations and knowledge under access rules. | U63, U75 | Explicit authorized Conversations search, routine search and employee awareness are implemented in source; native routine history/annotation scope protections were tightened. Focused checks pass; persisted/live cross-surface retrieval acceptance remains open. |
| A03 | **Not fixed** | Friday creates requested dynamic tables/displays in the main canvas, saves recurring useful views and reuses them rapidly with current data. | U44–U45, U63 | Saved live task/project tables, task lists and task boards use strict authorized descriptors, fresh reads, cancellation and stale/error suppression. Focused checks pass; browser acceptance and privileged reusable-code promotion remain open. |
| A04 | **Not fixed** | Sandbox generated code/displays; promote useful components through the owner-requested platform change path. Preserve source/output visibility. | U39, U44, U63 | Isolated snapshot preview exists; complete reusable-extension/release path open. |
| A05 | **Not fixed** | Integrate the Google Elephant/Goldfish method into real context-rich planning, independently isolated review, recorded findings/resolution and reusable lessons. | U135 | Packet-only native execution, frozen context, exact reviewer authority and recovery are implemented and checked; actual Codex protocol accepts the isolated profile. Next: real account review, findings/resolution and evaluated lessons. |

## Model Intelligence and learning

| ID | Status | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- | --- |
| M01 | **Fixed** | Maintain an independent model-selection/learning product, integrated into AgentOS, API-accessible and separately packageable/runnable. Keep selection fast. | U87–U89, U93 | Standalone real HTTP, packaged install, SQLite upgrade/restart and credential replacement pass. 100 local selection samples measured below 1 ms each; public hosting stays deferred. |
| M02 | **Not fixed** | Maintain a central library of task examples/families, eligible model choices, outcomes, iterations and improvements; route new work using that evidence. | U87–U88, U115, U123, U125 | Receipt/evaluation store and conservative rules implemented; meaningful real learning evidence outstanding. |
| M03 | **Not fixed** | Select efficient qualified models for suitable tasks and stronger models for complex work, respecting models actually available on the connected subscription. Support more providers when connected/qualified. | U34, U68, U71–U72, U87, U115, U123 | Current source keeps operator-configured models and preserved sessions. Historical usage no longer makes alternatives eligible automatically; current-account model qualification and live routing acceptance remain open. |
| M04 | **Not fixed** | Explain selected versus actual model, reasons, attempts, retries, outcomes and resource use. Separate actual quality from merely finishing a process. | U69–U70, U87, U93 | Native selection/actual-model audit, task cohorts and directly observed queue/comment timing are implemented and checked. Capacity/credential waits are distinguished; full live attempt/outcome/audio journey remains unqualified. |
| M05 | **Not fixed** | Evaluate model choice, prompting and context improvements separately on representative work; preserve failures and compare accepted outcomes. | U87–U88 | Frozen dataset/variant and paired-holdout ledger implemented. Native evaluation rejects mismatched model/provider/account/funding with focused service checks. Native observed-outcome delivery, representative corpus and independent/live evaluator proof remain open. |
| M06 | **Not fixed** | Automatically adopt proven low-risk routing improvements within the agreed policy, with versioned rollout, observation and rollback. Keep company skill adoption distinct. | U67, U88, U91 | Conservative automatic selection/rollback foundation exists; broader experiments/canary/production proof open. |
| M07 | **Not fixed** | Expose meaningful company/admin model analytics, learning/training/evaluation state and improvement history. Do not present empty/unavailable evidence as working learning. | U93, U115, U123 | Admin analytics show task/model cohorts, selected versus actual execution, local shadow decisions, prepared review evidence and explicit unknown quality. Real reviewed outcomes and demonstrated improvement remain open. |
| M08 | **Fixed** | Preserve company data boundaries and existing execution continuity; independent hosting needs its own authenticated tenant boundary. | U64–U67, U87–U88 | Persisted native authorization, standalone HTTP namespace isolation, credential replacement and restart checks pass. Public hosting remains deferred with L02. |

## Connections, performance and human administration

| ID | Status | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- | --- |
| C01 | **Not fixed** | Consolidated connector inventory shows available/connected integrations with manage/edit/disconnect controls, including model accounts and business tools. | U115, U123 | Inventory and management hide stale data after authorization failure; five UI checks pass. Next: persisted disconnect and current-browser inventory acceptance. |
| C02 | **Not fixed** | GitHub, Google Cloud and Vercel access must work for the runtime agents when the corresponding workflow requires them. Development CLI access is not proof of agent access. | U22–U26, U95–U110 | Mixed setup/qualification state; real application/provider workflows remain open. |
| C03 | **Not fixed** | Stripe live changes require explicit approval; provide real scoped connector access and receipts. | U115, U117 | Approval floor implemented; no live write performed as proof. Do not execute one solely to complete a checklist. |
| C04 | **Not fixed** | Higgsfield connector supports the marketing workflow after the owner's deferred sign-in and provider qualification. | U39, U126, U129 | Catalog/preflight prepared; sign-in explicitly deferred. |
| C05 | **Not fixed** | Supabase uses the intended account and CLI connection to support storing incoming operational data and service information. Establish the intended storage workflow without assuming that the local application database must migrate. | U126–U128, U130–U133 | Connection/project and native storage read recorded; those prove connectivity only. Intended data-storage workflow and migration scope remain unresolved; application database stays local. |
| C06 | **Not fixed** | Expand business integrations such as Miro, Jira and Slack when needed; begin with Stripe as requested. | U115, U123 | Later expansion; do not treat every mentioned brand as a connected service. |
| P01 | **Not fixed** | Company Performance shows revenue, recorded costs, profit/loss, views, engagement and publication results, with department/project filters and evidence. | U123–U124 | Four persisted performance scope/data checks pass; malformed and unavailable data are guarded. Next: live connected-source collection and current-browser performance inspection. |
| S01 | **Not fixed** | Public landing page supports open registration; new people wait for owner approval before receiving assigned company access. | U93–U94, U98 | Implemented foundation; real browser registration/approval journey pending. |
| S02 | **Not fixed** | Google sign-in/sign-out and profile switching work using the dedicated AgentOS Google project and correct client/redirect configuration. | U93, U95–U97, U100–U111, U143–U146 | Client ID/secret configured privately and private Google authentication active. Owner claim and actual login/logout remain pending; do not ask for credentials again. |
| S03 | **Not fixed** | `/admin` manages additions, approvals, company access, deletion/suspension and administrative visibility, including model-learning analytics. | U93–U94 | Implemented foundation; end-to-end account lifecycle and analytics qualification pending. |
| S04 | **Fixed** | Use the owner's intended provider accounts/projects; do not reuse unrelated application projects or silently switch provider accounts. | U95–U97, U100–U111, U126–U133 | Constraint; preserve existing selected bindings. CLI preference applies where suitable. |

## Execution, reliability and release

| ID | Status | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- | --- |
| R01 | **Not fixed** | Every admitted workflow exposes relevant operational actions, delegation, tools, outputs, model observations and learning in AgentOS. Select harnesses by proved capabilities, not by a named vendor assumption. | U68–U73 | Partial; complete task/child/failure/recovery reconstruction open. Private model internals are not exposed by all providers; never fabricate them or silently drop the requirement for useful operational evidence. |
| R02 | **Not fixed** | Use qualified subscription seats, initially the owner's Personal Pro context, without silent API billing, paid speech or funding fallback. | U34, U36, U63, U71, U87, U115 | Persisted shared-subscription inheritance and subscription-only policy checks pass. Next: intended current-account automation qualification; no paid fallback. |
| R03 | **Not fixed** | Share one seat's actual capacity across employees/profiles/companies, with bounded concurrency, waiting/recovery and interactive responsiveness. | U34, U36, U71, U87 | PostgreSQL admission/concurrency/wait/recovery checks pass; code is active. Next: owner-selected shared-seat concurrency and live grouped execution. No production group configured. |
| R04 | **Not fixed** | Work survives browser closure and restart; pause/stop/resume, interruption, duplicate delivery, unknown outcomes and recovery retain ownership/evidence and avoid repeated effects. | U2–U3, U39–U41, U63, U69–U70, U92 | 50 local recovery/cancellation/continuity checks pass, including five real worker subprocess cases and HTTP disconnect. Next: signed-in stop/resume/restart journey with actual delegated work. Four remote-Docker checks remain outside local scope. |
| R05 | **Not fixed** | Demonstrate one real Friday → lead → specialist → independent review → accepted output journey before claiming autonomous operation. | U34, U38, U63, U69–U70, U135 | Open qualification; API smoke/component evidence is not this demonstration. |
| L01 | **Fixed** | Keep local deployment until the concept works flawlessly; do not restart the tunnel or provision billable cloud hosting from older instructions. | U108–U114 | Constraint; public hosting deferred. |
| L02 | **Not fixed** | Eventual cloud-native operation continues while the laptop is off, with durable data/workers, backups, restore, monitoring and release/rollback. | U22, U39–U40, U92, U113–U114 | Deferred release phase; local-first does not remove the eventual requirement. |
| L03 | **Not fixed** | Mobile-responsive, fast, usable phone/tablet flows; minimise infrastructure cost without losing functionality or speed. Measure before promising performance/cost. | U89, U92, U113–U114 | Responsive foundation; device/audio/load/cost acceptance outstanding. |
| L04 | **Not fixed** | Validate the current full revision: relevant backend/UI checks, full regression completion, build/typecheck, migrations, actual browser/voice and operating journeys. | U26, U76, U80, U98, U114–U115, U139, U145 | Open. Current targeted tests, semantic checks and UI build pass; full repository, database, browser/audio and live operating acceptance remain incomplete. |

## Evidence pointers and immediate closure order

- [Latest committed refinement record](2026-10-27-agentos-functional-refinement.md): implemented ownership, voice history, 9,221-test UI checkpoint, incomplete broad suite, local deployment, Supabase and deferred Higgsfield, EGM limitation.
- [Shared workforce access](../../maps/agent-access-map/workforce.md): company-scoped read/bind/retirement slices are implemented with explicit native grants; global identity and portfolio management remain operator-only. Native company hiring must not be described as absent.
- [Current model product](../../packages/model-intelligence/README.md): local API, selection/evaluation receipts, pins and conservative improvement rules; hosted namespace authorisation still required.
- [Decisions discussion test](../../ui/src/components/FridayWorkspaceDiscussion.test.tsx): the audit found a closed-transcript expectation; subsequent work corrected it to the final requested opening behavior and preserved context/speech checks.
- [Internal company migration](../../packages/db/src/migrations/0388_lowly_fixer.sql), [company context](../../ui/src/context/CompanyContext.tsx), and [Friday binding](../../ui/src/pages/Friday.tsx): migration and native runtime filtering are now verified in the execution ledger; rendered/operating acceptance is separate.
- [Team instructions](../../packages/teams-catalog/catalog/bundled/company-defaults/agentos-operators/TEAM.md): roles and paused routines do not constitute an installed, qualified CEO/workforce in every company.
- [Model learning plan](2026-10-27-agentos-model-intelligence.md) and [operating model](2026-10-25-agentos-operating-model.md): broader learning, authority, capacity and isolation acceptance.

Recommended immediate closure order: finish/review current changes and migration; supply the workforce proposal; verify internal-company separation and build the linked example; repair the Decisions interaction and voice auto-send; activate/verify already-configured Google auth; run the actual UI/mobile/voice and regression checks; then prove a complete delegated operating workflow and its recovery. Expand live integrations, learning and recurring operations from that evidence. Cloud release remains deferred.

## Source coverage accounting

Product requests, corrections and settled choices are referenced in the tables above. Repeated proceed/status messages and setup dialogue do not create extra product features, but are retained in the source record:

- U1: non-substantive opening.
- U13–U15, U20, U27–U29, U31, U37, U54–U57, U79, U118: progress/continue/execute messages; existing scope retained.
- U18: discuss/design before final build; covered by F03.
- U24–U25: GitHub CLI clarification; covered by F01/C02.
- U48: existing Codex connection failure; covered by R02 and connection/execution qualification, not a new provider or billing route.
- U59–U62 and the image filename in U87: attachment attempts; image contents unavailable in this audit.
- U74: invitation to ask if unclear; covered by F05.
- U77–U78: attempts to repair the development browser connection; not proof of application/browser acceptance.
- U89–U90: API/performance discussion and request to raise omissions; covered by M01/F03/L03.
- U95–U111 and U127–U133: provider setup/ownership dialogue; final choices retained in C02/C05/S02/S04, secrets and codes excluded. Earlier public-hosting choices superseded by U114.
- U112: question about a local database background process; not a new request to install a persistent service or change hosting.
- U119: basic microphone/reply confirmation; later U139 auto-send failure supersedes any claim that all voice requirements were complete.
- U129: explicit Higgsfield postponement.
- U144–U146: credential handoff and repeat branding correction; S02/N07 retain the final state.

This ledger captures the requirements recoverable from the saved text. It does not claim to recover unseen image details, nor does coverage mean implementation is complete. Future work should update individual requirement IDs with acceptance evidence rather than replacing this checklist with another high-level summary.


## Latest platform review — 2026-11-04

This new request is tracked in [the fourteen-item execution log](2026-11-04-agentos-platform-fixes.md).
Its F01–F14 identifiers are local to that document, not replacements for this
reconciliation's original IDs. It includes all ten original bullets plus the
main-orb shadow, latest voice clarification (audio works but is slow and too
brief), compact decisions/detail, explicit Jev implementation, restart failure,
and focused verification/logging instructions. Paid Jev use still requires a
funding exception; implementation does not silently override subscription-only
policy. Public/cloud deployment and Higgsfield sign-in remain deferred.
