# Shared employee capability adoption — next implementation slice

Status: source investigation and implementation design, not an implemented capability.

Requirements O06/O05 distinguish shared reusable methods from private company knowledge and from automatic model-routing policy improvements. The smallest complete slice is manual publication of a reviewed Markdown skill release, followed by an independent company decision to adopt, refuse or roll back. Publication alone must never change another company's employee configuration.

## Existing native owners

- `packages/db/src/schema/company_skills.ts` and `server/src/services/company-skills.ts` own immutable company skill versions, snapshots, import/materialization and test-run records.
- `server/src/routes/agents.ts` owns current authorized skill selection/sync and configuration revisions. Extract reusable persistence under this owner rather than calling HTTP routes internally.
- `server/src/services/heartbeat/execution-configuration.ts` captures the exact skill versions for a run; `server/src/services/skill-version-retention.ts` protects selected and in-flight versions.
- Shared workforce records own the portfolio employee identity and company-local assignment. They currently have no release/adoption link.
- Current agent instructions are managed files/content tokens. Legacy instruction revision tables are upgrade inputs and must not become a new writing path.

## Concrete implementation

1. Add a narrow capability owner service, shared contract and additive migration. Keep immutable portfolio/employee release metadata, reviewed Markdown bytes/hash, and append-only company adoption decisions. Existing native permission grants remain the only authority store.
2. A portfolio owner publishes deliberately sanitized `SKILL.md` content, linked to an immutable native source version and reviewed evidence. Recipients receive the published content and sanitized evaluation summary; originating task transcripts, private evidence references and company knowledge remain private. The first slice excludes recursive repository copies, executable scripts and remote fetches.
3. Target-company admission checks the active shared assignment, the native company skill policy and target-agent configuration permission. Preserve the actual actor, responsible user and authorizing user. A shared identity grants no company access and must not substitute another company's agent or board identity.
4. Extend the company-skill owner with a transactional import primitive and extract authorized skill-selection persistence from its current route. Import the company-local immutable skill/version, select it and append adoption/audit receipts atomically under expected revisions and idempotency. Recording adoption metadata alone is insufficient.
5. Refusal appends a decision without changing configuration. Rollback selects an earlier imported immutable version and appends a new receipt. Neither operation changes another company's assignment or an in-flight run snapshot.
6. Provide release preview/history and adoption/refusal/rollback controls in Workforce, and matching native API discovery/maps.

## Gates discovered in source

- Version pins currently depend on `enableBetaSkills`. Adoption must fail closed when exact future-run version selection cannot be guaranteed, or extend the native selection owner to establish that guarantee. Never silently fall back to latest.
- A skill-test `succeeded` status records execution completion. Publication must retain separate reviewed acceptance evidence and must not label process completion as proven quality.
- Native forks are company-local; a portfolio release needs explicit sanitized publication and a target-company import, not a cross-company snapshot pointer.
- Any new authority/adoption transaction needs current membership/grant checks and concurrency/revocation review. Existing company-retirement tests do not certify this operation.

## Acceptance before closing O06

Two companies choose different releases of the same employee capability; refusal leaves selection unchanged; rollback restores the exact previous bytes; revoked/foreign actors fail; publication never exposes private source evidence; duplicate and stale requests are safe; audit failure rolls back import/selection; active runs retain their captured versions. Complete these through the real native API and runtime in a capable environment. Database/listener restrictions in the present session prevent claiming these results in advance.
