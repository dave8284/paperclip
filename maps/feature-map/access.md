---
navigation: {"section":"Getting started and access","sectionOrder":10,"order":20}
---

# Login, invitations, and access

People and agents enter the correct instance and company with the permissions granted to their identity. Login, membership, resource access, and CLI authorization have separate controls.

Feature ID: `access`.

Implementation: [auth page](../../ui/src/pages/Auth.tsx), [company members](../../ui/src/pages/CompanyAccess.tsx), [invitation](../../ui/src/pages/InviteLanding.tsx).

Agent access: [companion](../agent-access-map/access.md).

## Sub-features

- `login`: `access/login` — sign in or claim the board in the configured deployment mode.
- `invitations`: `access/invitations` — join through a valid invite and handle expired or already-used links.
- `membership`: `access/membership` — review join requests and manage company/instance membership and permissions.
- `resources`: `access/resources` — respect company and resource boundaries on deep links and mutations.
- `cli-auth`: `access/cli-auth` — authorize a CLI session and revoke or replace credentials.

## How to get to it (user POV)

### `login`

Open `/auth`; first-owner bootstrap uses `/board-claim/:token` when configured.

The AgentOS public landing uses Wispr Flow as a layout reference, not a product
feature claim. It introduces Friday, company work, digital employees and decisions
with the tagline “Turn ideas into coordinated action.” Desktop places the text
left and the larger sphere right; mobile stacks them. Google signup links lead
to the waiting list. The hero orb responds to pointer
position and movement with tilt and spin, plus an explicit hover pulse that grows
and shrinks even when the pointer stays still, then settles without an idle frame loop.
Reduced-motion, coarse/touch input, hidden-page and offscreen guards keep this
decoration separate from the workspace orb's observed voice/run states. The
landing does not open the microphone or start agent work. Sign-in, sign-up and
approved/pending redirects retain the existing registration flow.
`AgentOSLanding.test.tsx` and `FridayOrb.test.tsx` cover DOM routing and motion
lifecycle; `Friday.test.tsx` and `FridayWorkspace.test.tsx` retain workspace
coverage. The owner’s current design uses one prominent dashboard capture below
the hero, with a rounded frame and shadow; the feature sections contain text.
`ui/public/images/agentos/dashboard.png` shows the current local app with isolated
Northstar example data, no personal account details or claimed business execution.
The single preview links to its full-size capture and loads lazily with intrinsic dimensions. Physical voice
input/output and interactive Google login remain separate qualifications.

In local-trusted mode the profile menu identifies the local workspace and omits
synthetic-user email/sign-out controls. Authenticated mode retains the actual
account, sign-out and account-switch actions.

AgentOS shows **Continue with Google** without password fields or email
registration controls, including with older password-enabled backend options.
Loading or failed method discovery does not show cached methods. Signup mode
introduces the waiting list. A pending account sees a thank-you and a finite
confetti burst, skipped for reduced motion. **Refresh approval status** refetches
native registration and shows explicit pending feedback or redirects to the
workspace when approved; it does not approve the account. Errors and rejected or
suspended identities do not celebrate. Fresh identity/status checks gate redirects.
The deployment setting and exact OAuth callback are documented in
[development setup](../../doc/DEVELOPING.md).

An operator-configured Google owner can be automatically approved and made an
instance administrator after fresh verified Google sign-in. Exact email,
canonical issuer/subject and the persisted account must match; ordinary new
accounts remain pending. Approval, native ownership transfer and audit are
transactional. A previous native claimant can complete legacy local-board chat
and operational ownership only within currently active owner memberships. Later
revoked company access, suspension/rejection and demotion are not restored.
The local operator setting is prepared but the running backend still needs its
normal authenticated restart and fresh Google sign-in. Offline hook/service tests
do not qualify real Google verification, PostgreSQL persistence or concurrency.

When converting a local Agent OS instance to authenticated ownership, the native
claim ceremony transfers local-board-owned portfolios, explicit company defaults,
visible unfinished task responsibility and current routine responsibility to the
claimant. Routines receive a new revision; prior revisions, runs, creators and
audit records retain their original identity. Active local-board memberships are
archived so a company without an explicit default cannot fall back to that retired
identity. Another real user's ownership is preserved. These changes, approval,
membership, portfolio audit and owner default grants commit together or roll back.
Existing agent API keys keep their original responsible identity and require
deliberate reissue before they act for the new owner.
Existing local-board chats transfer to the claimant with the same thread IDs,
session boundaries, comments and attachments, including hidden threads. If the
claimant already has a chat with the same agent, the claim fails with a conflict
and preserves both threads and all prior ownership; it does not merge chats.

### `invite-members`

Open `/invite/:token`; operators manage members in company settings and join requests at `/inbox/requests`.
Create/revoke human links at Members → Invites
(`/company/settings/members?tab=invites`). Human invitees receive the chosen
role after sign-in; agent invitations still use join-request approval.

### `cli-authorization`

Start the CLI auth/connect flow and approve its `/cli-auth/:id` browser page; instance access is under Settings when visible.

## Driving it with Playwright and the Paperclip CLI

