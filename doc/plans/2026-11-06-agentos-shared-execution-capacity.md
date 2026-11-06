# Shared subscription execution capacity — 6 November 2026

Implements the previously open R03 source contract from the requirements
reconciliation. Production policy, connection grouping and live qualification
remain separate from implementation. No actual subscription group or provider
setting was created by this work.

## Contract and ownership

Administration → AI capacity exposes explicit subscription groups. An instance
administrator chooses a provider, active-work limit, conversation reserve,
conversation priority, waiting-warning threshold, and the managed connections
that use the same seat. All numeric choices are required; the form does not
choose a limit from a plan name. The pending owner question determines the
initial operational policy. Limits are operational controls, not provider
entitlement or a measurement of available quota.

The three new tables are private instance administration: groups, explicit
company/connection/grant bindings, and durable heartbeat-run claims. Existing
company-scoped subscription billing identities are unchanged. No provider
account ID, credential hash or raw credential joins companies automatically.
The administrator must retain access to every old and new bound company. Group
names and bindings containing inaccessible companies are omitted from reads.
Each mutation records an instance administration audit event in its transaction.
After configuration/group lock waits, the native administration owner rechecks
the operator's approval and administrator role. SHARE/NOWAIT locks protect those
rows and current non-viewer memberships for every old/new company until commit;
the original request company ceiling is retained. Reads also refresh authority.

Every managed native/legacy heartbeat passes through the capacity wait before
budget admission and provider dispatch. A group row lock serializes claims
across agents, companies, models and controller instances. Reserved conversation
slots remain available to native conversations. Otherwise the queue is FIFO;
optional conversation priority yields to older requests after their warning
threshold. A deadline never cancels work, starts a retry execution or releases
an uncertain running provider. An active wait remains the same heartbeat run.

Subscription admission, including an unbound connection, holds a short shared
configuration fence and the attributed run lock. Binding changes hold the
exclusive fence and reject existing matching work until it is settled. These
transactions never span provider execution. Unbound admission and its verified
cleanup have server-authored native run events; caller context cannot fabricate
settlement. The same cleanup boundary records early failures after account
attribution but before capacity admission. A reusable idle harness does not
consume a slot after the native execution owner verifies the turn and cleanup;
an unknown or retained execution still does.

The wait subscribes before reading, coalesces concurrent wakes, and waits for an
in-flight admission transaction to settle before responding to Stop. One timer
marks the concrete request's warning/aging deadline; later checks require a
committed configuration or settlement notification. Reconciliation runs once
during native startup and while an actual contender waits. It is deliberately
absent from the periodic `resumeQueuedRuns` sweep, so configuration or retained
history does not create capacity polling.

After capacity and budget waits, the prepared managed-runtime owner repeats its
native AI selection checks: responsible-user and account-owner membership,
credential audience, connection health/install, model policy and current default.
It then requires the original grant/connection/provider/method/responsible user,
AI routing configuration and secret epoch/version. Changed authority fails
before provider dispatch; this check does not fetch/copy a new credential,
switch accounts, or enable API billing. The final native dispatch gate still
owns run/task/Stop/budget authority.

Heartbeat releases admitted claims only at its verified execution-cleanup
boundary. Unsettled/native ownership and retained recovery keep their claim.
Startup reconciliation uses existing native stop/release/cleanup evidence;
terminal status or an expired controller lease alone is insufficient. Cancelled
waiters can be released because they never entered provider execution. Company
and agent deletion reject unresolved claims and remove settled claim history
before deleting its native run dependencies.

Company-local execution projections say “Waiting for AI capacity” and explain
that provider work has not started. They read the authoritative claim instead
of trusting caller-supplied context. They expose no other company's work. The
administrator sees active/waiting/delayed counts and explicit unbound connections.

## Delivery and practical limits

- Source includes shared schemas, private persistence, admin API/form, native
  admission/cleanup/startup integration, prepared-authority recheck, task wait
  projection and deletion guards.
- Generated migration `0389_secret_scrambler.sql` also contains the parallel
  reviewed-capability tables. It was not applied to the running instance.
