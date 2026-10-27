# Model Intelligence

Independent local model-profile router, storage and authenticated HTTP API. Node 22.16+; no paid model calls or provider credentials. Can be packaged with `npm pack` and run separately with `MODEL_INTELLIGENCE_TOKEN` (32+ characters), `MODEL_INTELLIGENCE_DB` and `npm start`.

The host supplies only authorized, available subscription candidates. Selection remains pinned for an existing task. Unqualified and complex work retain the configured baseline. For routine work, a replacement needs at least five reviewed outcomes, a conservative quality score, bounded iterations and at least 15% lower observed median latency. API prices are not subscription cost evidence. Human/check evaluations retain their source and evidence; process exit alone never counts as quality. Prompt/context fingerprints allow analysis without storing private content.

Embedded API: `createModelIntelligence(path)` → `select`, `evaluate`, `policy`, `analytics`, `close`. HTTP equivalents: POST `/v1/select`, `/v1/evaluations`, `/v1/policy`; GET `/v1/analytics?namespace=...`. Require `Authorization: Bearer ...`. HTTP token is an operator credential for this single-instance service; multi-tenant hosting needs an identity gateway with namespace authorization. Agent OS enforces native company access at its integration boundary.

Receipt and evaluation IDs are idempotent; mismatched reuse fails. Rollback blocks a profile for future selections and refuses silent substitution of an active pin. SQLite owns durable receipts, evaluations and policy history. The service neither changes agent instructions nor executes tasks. The caller must revalidate admission, account capacity and permissions immediately before execution.

## Agent OS host

Set `AGENTOS_MODEL_INTELLIGENCE_DB` to an absolute private SQLite file path in the server environment. Agent OS creates its parent directory and embeds this package without a network round trip. Leave it unset to retain existing configured-model behavior without learning. The standalone HTTP process is optional; do not expose its operator token to browser code.

The native run saves the selection request before calling the product, revalidates retained candidates on retries, and carries the request and receipt through lifecycle checkpoints. Additional observed models do not change a queued request. New retry runs receive new receipts while retaining their task pin. Native subscription entitlement, permissions, capacity and execution remain authoritative.
