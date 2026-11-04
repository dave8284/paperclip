# AgentOS requirements reconciliation

Date: 2026-11-03

This is the acceptance checklist recovered from the previous development conversation. It complements the [master execution plan](2026-10-27-agentos-end-to-end-execution.md), rather than treating that plan's older baseline tables as current status. It includes small interaction requirements as well as the larger operating model.

## Evidence and limits

- Sources: all 146 saved user messages in session `01a16fe4-6b53-7633-97fe-4de98f1ce2f7`, from 24–27 October UTC / 25–28 October New Zealand time, plus the final assistant checkpoints and the current working tree. `U139`, for example, means the 139th saved user message in that session. Source numbering includes repeated prompts and operational replies.
- At the initial audit, the latest saved implementation commit was `933f79bca` with extensive subsequent uncommitted changes. The first execution checkpoint was subsequently committed and pushed as `e7d080c30`; later evidence is recorded below and in the action ledger. Earlier passing checks do not certify later changes.
- This is a requirements reconciliation and targeted source review, not a fresh full runtime acceptance run. No application behavior, account setting, database record or deployment was changed for this audit.
- The source text only names `IMG_6004.JPG` and `IMG_6005.jpg`; their visual contents were not available in the reviewed conversation. No requirements are invented from those filenames.
- Credentials, verification codes and personal account details are deliberately excluded. The final Google credential handoff was recovered, and both required values were confirmed present privately without printing them.
- **Recorded implemented** means code and/or prior checkpoint evidence exists; it does not claim that every interaction is accepted. **Partial** means a foundation exists but part of the requested behavior or end-to-end evidence is missing. **Pending changes** means relevant uncommitted work exists. **Open** means no completion evidence was found. **Deferred** records an explicit postponement. **Constraint** is an enduring instruction, not an unfinished feature.
- A requirement is accepted only when its full behavior has evidence on the relevant revision. Showing a control, installing instructions, saving a URL, or completing a model turn is insufficient proof of its business outcome.

### Execution updates after the reconciliation

The original dispositions below are the audit baseline, not a claim that subsequent authorised work is absent. The [action-plan ledger](2026-11-03-agentos-action-plan.md) tracks current execution. On 3 November:

- **O02:** the [concrete staffing proposal](2026-11-03-agentos-workforce.md) is delivered: three departments, seven initial company roles, and explicit responsibilities/escalation. Role configuration does not prove employee execution quality.
- **O10:** migration 0388 is applied and native APIs confirm ordinary company listing excludes Platform Operations while the explicit internal listing retains it. Existing credentials and dependencies were preserved. Browser/Friday operating acceptance remains separate.
- **O11 / A01:** the pre-existing Northstar example now has three departments, four projects, eight tasks, six native versioned documents, three pending decisions, two paused routines with disabled schedules, and an immutable downloadable scope file. The scope has two revisions. Native work aggregation reconciles the projects, tasks, seven assignments and document evidence. Records are explicitly illustrative; no execution results or revenue were fabricated.
- **D01–D05 / V06:** Decisions discussion now opens Friday with exact decision context. The previously contradictory test was corrected and the relevant behavior tests pass. Physical voice and real-browser evidence remain open.
- **O04 / O07:** company-scoped shared-workforce read/bind routes were added under native grants and responsible-owner intersection. Independent review found a revocation race and target-scope omission; fixes and concurrent regression cases are now under review. Database execution is blocked by isolated-listener sandbox restrictions.
- **A05:** official Google EGM research, pinned-source attribution, qualification instructions and a retained-trace auditor are delivered. Native execution isolation and evaluated learning remain open; see the [EGM integration record](2026-11-03-agentos-egm-integration.md).
- **S02:** supplied credentials remain privately configured. Pre-activation review found local-owner responsibility was not fully transferred by the existing claim flow; fix this before enabling authentication.
- **L04:** token gates, structural module maps and diff whitespace checks pass. The initial full UI run exposed 43 failures; all affected files pass focused corrections and a complete rerun is underway. Browser/audio and isolated database checks are not marked passed.

