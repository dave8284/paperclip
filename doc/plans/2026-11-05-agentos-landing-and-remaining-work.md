# Landing correction and remaining work — 5 November 2026

The owner again requested actual application screenshots on the public landing
page, a large Friday sphere on the right, vertically centered copy on the left,
and an accurate account of everything still unfinished. This checkpoint does
not treat the latest fourteen source fixes as completion of the whole platform.

## Landing delivery

The landing page owns the layout; its existing FridayOrb remains the shared
renderer and interaction owner. Landing-only sizing stays in the token layer.
Desktop uses two columns, with text and actions on the left and the enlarged
reactive sphere on the right. Smaller screens stack the two. Authentication,
waiting-list links, hover movement and reduced-motion behavior are preserved.

**Screenshots are still blocked, not delivered.** Current tool discovery exposes
neither the Browser nor Chrome execution tool. The Chrome instructions are
installed, but instructions alone cannot capture a page. The owner explicitly
requested Chrome; renewed discovery and plugin search did not supply its control
tool. Existing saved images are older upstream UI, not this current dashboard.
No stock image, generated mockup or legacy screen is substituted.

Once capture is available, use the current workspace overview, Agent Map and
Decisions view beside the matching feature descriptions. Inspect images for
private account/credential details before adding public assets, retain readable
desktop framing, add descriptive alt text, and verify the mobile layout.

## Remaining work, in delivery order

1. **Finish the landing images and visual check.** Hero source correction is
   separate from the missing screenshots and rendered desktop/mobile acceptance.
2. **Activate the backend and confirm account behavior.** Run the prepared native
   restart handoff, then verify Google-only access, automatic owner approval/admin
   and retained company/conversation access. Local health is healthy; the
   supervisor still records its last restart as 3 November. Public health's Git
   commit reads the checkout and does not prove backend activation.
3. **Retest the reported interactions.** Performance's exact `type` error remains
   unreproduced. Confirm create/edit/save/reopen loops, real voice latency and
   interruption, sphere appearance, file/navigation organization, decisions,
   user management and the eight connectors. Focused source checks already
   passed; the owner asked to perform final practical acceptance.
4. **Prove a real delegated workflow and Elephant–Goldfish review.** Execute
   Friday → lead → specialist → independent reviewer → accepted output; inspect
   actual evidence, isolated review and recovery, then evaluate a reusable lesson.
   The Northstar example is illustrative, not a completed operating proof.
5. **Finish workforce authority, upgrades and shared subscription capacity.**
   Complete portfolio delegation and authorized cross-company awareness,
   evaluated capability publication/adoption/refusal with pins and rollback,
   and seat-wide fair scheduling with bounded waits/recovery. Per-agent
   concurrency does not reserve a shared subscription seat.
6. **Finish knowledge and reusable components.** Broaden authorized
   conversation/knowledge retrieval, prove graph/provenance/routine history
   through real execution, complete richer editable routine relationships and
   reusable component promotion beyond the saved table types.
7. **Qualify model learning.** Activate local Laya shadow observations, evaluate
   representative tasks before routing promotion, qualify execution-account
   entitlements, collect reviewed outcomes, and prove measured policy
   improvements and rollback. Independent model-service HTTP/upgrade/revocation
   qualification remains open.
8. **Complete real business/provider workflows.** Prove existing/new application
   delivery, feedback-to-repair, marketing loops and real performance collection;
   verify runtime-agent tool access and settle the intended Supabase operational
   storage. The eventual Friday platform-engineering/release workflow and its
   independent recovery are also outstanding.
9. **Keep explicitly deferred work separate.** Higgsfield sign-in and public/cloud
   deployment were postponed by the owner. Always-on hosting eventually needs
   durable workers/storage, backups, monitoring and recovery.

Detailed prior evidence remains in the [requirements reconciliation](2026-11-03-agentos-requirements-reconciliation.md),
[action plan](2026-11-03-agentos-action-plan.md#remaining-work-after-this-implementation-checkpoint)
and [fourteen-fix log](2026-11-04-agentos-platform-fixes.md).

## Verification

- Three existing landing tests passed; pointer/decorative behavior, waiting-list
  navigation and approved/pending/preview behavior are preserved. Evidence:
  `/private/tmp/agentos-landing-hero-tests-r2-20261105.log`.
- Token gates and whitespace checks passed. Evidence:
  `/private/tmp/agentos-landing-hero-token-gates-final-20261105.log`.
- The initial test invocation used an unsupported named-project filter and found
  no project. Running the existing test from `ui` with its own configuration
  passed; this was a command-selection failure, not a product-test failure.
- The local Vite module returns HTTP 200 with the new desktop columns and
  landing sphere stage. This confirms source delivery, not rendered appearance.
- Browser capture and rendered visual acceptance remain unavailable; no
  screenshot completion is claimed. Review at `http://localhost:3100/welcome`
  keeps the landing visible even for an approved signed-in account.
