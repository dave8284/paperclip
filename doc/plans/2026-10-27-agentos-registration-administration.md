# Agent OS registration and administration delivery

This records the human account and admin foundation of the [end-to-end plan](2026-10-27-agentos-end-to-end-execution.md). The subsequent production UI correction is recorded in that plan's baseline checkpoint. Neither delivery marks the independent learning service, browser/audio acceptance or production autonomous workflows complete.

## User journey

`/` is the public landing page and sends approved local/authenticated users to `/workspace`. `/welcome` always displays the landing page. The signup action opens `/auth?mode=sign_up`; Google is offered when credentials are configured in authenticated mode. Successful authentication establishes identity, while `/api/registration` determines approval state.

Public registrations are pending by default. Clients cannot supply approval or email-verification fields. `/pending-approval` provides status, refresh and sign-out. An approval does not give a user access to every company: existing company memberships remain the authority boundary. Users without memberships are directed to obtain company access.

`/admin` has Overview, Pending approval, Users, Add people, Model Intelligence and Audit trail. Users can be searched and paginated, approved, rejected, suspended, renamed, promoted/demoted, assigned company access, signed out of sessions/API keys or deleted. The native company access service protects company ownership and administrator assignments. Deleting an owned portfolio is blocked until ownership transfers; the account deletion flow preserves business and audit history.

Adding a person records a seven-day preapproval for a verified email identity. It does not create a password or send an email. Google verifies ownership; ordinary email/password registrations still require review. Implicit Google linking to unverified existing password accounts retains Better Auth's secure default; an unverified password account must not acquire a Google identity automatically.

## Enforcement and audit

- Migration `0384_nosy_chronomancer` adds account approval status/revision, preapprovals and instance administrative events. Existing and trusted provisioned users keep approved status. Public Better Auth creation explicitly overrides that default to pending.
- Approval checks apply on the native API router, including internal MCP dispatch. Authentication, registration state, health and the existing first-owner challenge remain available. The existing private bootstrap claim is still restricted to its configured private deployment; public first-owner claim still requires the challenge.
- Board key/MCP authority resolution requires an approved identity. Responsible-user membership resolution also requires approval. WebSocket upgrades and each delivery recheck approval; a removed/expired session is closed before the next delivery.
- Suspension deletes browser sessions and revokes board API keys. This revokes that human's interactive authority; company-owned workers and their separate mandates remain under native lifecycle controls.
- Account/role mutations serialize on the native role table, revalidate the administrator, lock the affected account and enforce its expected revision. They cannot disable the caller's own administration or remove the last approved administrator. Legacy role endpoints use the same owner.
- Administrative audit records commit atomically with account changes and survive identity deletion. Account records are not returned with credentials. Operator-managed `instance.access` visibility is respected for reads and writes.

## Google setup

The dedicated Google Cloud project is `agentos-dave8284`, display name **AgentOS**, created through `gcloud` at the owner's instruction. No existing project was repurposed. Its OAuth web client and production domain have not yet been configured.

Open the [AgentOS Google Auth Platform](https://console.cloud.google.com/auth/overview?project=agentos-dave8284), configure the external application's branding/audience and create a **Web application** OAuth client. Register `http://localhost:3100/api/auth/callback/google` for local testing and `https://YOUR_DOMAIN/api/auth/callback/google` for the eventual deployment. Google requires registered redirect URIs to match; follow the [official web-server OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server).

Supply these settings through runtime secret configuration, never source control or chat:

```dotenv
PAPERCLIP_GOOGLE_CLIENT_ID=<Google web client ID>
PAPERCLIP_GOOGLE_CLIENT_SECRET=<Google web client secret>
PAPERCLIP_DEPLOYMENT_MODE=authenticated
PAPERCLIP_DEPLOYMENT_EXPOSURE=public
PAPERCLIP_AUTH_BASE_URL_MODE=explicit
PAPERCLIP_AUTH_PUBLIC_BASE_URL=https://YOUR_DOMAIN
PAPERCLIP_AUTH_DISABLE_SIGN_UP=false
BETTER_AUTH_SECRET=<stable randomly generated deployment secret>
```

For local testing use private exposure and the exact localhost origin. Provision/claim the owner before making a deployment public. The current development instance remains loopback-only in `local_trusted` mode; local admin access is not proof of Google OAuth or internet-facing approval enforcement. Restart after changing provider credentials. Admin Overview reports credential presence and the callback path, never secret values.

The connected browser tools currently fail before a browser session can start (`missing field sandboxPolicy`). Google Console interaction and visual/audio acceptance are blocked by this integration failure. CLI access works. The owner explicitly chose to finish the local application and connect Google later. No further Google setup or production deployment is required for this local delivery.

## Model Intelligence boundary

The admin tab reads real native cost receipts, decision-model invocations and agent execution states for the last 30 days. Model/billing groups are capped at 100. It displays unpriced receipts, subscription-included usage, recorded usage cost and latency. Seat subscription fees are not included in per-request usage cost. Execution success is not verified task quality, and receipt counts are not task iterations.

Learning datasets, prompt/context experiments, proven quality outcomes, policy promotion/canary/rollback and automatic policy adoption still require P3/P4/P7/P9 of the main plan. Their current state is **not connected**, with unknown counts represented as null, not fabricated zeroes or improvements. The independent product remains the owner of those states; the admin read projection does not create a second learning engine in Paperclip.

## Verification and rollout

Integration tests use a migrated real PostgreSQL database. They exercise signup-field injection, pending API admission, review/revision conflicts, verified/expired/revoked preapproval, session/key revocation, real open WebSocket revocation, deletion, first-owner claim, concurrent administrator changes, audit-write rollback and model accounting. DOM tests cover approval navigation, access denial, waiting state and unavailable learning evidence. Existing auth/access/realtime tests are also run.

The local database was backed up before applying the migration using the native backup CLI. The running instance was restarted through its native supervisor; the migration applied and live admin overview and analytics reads returned successfully. Backups and credential files remain outside the repository.

Rollback is a code rollback with additive columns/tables retained; do not drop audit or user data to roll back UI changes. An older binary would not enforce approval status, so **do not deploy an older server publicly with pending/suspended users** without closing registration and preserving equivalent access enforcement. Restoring a database backup is a separate recovery operation with explicit data-loss implications.

Release checks on 27 October 2026:

- Full workspace `pnpm build` and `pnpm typecheck` passed with the workspace's Node and Rust toolchains.
- The final focused regression run passed **137 tests in 13 files**, covering registration/admin, credential signup, board/bootstrap claims, OpenAPI routing, live-event access and the related UI/navigation. A separate 32-test UI/session run also passed; those counts overlap.
- `pnpm check:token-gates` and `git diff --check` passed. Migration snapshot validation passed as part of the workspace checks.
- The broad `pnpm test:run` attempt was stopped after two heartbeat serialization cases failed in `heartbeat-stale-queue-invalidation.test.ts`. All seven cases matching `serializes issue claims without serializing unrelated work` then passed in isolation. This does not establish why the broader run failed or substitute for a completed full-suite run.
- Live HTTP checks returned the landing, admin, authentication and approval pages, and real administration/model analytics data. The local database reports no pending migrations.
- Browser automation could not start because of the integration error above. Responsive layout is implemented, but real-browser/mobile visual and voice acceptance has not been verified in this delivery.

Production browser sign-in, completion of the broad regression suite, mobile visual checks, learning-service connection and cloud deployment remain separate acceptance gates. Google connection is explicitly deferred by the owner.