Preconditions: follow the [baseline](./README.md#before-driving-a-journey). For login tests use authenticated mode and two test users; local-trusted mode does not prove session enforcement. Use two companies for isolation checks.

### `login`

Automated: [auth UI](../../ui/src/pages/Auth.test.tsx) and [session routes](../../server/src/__tests__/auth-session-route.test.ts) cover their respective layers.

The 2026-11-04 Google-only change passed 36 UI/API cases and 32 auth cases,
including [actual handler policy checks](../../server/src/__tests__/password-auth-policy.test.ts)
without a listener. Verify the real Google consent/redirect separately, including
owner-claim and remembered-invitation return paths, account approval, sign-out and
denial of direct password endpoints. Local source tests do not establish that
Google's OAuth client registration or a live session works.

The [claim regression cases](../../server/src/__tests__/board-claim.test.ts) cover
operational ownership, null-default membership fallback, other-owner/history/key
preservation, chat continuity/collision rollback and SQL-fault rollback of routine
revision or owner grant writes.
The 2026-11-04 additions are source-reviewed, not runtime-qualified: this sandbox
cannot start the isolated PostgreSQL listener (`listen EPERM`); the known failing
setup was not repeated for these cases.

Manual: Sign in, reload a company deep link, sign out, and revisit it. Confirm the browser requests authentication rather than showing cached company data. Test an invalid claim separately on disposable state.

### `invite-members`

Automated: [member UI](../../ui/src/pages/CompanyAccess.test.tsx) and [invite replay](../../server/src/__tests__/invite-accept-replay.test.ts) provide component and route evidence.

Manual: Accept an invite as the intended user, inspect the resulting company and permissions, then reuse and expire disposable invites. Change a member permission, reload as that member, and verify a denied operation on another company remains denied.

### `cli-authorization`

Automated: [board auth client](../../cli/src/__tests__/board-auth.test.ts) and [token commands](../../cli/src/__tests__/token.test.ts) cover the client contracts.

Manual: Authorize the intended CLI context, make a read-only company request, then revoke its token and retry. Verify failure is explicit and does not silently fall back to another identity.

Use `auth login`, `auth whoami`, and `auth revoke-current` with explicit context.
Retry with the same bearer to prove revocation; deleting local credentials with
logout alone does not establish that server revocation succeeded.

## Gotchas

- External assistants use their own [browser/device consent and personal MCP grants](./assistant-connections.md). Human CLI tokens and agent bearer keys have separate authorization paths.
- Settings visibility is not authorization; direct requests still need permission checks.
- An agent bearer key must not gain another company’s access.
- Never put invite tokens, session cookies, or API keys in verification evidence.

### Storybook verification

#### `login`

Capability ID: `access/login`.

Scope: ui
Storybook: Sign-in form, pending and invalid credentials, deployment-mode claim gate, expired claim.
Production: Authenticate and reload company deep link; sign out and confirm session enforcement; reject invalid bootstrap claim.
Sources: Source: [Auth.tsx](../../ui/src/pages/Auth.tsx), [BoardClaim.tsx](../../ui/src/pages/BoardClaim.tsx), [board-claim.ts](../../server/src/board-claim.ts). Tests: [Auth.test.tsx](../../ui/src/pages/Auth.test.tsx), [auth-session-route.test.ts](../../server/src/__tests__/auth-session-route.test.ts), [board-claim.test.ts](../../server/src/__tests__/board-claim.test.ts)

#### `membership`

Capability ID: `access/membership`.

Scope: ui
Storybook: Member and join-request lists; editable versus read-only roles; pending change, rejected request, revoked invite.
Production: Persist role/membership changes; enforce actual actor authority, invite replay/expiry and cross-company denial.
Sources: Source: [CompanyAccess.tsx](../../ui/src/pages/CompanyAccess.tsx), [authz.ts](../../server/src/routes/authz.ts). Tests: [CompanyAccess.test.tsx](../../ui/src/pages/CompanyAccess.test.tsx), [invite-accept-replay.test.ts](../../server/src/__tests__/invite-accept-replay.test.ts), [multi-user-authenticated.spec.ts](../../tests/e2e/multi-user-authenticated.spec.ts)

#### `cli-auth`

Capability ID: `access/cli-auth`.

Scope: ui
Storybook: CLI authorization approval, pending, expired/denied and already-authorized states.
Production: Authorize intended CLI identity/context, make scoped request, revoke current server token and retry same bearer; logout alone is insufficient.
Sources: Source: [CliAuth.tsx](../../ui/src/pages/CliAuth.tsx). Tests: [cli-auth-routes.test.ts](../../server/src/__tests__/cli-auth-routes.test.ts), [board-auth.test.ts](../../cli/src/__tests__/board-auth.test.ts), [token.test.ts](../../cli/src/__tests__/token.test.ts)


### AgentOS account controls — 2026-11-04

Admin → Users exposes explicit Edit/Delete actions instead of requiring a name
click. Management focuses and scrolls into view. It reuses native revisioned
rename, approval, role, membership and delete endpoints; confirmation, self/last
admin and outstanding ownership safeguards remain authoritative. The focused
UI flow verifies rename, self-delete disabled and visible ownership-conflict
feedback. No real account was deleted for acceptance.

The generated OpenAPI catalog includes the existing Friday department, model and
local-voice routes, administrator model evaluation/policy routes, shared execution
capacity controls, and exact EGM packet resources. Discovery preserves each native
board/administrator/company boundary; listing an operation grants no authority.
The mounted-route coverage check includes the capacity and EGM child routers.