On 4 November, the continuation adds bounded company-local retirement with explicit native grants, employee-awareness reads without company elevation, server-scoped performance reporting, and an independent paired-holdout comparison ledger. These advance **O04/O06, O09/A02, P01 and M05/M06** but do not close live operating or learning acceptance. The [current execution ledger](2026-11-03-agentos-action-plan.md#continuation-checkpoint--2026-11-04) retains exact passing checks, review fixes and unavailable database/browser/audio evidence. Google authentication is active; owner sign-in/claim and authenticated activation of the new backend remain pending.

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

## Foundation and delivery method

| ID | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- |
| F01 | Maintain an actual GitHub fork of Paperclip, extending its working engine and preserving existing capabilities and history. Push reviewed work to the fork. | U2–U4, U17, U21–U26, U30 | Recorded implemented; latest edits remain uncommitted. |
| F02 | Build the whole platform without requiring the owner to nominate a pilot application first. Support both existing in-flight repositories and new ideas. | U21–U23, U26, U30 | Constraint; registry foundation exists, complete delivery journeys remain open. |
| F03 | Retain the requested full plans/design demonstrations and carry accepted refinements into the real application. Existing approval authorises routine implementation; this is not a requirement for another approval/demo before every change. | U8–U12, U16–U19, U21–U22, U42, U76, U80–U82, U90–U91, U98 | Plans/prototypes exist; real-interface acceptance remains incomplete. |
| F04 | Use parallel development agents where useful; implement here, not by sending platform-build tasks to Friday. | U58, U80, U136–U137, U141 | Constraint; applied during implementation and this audit. |
| F05 | Explain concrete blockers before substituting another approach, billing model or capability. Ask for genuinely missing inputs; do not repeatedly request authorised routine steps. | U26, U35–U36, U42, U58, U74, U76, U90, U115, U134, U137 | Constraint. |
| F06 | Hide/archive unnecessary inherited functionality with an inventory and restoration path; retain useful skills, profiles, configuration, audit, chat, routines and artefacts. | U52, U63, U73, U75, U123 | Partial; capability inventory exists, complete simplification/restore acceptance remains. |

## Companies, workforce and accountability

| ID | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- |
| O01 | Create companies representing ventures; group projects under departments; break projects into accountable tasks/actions. Scope navigation and records to the selected company/project. | U63, U82–U83, U115–U116, U123, U135 | Recorded implemented foundation; final integrated journey needs acceptance. |
| O02 | Supply a concrete staffing proposal: number of divisions, department heads, product/portfolio managers and project leads, responsibilities and escalation paths. | U135, U139 | Open deliverable; existing role/assignment fields are not this proposal. |
| O03 | Friday coordinates the portfolio, understands platform capabilities, navigates supported pages through conversation, searches the web when useful, consults managers/leads, reports back with context, creates work and chooses accountable leads. | U34, U38, U40–U41, U45, U63–U64, U135 | Partial; awareness and native work APIs exist, delegated portfolio authority and live coordination are incomplete. |
| O04 | CEOs can hire/retire within limits; leads select/delegate specialists as needed. Keep staffing, ownership and changes auditable. | U5–U6, U34, U38, U63, U66 | Partial; native company hiring and bounded company-local shared binding/retirement exist. Live delegated staffing and lead/specialist operating proof remain open. |
| O05 | Reuse persistent skilled employees across companies while keeping company-private work and permissions isolated. | U5–U6, U65–U67 | Recorded identity/assignment foundation; complete multi-company operating acceptance remains. |
| O06 | Retire only one company's assignment; improve/refine successors; publish evaluated shared capabilities centrally; allow independent company adoption, pins and rollback. | U66–U67 | Company-local delegated retirement implemented with explicit target authority; database/live acceptance and cultivation/publication/adoption remain open. |
| O07 | Portfolio/product managers see their authorised portfolio, project leads their projects, execution agents their assigned work; support escalation through that structure. | U64, U135 | Partial; accountability reads and lead assignments exist, full operating/scoped-authority journey unproven. |
| O08 | Preserve employee profiles, instructions, skills, harness/model selection, subscription bindings and spending controls. Explain which roles are upstream and which were added. | U33, U52, U63, U75 | Recorded implemented foundation; role installation is not proof of expertise. |
| O09 | Direct employee chat can answer what that employee is doing across its authorised assignments, projects and companies. | U52, U63, U65 | Partial; native shared-identity awareness returns authorized work. Agents remain current-company scoped; board reads cover independently authorized companies. Delegated cross-company agent reads and live chat acceptance remain open. |
| O10 | Keep AgentOS internal infrastructure out of the business portfolio while preserving Friday, employees, credentials and connections needed to operate. | U32, U139, U141–U142 | Pending changes: company purpose/classification migration and filtering. Actual runtime migration/filtering still needs verification. |
| O11 | Create a realistic example company with linked departments/projects, work, decisions, routines and artefacts so the complete experience can be inspected. | U139 | No completion evidence found; verify whether it was created, otherwise create it. Separate from O10. |
| O12 | Allow appropriate company/project/task deletion and account administration. Company deletion belongs in Settings, not Workforce. | U99, U123, U135–U136, U139–U142 | Partial; controls/foundations exist; full deletion and internal-dependency preservation journeys need verification. |

## Friday voice and conversation

| ID | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- |
| V01 | Friday is the main voice-first interface, with typing available. Talk starts listening without a command/modal flow; Friday replies aloud naturally. Use local/open-source speech without additional paid services. | U43–U45, U49, U51, U82–U83, U115 | Local speech implemented; basic input/reply confirmed at U119, later failures prevent closing the whole flow. |
| V02 | Show live transcription under Friday in the status area while speaking; make it responsive. Upper-right microphone shows muted red/slashed versus enabled/listening blue. | U86, U120, U134 | Implemented/pending refinements; latest physical-device acceptance remains. |
| V03 | End a normal spoken turn, automatically send the message, and receive a spoken reply. Do not misreport a held draft as sent. | U115, U119–U120, U139 | Pending silence/endpoint fixes. U139 reports failure after U119's earlier basic success. |
| V04 | Keep the microphone enabled across navigation until explicitly muted. Support interruption and continued conversation, including during execution. | U115, U134 | Implemented foundation; interruption, room noise and navigation acceptance unverified. |
| V05 | Show distinct listening, thinking and speaking states based on actual activity, and clear mic-off state. | U82, U86, U120, U134 | Recorded implemented; current rendered/audio timing still needs verification. |
| V06 | Orb click explicitly toggles the transcript. Keep chat closed otherwise, including navigation and incoming activity; dock Friday bottom-right on work pages. | U49, U52, U82–U83, U99, U115, U134–U135 | Implemented/pending refinements. Decisions discussion is the explicit exception below. |
| V07 | Home transcript is far-left, borderless and shadow-free, inset from the edge by the requested additional space; Friday owns most of the full white canvas. Docked chat has a readable background. | U50, U82–U83, U99, U134–U135, U139 | Pending layout refinements; visual acceptance required. |
| V08 | Keep durable conversation/history and drafts through navigation. Avoid unnecessary New chat flows and a second central typing modal. | U52, U63, U82–U83 | Recorded implemented foundation; integrated navigation/recovery acceptance remains. |
| V09 | Ordinary clarification happens in conversation, not command-palette or multiple-choice pop-ups. Preserve real action approval effects. | U121–U123, U134 | Implemented/pending shell changes; verify actual runtime questions. |
| V10 | Introductory copy disappears after interaction; useful suggestions adapt to current work and user activity. | U123 | Requirement retained; adaptive suggestion behavior not fully audited/accepted. |
| V11 | Voice preferences belong in Settings. Friday is fixed; remove the ordinary coordinator selector. | U123, U136 | Recorded refinements; verify all entry points. |

## Navigation, branding and visual work

| ID | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- |
| N01 | Use the selected white Friday design in the actual app; public pages scroll; navigation renders companies/projects in the central canvas instead of unnecessary modals. | U50, U80–U83, U98–U99 | Recorded implemented foundation; current visual acceptance open. |
| N02 | Put Departments above Projects in company navigation; no duplicate Departments/Projects tab layer. Scope Artefacts, Routines, Decisions and other views consistently. | U83, U115, U123, U135 | Recorded implemented; verify nested scopes/counts and navigation. |
| N03 | Project Home shows work/activity, Kanban shows the board, Agent Map shows the graph. Include Agent Map entry alongside Work. Retain navigation on Audit. | U7, U52, U82–U85 | Recorded implemented foundation; current integrated acceptance open. |
| N04 | Workforce and audit use inspectable tables, with profile/detail navigation and retained controls. | U52, U63, U83, U115 | Recorded implemented; latest UI verification remains. |
| N05 | Settings is last in workspace navigation beneath Saved displays; consolidate company profile/deletion, voice, connectors and model controls. No home Settings shortcut after the final correction. | U115, U123, U136, U139 | Recorded/pending changes; final override must be preserved. |
| N06 | Top-right profile supports sign-in/out/account switching. Remove redundant Operating connectors and coordinator settings entry points. | U123, U143 | Partial; final navigation and real auth acceptance pending. |
| N07 | Replace visible Paperclip names, logos, loading/mascot animations, avatars and install/browser icons with AgentOS/Friday orb identity. | U83, U138, U145 | Large pending rebrand; full surface audit and visual acceptance open. Required legal attribution is retained. |
| N08 | Suppress unsolicited agent/run notification pop-ups; keep useful errors/context visible inline. Saved displays uses a monitor/TV icon. | U139 | Pending shell/toast/icon changes; runtime verification open. |
| G01 | Every work/data graph point represents an actual resource or record, not decorative simulated work. Show observed activity and completed work. | U7, U16, U52, U63, U69–U70 | Partial; record-backed graph exists, complete execution/resource coverage unqualified. |
| G02 | Use attractive vibrant pastel Friday-style employee spheres, colours distinguishing categories, with distinct task/data/evidence points. | U11, U16, U21, U46–U47, U82, U87, U99, U115, U123, U135 | Recorded/pending display work; user visual acceptance outstanding. |
| G03 | Zoom between portfolio, company, project, employee, task and evidence; pan/back/drill down reliably. Opening a task shows its actual detail, completion and outputs. | U7, U16, U63, U115 | Implemented foundation; final interaction acceptance remains. |
| G04 | Show agent relationships, delegations and data interactions; distinguish available datasets/permissions from actual reads/writes. Keep graph, Kanban and activity consistent. | U7, U16, U52, U63, U69–U70 | Partial; comprehensive resource/action graph remains unqualified. |

## Decisions and proactive coordination

| ID | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- |
| D01 | Automatically surface decisions/blockers and a prioritised agenda from work, product feedback and operating signals across the authorised portfolio. | U40, U52–U53, U63 | Partial; native attention exists, proactive proposal generation/full operating loop unproven. |
| D02 | Company Decisions aggregates its projects; project Decisions stays scoped. Open a full description/evidence without a redundant Open step. | U63, U83, U115, U123 | Recorded implemented foundation; integrated scope/context acceptance remains. |
| D03 | Present an agent's concrete recommended course with understandable Approve/Disapprove actions and actual native effects; accept alternative instructions through conversation. | U40, U115, U123, U135, U139 | Pending refinements; real recommendation → decision → execution journey unproven. Blockers must not pretend to have a binary approval. |
| D04 | Discuss with Friday exists only in Decisions, automatically passes the exact source/revision/context, and lets Friday investigate with the relevant lead. | U135, U139–U140 | Pending context/button changes; live investigation and response need verification. |
| D05 | Clicking Discuss opens a right-side conversation panel with a background and starts Friday's response/speech. | U139–U140 | Known mismatch: current discussion test expects transcript to remain closed. Must correct and verify. |

## Routines, applications and recurring business work

| ID | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- |
| W01 | Adopt existing in-flight GitHub applications without losing work, or start from an idea; inspect, plan, form a team, implement, verify and release. | U2–U6, U21–U23, U34, U38, U63 | Registry/native foundations exist; real complete delivery journeys outstanding. |
| W02 | Operate development, product management, marketing, sales, support and production maintenance through accountable specialists/leads. | U2–U6, U22, U38–U41 | Roles exist; qualified business workflows outstanding. |
| W03 | Friday commissions recurring work; a dedicated lead/agent owns the loop. Agents can create projects, tasks, routines and artefacts under their grants. | U38–U41, U52, U63, U75 | Native APIs/instructions exist; live delegated operating proof incomplete. |
| W04 | Routines show connected agents/steps/triggers, live work and outputs in a workflow-style diagram, relationships between multiple loops, and each loop's cycle history. Create/edit loops and triage work when needed. | U115, U123 | Bounded graph/editor, related-loop and cycle-history foundations implemented; arbitrary visual rewiring/active-run changes are not established. Check actual desired interventions against supported controls. |
| W05 | Run the concrete marketing cycle: create content/video through Higgsfield, publish to TikTok/LinkedIn, inspect comments/reach, revise and repeat with retained outputs and measures. | U39–U41, U115 | End-to-end workflow open; provider capabilities/authority must be qualified. Higgsfield login deferred. |
| W06 | Convert application health, comments and feedback into prioritised work and owner decisions; perform authorised repairs/improvements and observe results. | U2–U3, U22, U40 | Full recurring operating journey open. |
| W07 | On explicit owner request, Friday can arrange platform features, skills/connectors and release/redeployment with review and independent recovery. | U39–U40, U63 | Future capability open. It is not the method of implementing this current build. |

## Artefacts, knowledge, search and generated views

| ID | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- |
| A01 | Retain every produced artefact and relevant version, preview/download and provenance, scoped to company/project/task; store locally now and durably online when deployed. | U52, U63, U75, U115 | Native attachments/revisions exist; complete live workflow/history acceptance remains. |
| A02 | Search/retrieve across company, project, task and employee, including relevant routines, artefacts, conversations and knowledge under access rules. | U63, U75 | Native foundations exist; complete cross-surface search journey not audited/accepted. |
| A03 | Friday creates requested dynamic tables/displays in the main canvas, saves recurring useful views and reuses them rapidly with current data. | U44–U45, U63 | Snapshot/saved-reference foundation implemented; live reusable bindings/components remain broader work. |
| A04 | Sandbox generated code/displays; promote useful components through the owner-requested platform change path. Preserve source/output visibility. | U39, U44, U63 | Isolated snapshot preview exists; complete reusable-extension/release path open. |
| A05 | Integrate the Google Elephant/Goldfish method into real context-rich planning, independently isolated review, recorded findings/resolution and reusable lessons. | U135 | Skill installed; runtime isolation, orchestration and learning proof open. |

## Model Intelligence and learning

| ID | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- |
| M01 | Maintain an independent model-selection/learning product, integrated into AgentOS, API-accessible and separately packageable/runnable. Keep selection fast. | U87–U89, U93 | Local library/HTTP/SQLite foundation implemented; hosted/distribution/upgrade acceptance incomplete. |
| M02 | Maintain a central library of task examples/families, eligible model choices, outcomes, iterations and improvements; route new work using that evidence. | U87–U88, U115, U123, U125 | Receipt/evaluation store and conservative rules implemented; meaningful real learning evidence outstanding. |
| M03 | Select efficient qualified models for suitable tasks and stronger models for complex work, respecting models actually available on the connected subscription. Support more providers when connected/qualified. | U34, U68, U71–U72, U87, U115, U123 | Partial; same-agent observed subscription candidates supported, complete provider/profile qualification outstanding. |
| M04 | Explain selected versus actual model, reasons, attempts, retries, outcomes and resource use. Separate actual quality from merely finishing a process. | U69–U70, U87, U93 | Native logs/selection receipts exist; full stage/attempt/outcome journey unqualified. |
| M05 | Evaluate model choice, prompting and context improvements separately on representative work; preserve failures and compare accepted outcomes. | U87–U88 | Frozen dataset/variant and paired-holdout evidence ledger implemented and tested; native observed-outcome delivery, representative corpus and independent/live evaluator proof remain open. |
| M06 | Automatically adopt proven low-risk routing improvements within the agreed policy, with versioned rollout, observation and rollback. Keep company skill adoption distinct. | U67, U88, U91 | Conservative automatic selection/rollback foundation exists; broader experiments/canary/production proof open. |
| M07 | Expose meaningful company/admin model analytics, learning/training/evaluation state and improvement history. Do not present empty/unavailable evidence as working learning. | U93, U115, U123 | Analytics surfaces exist; real reviewed outcomes and richer learning analytics pending. |
| M08 | Preserve company data boundaries and existing execution continuity; independent hosting needs its own authenticated tenant boundary. | U64–U67, U87–U88 | Native integration boundaries exist; independent multitenant hosting remains later productisation work. |

## Connections, performance and human administration

| ID | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- |
| C01 | Consolidated connector inventory shows available/connected integrations with manage/edit/disconnect controls, including model accounts and business tools. | U115, U123 | Recorded settings foundation; full inventory/state/action acceptance pending. |
| C02 | GitHub, Google Cloud and Vercel access must work for the runtime agents when the corresponding workflow requires them. Development CLI access is not proof of agent access. | U22–U26, U95–U110 | Mixed setup/qualification state; real application/provider workflows remain open. |
| C03 | Stripe live changes require explicit approval; provide real scoped connector access and receipts. | U115, U117 | Approval floor implemented; no live write performed as proof. Do not execute one solely to complete a checklist. |
| C04 | Higgsfield connector supports the marketing workflow after the owner's deferred sign-in and provider qualification. | U39, U126, U129 | Catalog/preflight prepared; sign-in explicitly deferred. |
| C05 | Supabase uses the intended account and CLI connection to support storing incoming operational data and service information. Establish the intended storage workflow without assuming that the local application database must migrate. | U126–U128, U130–U133 | Connection/project and native storage read recorded; those prove connectivity only. Intended data-storage workflow and migration scope remain unresolved; application database stays local. |
| C06 | Expand business integrations such as Miro, Jira and Slack when needed; begin with Stripe as requested. | U115, U123 | Later expansion; do not treat every mentioned brand as a connected service. |
| P01 | Company Performance shows revenue, recorded costs, profit/loss, views, engagement and publication results, with department/project filters and evidence. | U123–U124 | Report UI/storage and server-scoped project/department coverage implemented; stale/error data is suppressed. Database/live connected-source collection remains unproven; missing data remains missing. |
| S01 | Public landing page supports open registration; new people wait for owner approval before receiving assigned company access. | U93–U94, U98 | Implemented foundation; real browser registration/approval journey pending. |
| S02 | Google sign-in/sign-out and profile switching work using the dedicated AgentOS Google project and correct client/redirect configuration. | U93, U95–U97, U100–U111, U143–U146 | Client ID/secret configured privately and private Google authentication active. Owner claim and actual login/logout remain pending; do not ask for credentials again. |
| S03 | `/admin` manages additions, approvals, company access, deletion/suspension and administrative visibility, including model-learning analytics. | U93–U94 | Implemented foundation; end-to-end account lifecycle and analytics qualification pending. |
| S04 | Use the owner's intended provider accounts/projects; do not reuse unrelated application projects or silently switch provider accounts. | U95–U97, U100–U111, U126–U133 | Constraint; preserve existing selected bindings. CLI preference applies where suitable. |

## Execution, reliability and release

| ID | Required outcome | Sources | Current disposition |
| --- | --- | --- | --- |
| R01 | Every admitted workflow exposes relevant operational actions, delegation, tools, outputs, model observations and learning in AgentOS. Select harnesses by proved capabilities, not by a named vendor assumption. | U68–U73 | Partial; complete task/child/failure/recovery reconstruction open. Private model internals are not exposed by all providers; never fabricate them or silently drop the requirement for useful operational evidence. |
| R02 | Use qualified subscription seats, initially the owner's Personal Pro context, without silent API billing, paid speech or funding fallback. | U34, U36, U63, U71, U87, U115 | Subscription enforcement foundation exists; complete intended automation-mode qualification remains. |
| R03 | Share one seat's actual capacity across employees/profiles/companies, with bounded concurrency, waiting/recovery and interactive responsiveness. | U34, U36, U71, U87 | Native checks/retries exist; broader seat-wide admission/fairness contract incomplete or unqualified. |
| R04 | Work survives browser closure and restart; pause/stop/resume, interruption, duplicate delivery, unknown outcomes and recovery retain ownership/evidence and avoid repeated effects. | U2–U3, U39–U41, U63, U69–U70, U92 | Required operating/release evidence from accepted plans; real complete journeys outstanding. |
| R05 | Demonstrate one real Friday → lead → specialist → independent review → accepted output journey before claiming autonomous operation. | U34, U38, U63, U69–U70, U135 | Open qualification; API smoke/component evidence is not this demonstration. |
| L01 | Keep local deployment until the concept works flawlessly; do not restart the tunnel or provision billable cloud hosting from older instructions. | U108–U114 | Constraint; public hosting deferred. |
| L02 | Eventual cloud-native operation continues while the laptop is off, with durable data/workers, backups, restore, monitoring and release/rollback. | U22, U39–U40, U92, U113–U114 | Deferred release phase; local-first does not remove the eventual requirement. |
| L03 | Mobile-responsive, fast, usable phone/tablet flows; minimise infrastructure cost without losing functionality or speed. Measure before promising performance/cost. | U89, U92, U113–U114 | Responsive foundation; device/audio/load/cost acceptance outstanding. |
| L04 | Validate the current full revision: relevant backend/UI checks, full regression completion, build/typecheck, migrations, actual browser/voice and operating journeys. | U26, U76, U80, U98, U114–U115, U139, U145 | Open. Current targeted tests, semantic checks and UI build pass; full repository, database, browser/audio and live operating acceptance remain incomplete. |

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
