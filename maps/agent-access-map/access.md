# Login, invitations, and access — agent access

Product map: [Login, invitations, and access](../feature-map/access.md).

Feature ID: `access`.

Review date: 2026-10-12. Source commit: `58e16dbddfc9c8d0cf60867f9d9847f0feda055b`.
Native REST transport reconciled in this change; see the
[shared transport contract](README.md#native-rest-transport).

This is a source-reviewed baseline of representative operations and known gaps.
Each capability needs operation-level review before its entire scope can be
qualified. No live agent execution is claimed. Follow the [map contract](../README.md)
for format, permission checks, evidence and maintenance.

## `login`

Capability ID: `access/login`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/auth/get-session`.
- `POST /api/bootstrap/claim`.
- `GET /api/registration/options`.
- `POST /api/auth/sign-in/social` (configured Google provider).

Agent access: `restricted` — Agent authenticates with its own issued bearer; board login
uses human/client auth.

Policy: Company access plus action-specific grants; instance administration requires a
board administrator.

Evidence: `source-only` — [implementation](../../server/src/routes/access.ts#L3018) at
the reviewed commit above.

Verification: `not-run` — assert the documented agent denial with an owned test fixture;
verify any listed agent request/result path separately. A delegated operation needs its
own policy and access review.

Gaps: An agent identity is not a board login or board claim; explicit delegation is a
product-policy decision.

The AgentOS landing copy and opt-in decorative pointer motion add no endpoint,
agent grant, microphone access or execution path. Account links and registration
redirects remain native. The workspace orb still uses its existing voice/run
states. DOM and animation-lifecycle tests are local presentation evidence;
current app screenshots, real browser rendering and physical voice input/output
remain unqualified.

Google-only deployment policy (2026-11-04):
`PAPERCLIP_AUTH_PASSWORD_ENABLED=false` disables password login/registration and
password reset/change/verification paths in native Better Auth. Public options
report separate password sign-in/sign-up flags; AgentOS's UI exposes only Google,
even when old options still advertise password authentication. It waits for fresh
options before enabling Google entry. Waitlist celebration and explicit approval
refresh add no approval endpoint or background polling. Google sign-in retains
native approval, signup policy, session handling and the owner-claim ceremony. It adds no agent authority and
does not delete existing accounts or credentials. See
[configuration](../../server/src/auth/better-auth.ts),
[public options](../../server/src/routes/agentos-administration.ts), and
[handler tests](../../server/src/__tests__/password-auth-policy.test.ts).
Thirty-two auth configuration/handler checks and 36 UI/API checks pass locally;
Google's real redirect/consent/session journey remains unverified. The local
Google OAuth client must register the exact callback before that journey works.

Configured owner policy (2026-11-04): the operator-only
`PAPERCLIP_AUTH_GOOGLE_OWNER_EMAIL` selects one verified Google identity. A fresh
Better Auth-verified issuer/subject/email is bound to its persisted user/account
before approval, instance-admin assignment and native ownership transfer commit
with the audit. This adds no agent endpoint or email-only promotion path.
An existing self native-claim audit allows the still-approved admin to complete
legacy local-board conversation/responsibility transfer only in locked current
owner memberships. Busy membership rows fail before mutation, chat collisions
roll back, and a completion audit prevents replay. Company membership/grant
revocations, later suspension/rejection and demotion remain authoritative.
See [auth binding](../../server/src/auth/configured-google-owner.ts) and
[transaction](../../server/src/services/configured-google-owner.ts). Real Google
acceptance and PostgreSQL locks/persistence remain unqualified; local lifecycle
and controlled SQL tests are not live evidence.

Bootstrap ownership correction (2026-11-04): the native human claim transaction
transfers only explicit `local-board` operational responsibility (company defaults,
visible unfinished tasks and current routines), appends routine revisions, archives
active bootstrap user memberships and seeds claimant owner grants atomically with
the existing role/portfolio transfer. Other owners, prior revisions/runs, creators
and audit history are retained. Agent API key responsibility is retained; this
ceremony does not reissue a credential or grant it the claimant's identity.
Local-board conversation ownership transfers without changing thread IDs, session
generation, messages or files. The native conversation uniqueness constraint also
covers hidden threads: an existing claimant chat for the same company/agent aborts
the entire claim with HTTP 409 and preserves both histories.
Evidence is source-only in [claim](../../server/src/board-claim.ts),
[routine service](../../server/src/services/routines.ts) and
[regression cases](../../server/src/__tests__/board-claim.test.ts).
Verification is blocked by the previously observed sandbox PostgreSQL listener
denial (`listen EPERM`); the new regression cases have not run.

## `invitations`

Capability ID: `access/invitations`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/companies/{companyId}/invites`.
- `POST /api/invites/{token}/accept`.

Agent access: `partial` — REST / native `call_api` invite creation with the invite
permission; CLI access. Human acceptance and agent onboarding have distinct policies.

Policy: Company access plus action-specific grants; instance administration requires a
board administrator.

Evidence: `source-only` — [implementation](../../server/src/routes/access.ts#L3018) at
the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Invite creation has an agent permission branch. Human joining and agent onboarding
are different operations.

## `membership`

Capability ID: `access/membership`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/companies/{companyId}/members`.
- `PATCH /api/companies/{companyId}/members/{memberId}/permissions`.

Agent access: `partial` — REST with the specific company permission; native fallback for
unrestricted operations.

Policy: Company access plus action-specific grants; instance administration requires a
board administrator.

Evidence: `source-only` — [implementation](../../server/src/routes/access.ts#L3018) at
the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Company membership APIs include agent grants; instance-admin user operations stay
board-only.

## `resources`

Capability ID: `access/resources`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/issues/{id}`.
- `GET /api/projects/{id}`.

Agent access: `available` — REST or scoped task/project tools.

Policy: Company access plus action-specific grants; instance administration requires a
board administrator.

Evidence: `source-only` — [implementation](../../server/src/routes/access.ts#L3018) at
the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, company or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Company/resource authorization is implemented; a negative test must cover private
resources and another company.

## `cli-auth`

Capability ID: `access/cli-auth`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/cli-auth/challenges`.
- `POST /api/cli-auth/revoke-current`.

Agent access: `restricted` — Board CLI authorization; agents use issued agent
credentials.

Policy: Company access plus action-specific grants; instance administration requires a
board administrator.

Evidence: `source-only` — [implementation](../../server/src/routes/access.ts#L3018) at
the reviewed commit above.

Verification: `not-run` — assert the documented agent denial with an owned test fixture;
verify any listed agent request/result path separately. A delegated operation needs its
own policy and access review.

Gaps: CLI board login/revocation cannot be counted as agent self-authentication.


### AgentOS account controls — 2026-11-04

Admin → Users exposes explicit Edit/Delete actions instead of requiring a name
click. Management focuses and scrolls into view. It reuses native revisioned
rename, approval, role, membership and delete endpoints; confirmation, self/last
admin and outstanding ownership safeguards remain authoritative. The focused
UI flow verifies rename, self-delete disabled and visible ownership-conflict
feedback. No real account was deleted for acceptance.
