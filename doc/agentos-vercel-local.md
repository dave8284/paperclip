# Agent OS: Vercel interface and local backend

**Current status: local only, at `http://localhost:3100`.** After reviewing cloud costs, the owner chose to prove the concept locally. The public tunnel/gateway are stopped and removed from login startup; their plists are retained under `../.runtime/tunnel/disabled/`. The native backend is loopback-only in `local_trusted`/private mode. No Google Cloud billing or compute was enabled. The Vercel project/static deployment is retained for later and cannot reach the local workspace.

The remainder records the deferred deployment work and its limits. It is not a completed remote-dashboard acceptance claim.

## Deferred topology

`https://agent-os-ivory-mu.vercel.app` serves the compiled React interface under Vercel project `agent-os`, account `dave8284`, team `sids-projects-4c176c0e`.

Requests under `/api/` and `/_plugins/` are rewritten to an HTTPS ngrok endpoint, then the loopback gateway on `127.0.0.1:3102`, then Agent OS on `127.0.0.1:3100`. Cookies, redirects, request bodies and streams retain the browser's Vercel origin. Native authentication, user approval, company membership and audit remain authoritative. The gateway does not authenticate users or grant company access.

The gateway overwrites `x-agentos-public-tunnel` on every HTTP request and WebSocket upgrade. The native HTTP listener rejects marked traffic unless public authenticated mode is active, and refuses development source/control paths. This also guards a later accidental restart into local-trusted mode. Do not point ngrok straight at port 3100 or remove the gateway marker. Direct local development requests are unchanged.

The database uses the same PostgreSQL 18 data directory as before. Public authenticated mode requires an explicit PostgreSQL connection, so PostgreSQL is now separately supervised on the Mac and the private environment contains its loopback `DATABASE_URL`. The database was not copied to Vercel or Google Cloud. The bundled PostgreSQL executable is signed by EnterpriseDB Corporation; that is the publisher name macOS displays for its background item, not an EnterpriseDB subscription.

## Local services

The current Mac has user LaunchAgents under `~/Library/LaunchAgents`:

| Label | Responsibility |
| --- | --- |
| `com.agentos.postgres` | Existing database, TCP loopback port 54329 |
| `com.agentos.backend` | Native Agent OS server and supervisor |
| `com.agentos.tunnel.gateway` | Loopback HTTP/WebSocket gateway, port 3102 |
| `com.agentos.tunnel.ngrok` | HTTPS tunnel and event-driven Vercel route refresh |

Only PostgreSQL and the local backend currently start at user login. The gateway and tunnel are disabled. Services do not prevent sleep. When resumed in future, a public workspace would need this Mac awake, logged in, online and running the services. Static pages remain available when the Mac is offline; requests to the workspace fail until it returns. Background work also stops while the host sleeps. This is not an always-on production guarantee.

The existing ngrok account does not permit a fixed custom URL or traffic-policy header rewriting on its free plan. `scripts/maintain-agentos-tunnel.mjs` responds to a new tunnel-connection event by redeploying the **previously staged static release**, changing only its upstream address. It checks the approved Vercel account/project before doing so. It never builds or publishes later source edits automatically. There is no idle polling. Failed routing updates get three bounded attempts; expired CLI authentication needs reconnection. New tunnel URLs can cause a short interruption during the Vercel redeploy. Provider free-plan traffic/deployment limits still apply.

Logs are private files under `../.runtime/tunnel/`. The backend log contains the one-time ownership-claim URL; do not publish it. Credentials remain in `../.runtime/instances/default/.env`, ngrok's own configuration and Vercel's CLI credential store. Local `.vercel` metadata and output are ignored by Git.

The following describes how to stop public access without deleting data when the tunnel is installed. It has already been stopped for the current local-only decision:

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.agentos.tunnel.ngrok.plist
```

Do not reinstall the disabled tunnel automatically. Resuming public access requires revisiting this deployment decision, restoring authenticated mode, completing ownership/sign-in and qualifying WebSocket forwarding.

Stop the backend before stopping PostgreSQL. Removing a LaunchAgent affects automatic startup; do not delete the database directory to stop a service.

## Google and ownership

Google Cloud project: `agentos-dave8284`. Create a **Web application** OAuth client with:

| Setting | Value |
| --- | --- |
| JavaScript origin | `https://agent-os-ivory-mu.vercel.app` |
| Redirect URI | `https://agent-os-ivory-mu.vercel.app/api/auth/callback/google` |
| Optional local origin | `http://localhost:3100` |
| Optional local redirect | `http://localhost:3100/api/auth/callback/google` |

Import the downloaded JSON with `scripts/configure-agentos-google.mjs CLIENT_JSON PRIVATE_ENV_FILE ORIGIN`. Never commit the client JSON or paste its secret into chat. Restart the backend after importing. The Google secret belongs on the local backend, not in a `VITE_*` variable or the Vercel static bundle.

The first real owner must sign in and follow the private native board-claim link. That ceremony replaces the local-board administrator, transfers its company/portfolio ownership and approves the user. All other public registrations remain pending until approved in `/admin`. Possessing a Google identity alone does not grant company access.

## Explicit releases

Build and test the intended source revision first. Use `node scripts/stage-agentos-vercel.mjs HTTPS_TUNNEL_ORIGIN` to copy only `ui/dist` to `.vercel/output/static` and generate the routing manifest, then `vercel deploy --prebuilt --prod --scope sids-projects-4c176c0e`. Coordinate explicit deployments with the tunnel service so two deploys do not race over the staged output. The private `.vercel/release-owner.json` records `username`, `scope`, `orgId` and `projectId` for reconnection checks.

The supported configuration is the stable production alias. Preview deployment hosts are not Google callbacks or trusted browser origins. The upstream source retains its existing internal names and compatibility routes.

## Evidence and remaining acceptance

The public landing/auth routes returned HTML successfully. Through the Vercel alias, health returned authenticated/public mode, anonymous company reads were denied, and development restart controls returned 404. The same tunnel marker returned 503 when the backend was local-trusted. Gateway tests exercised streaming bodies, secure cookies, redirects, live duplex upgrades and an offline backend; native-listener tests covered both HTTP and upgrade rejection before downstream handlers.

Google OAuth and the owner's signed-in dashboard still require the downloaded client and the owner's sign-in/claim. The direct backend, gateway and ngrok WebSocket admission reached native authorization; the Vercel external rewrite returned an API 404 instead. A relay experiment did not establish a working public WebSocket connection before the owner switched to local-only operation; it was not retained in source. This must be fixed and proven before resuming a remote dashboard. In-app browser automation currently fails before connecting, so visual/mobile/audio acceptance is not established by these HTTP and component checks. The broad repository test suite has a previously recorded incomplete run; targeted checks do not replace it.
