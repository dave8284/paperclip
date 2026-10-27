# Higgsfield

Agent OS uses the official hosted MCP at `https://mcp.higgsfield.ai/mcp`.
Start in company Settings → Connectors → Higgsfield. Browser consent connects
the existing Higgsfield account; encrypted credentials, company grants, action
policies and the native tool gateway own execution and audit.

The MCP uses account plan credits. The separate pay-as-you-go REST API is not
configured by this connector. Setup performs no image or video generation.
Availability of models, credits and actions depends on the authenticated
account, and is established by tool discovery rather than a hard-coded list.

## Public protocol review, 2026-10-27

- Official product source: <https://higgsfield.ai/mcp>.
- Account/API distinction: <https://higgsfield.ai/blog/higgsfield-api>.
- Unauthenticated MCP request returned 401 and a Bearer challenge pointing to
  `https://mcp.higgsfield.ai/.well-known/oauth-protected-resource/mcp`.
- Protected resource is the exact MCP URL; authorization issuer is
  `https://clerk.higgsfield.ai`. Requested scopes are only `openid`, `email`
  and `offline_access`, matching the resource challenge.
- Public authorization-server metadata advertises `/oauth/authorize`,
  `/oauth/token`, `/oauth/register`, `/oauth/token/revoke`, PKCE S256, public
  client authentication and refresh tokens. Agent OS uses its existing DCR
  flow. It does not request other Clerk metadata or organization scopes.
- Redirect acceptance, account tool inventory, token lifetime/rotation and
  account-specific action risks still require authenticated qualification.
  Public probes performed no registration or consent. A subsequent operator-authorized
  connection setup successfully registered the native client and opened consent;
  the user deferred completing sign-in.

## Marketing workflow

Keep briefs, generation attempts, returned job IDs and media outputs on the
owning task. The connection instruction template tells agents to attach
completed outputs as versioned native artifacts and to distinguish generation
from publication. Reuse native routines to iterate against reviewed campaign
results; provider tools remain governed by their discovered action policies.
Do not treat connecting an account as approval for unlimited generation.

## Verification limits

Catalog, branding and permission-review fixtures cover the declared contract.
The native preflight and DCR setup passed. No account consent, authenticated read, generation, refresh, revoke or
reconnect proof has been performed yet. Unknown tools keep the existing
gateway's conservative classification; no provider-specific risk downgrade
is introduced. Run the connection playbook lifecycle after account consent.