- Host sign-ins without a managed connection and unbound managed connections
  are outside these explicit groups. Binding all connections for the actual
  seat is a necessary activation step, not an inferred credential operation.
- Group changes affect future requests. Existing requests retain their original
  warning deadline; active reservations are never preempted. Changing bindings
  with pending work is rejected. Lowering a limit below active work is rejected.
- Binding changes exclude settled native claim/event receipts in SQL and check
  at most 100 remaining historical executions. More unresolved rows produce an
  explicit conflict rather than holding unrelated dispatch behind an unlimited
  history walk. Historical runs need native stop/cleanup proof or the existing
  cancelled-startup owner's never-dispatched proof. Old failures lacking such
  evidence remain a configuration blocker; terminal status is insufficient.
  This migration-era limitation requires native diagnosis/settlement, not a
  force-release control or a guessed retrospective receipt.
- Admission reads scale with pending work in the selected group, not completed
  history. Each waiter owns a temporary notification subscription. Initial
  configured-but-idle construction performs no database work or timer creation.
- Restart reconciliation intentionally retains a claim when existing native
  evidence cannot prove provider settlement. No administrator “force release”
  bypass is introduced.

## Evidence

- Capacity ordering/lifecycle plus existing execution-projection checks:
  **31 passed; 6 PostgreSQL cases skipped**. The database cases cover real
  cross-company contention, stale/revoked configuration, durable delay and
  restart retention. The embedded-Postgres support probe reports this host
  unsupported, so these cases are not accepted evidence of live concurrency.
  Log: `/private/tmp/agentos-capacity-tests-20261106.log`.
- Real heartbeat facade with a controlled SQL recorder: **1 passed**. Repeated
  idle `resumeQueuedRuns` adds no capacity query; explicit startup reconciliation
  queries pending claims once. Log:
  `/private/tmp/agentos-capacity-idle-20261106.log`.
- Prepared-runtime authority and credential-generation checks: **7 passed**.
  The native selector boundary is controlled; these verify denial propagation,
  exact identity preservation and absence of another credential fetch, not a
  live provider/member revocation. Log:
  `/private/tmp/agentos-capacity-authority-20261106.log`.
- Administrator form plus existing Administration checks: **8 passed**. No
  implicit initial policy, revision-bound saves, cancel, visible delay counts
  and errors are covered. Log: `/private/tmp/agentos-capacity-ui-20261106.log`.
- The strengthened form check loads cached group/connection data, opens editing,
  then rejects a refetch. All data/forms disappear: **4 passed** in
  `/private/tmp/agentos-capacity-boundary-ui-20261106.log`.
- Configuration authority/admission boundary checks: **12 passed** in
  `/private/tmp/agentos-capacity-boundary-r3-20261106.log`. They use actual service
  SQL with controlled results/native evidence and verify query/lock ordering,
  no writes on revoked authority, bounded history, early cleanup receipts and
  cancelled-startup proof delegation. They do not prove PostgreSQL concurrency.
  The additional real unbound-binding case remains skipped alongside the six
  original DB cases: **21 passed, 7 skipped** at the earlier boundary checkpoint
  `/private/tmp/agentos-capacity-boundary-20261106.log`.
- Boundary semantic-check failures are retained: the first exposed a controlled
  transaction fixture typing mismatch; the second exposed a concurrent mandate
  resource-type error. Both were repaired before the final semantic check.
- UI semantic check and token gates passed. Map structure passed after replacing
  an imprecise method/path example with exact GET and POST examples.
- The required `pnpm db:generate` command failed at the tsx CLI's optional IPC
  listener with EPERM before schema generation. Its same numbering/safety,
  compile, Drizzle generation and prune stages passed with scripts run through
  `node --import tsx`. No sandbox permission or network access was bypassed.
  Original failure log:
  `/private/tmp/agentos-capacity-capability-migration-20261106.log`.

Before closing R03: apply the reviewed migration through normal activation,
bind the actual owner-selected subscription connections, run the skipped real
database cases in a supported environment, and demonstrate two company/agent
contenders plus Friday conversation, Stop, revoked access during waiting and
restart. Preserve the same native work intent and verify the loaded backend.
This source checkpoint does not claim that operating demonstration.
