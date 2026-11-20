# Jeeves — environment reference

Every configuration variable the code reads, in one place. Companion to
[`deploy.md`](./deploy.md) (Vercel + Neon) and [`deploy-podman.md`](./deploy-podman.md)
(self-hosted). `tests/docs/env-reference.test.ts` fails when source reads a
variable this page does not list. `.env.example` (demo / local) and
`deploy/podman/env.example` (Podman) are templates, not the full list.

Two deployment shapes read the same code:

- **Demo** — `JEEVES_MODE=demo`: public playground plus the real-request door.
- **Production** — `JEEVES_MODE` unset (or anything but `demo`): a single-tenant
  install. Every demo door answers 404. Customer sign-in is not built yet.

"Build" means the value is inlined when `next build` runs and a runtime change
has no effect. Secrets are marked; never log or commit them.

## 1. Mode

| Variable | Demo | Production | When | Secret | Default | Effect | Source |
|---|---|---|---|---|---|---|---|
| `JEEVES_MODE` | `demo` | unset | runtime | no | production | Exactly `demo` selects demo mode, anything else is production. Also needs `JEEVES_DEMO_ENABLED` not `0`. | `lib/config/deployment-mode.ts` |
| `JEEVES_DEMO_ENABLED` | optional | `0` | build | no | `1` | `0` compiles the demo out: `JEEVES_MODE=demo` at runtime then has no effect. Build a production image with `0`. | `next.config.ts`, `lib/config/deployment-mode.ts` |
| `NODE_ENV` | `production` when built | `production` | build/run | no | set by Next | Adds `Secure` to the workspace cookie; `scripts/seed.ts` refuses to run under `production` without `ALLOW_SEED=1`. | `app/api/session/route.ts`, `scripts/seed.ts` |
| `VERCEL` | set by Vercel | set by Vercel | runtime | no | unset | Only used by the boot check: off Vercel, an unset `JEEVES_TRUSTED_PROXY_HOPS` logs a warning in demo. | `lib/config/boot-checks.ts` |
| `VERCEL_ENV` | set by Vercel | set by Vercel | build | no | unset | Only used by `next.config.ts`: `production` on a Vercel build with `JEEVES_MODE=demo` makes `NEXT_PUBLIC_PRIVACY_CONTACT` mandatory. | `lib/marketing/contact.ts` |

## 2. Database

| Variable | Demo | Production | When | Secret | Default | Effect | Source |
|---|---|---|---|---|---|---|---|
| `DATABASE_URL` | recommended | **required** | runtime | yes | none | Postgres connection string. Wins over `POSTGRES_URL` when nonblank. With neither, the app opens the local PGlite store (demo/dev only: production refuses to boot). Production: a database on another host must be reached with verified TLS (see "Database TLS in production" below), or the boot is refused. | `lib/db/runtime-config.ts`, `lib/db/client.ts`, `lib/db/tls-posture.ts` |
| `POSTGRES_URL` | alias | alias | runtime | yes | none | Vercel integration alias, used only when `DATABASE_URL` is blank. | `lib/db/runtime-config.ts` |
| `DATABASE_MIGRATION_URL` | optional | optional | runtime | yes | the runtime URL | Direct connection for `npm run db:migrate`. Required for Supabase on port 6543 (transaction pooling cannot migrate). | `lib/db/migrate.ts`, `scripts/migrate.ts`, `lib/db/connection-config.ts` |
| `DATABASE_SSL_CA` | optional | optional | runtime | no | none | PEM CA for node-postgres. Verification stays on. Refused if the URL disables TLS or sets `ssl`, `sslcert`, `sslkey`, `sslrootcert`, `sslnegotiation` or `uselibpqcompat`. Supabase hosts always use verified TLS. Satisfies the production TLS rule for any node-postgres host. | `lib/db/connection-config.ts`, `lib/db/client.ts` |
| `DATABASE_POOL_MAX` | optional | optional | runtime | no | the driver's 10 | Largest number of connections one app instance opens through node-postgres. Not used for Neon hosts (own driver) or Supabase hosts (always one connection). | `lib/db/connection-config.ts` |
| `DATABASE_STATEMENT_TIMEOUT_MS` | optional | optional | runtime | no | `60000` | Server-side limit for one statement, in milliseconds. node-postgres sends it as a startup parameter. `0` turns it off and sends nothing: use that behind a pooler that refuses startup parameters it does not track (PgBouncer without `ignore_startup_parameters`) and set the limit on the database role instead. Not sent to Neon or Supabase hosts. | `lib/db/connection-config.ts` |
| `DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS` | optional | optional | runtime | no | `60000` | The same for a transaction left idle. `0` turns it off. Not sent to Neon or Supabase hosts. | `lib/db/connection-config.ts` |
| `DATABASE_MIGRATION_LOCK_TIMEOUT_MS` | optional | optional | runtime | no | `10000` | How long `npm run db:migrate` waits for a lock before it fails and can be retried, in milliseconds. `0` turns it off. Migrations have no statement timeout. Not sent to Neon or Supabase hosts. | `lib/db/connection-config.ts`, `lib/db/migrate.ts` |
| `JEEVES_DB_DRIVER` | optional | optional | runtime | no | by host | `neon` or `pg` forces the driver. By default `*.neon.tech` uses the Neon serverless driver, anything else node-postgres. | `lib/db/driver-select.ts` |
| `JEEVES_PGLITE_DIR` | optional | unused | runtime | no | `./.pglite` | Directory of the local PGlite store when no URL is set. | `lib/db/client.ts` |
| `DATA_PROVIDER` | optional | must not be `mock` | runtime | no | `db` if a URL is set, else `mock` | `mock` serves fixture data (read-only preview); `db` reads the database. Production refuses `mock`. | `lib/data/provider-mode.ts`, `lib/config/deployment-mode.ts` |
| `ALLOW_SEED` | n/a | n/a | runtime | no | unset | `1` lets `npm run db:seed` / reset run with `NODE_ENV=production`. The seed is destructive. | `scripts/seed.ts`, `scripts/reset-demo.ts` |
| `ALLOW_DISCARD_PUBLIC_REQUESTS` | n/a | n/a | runtime | no | unset | Must equal the number of initiatives in `public-` workspaces for `db:seed` or `reset:demo` to proceed; otherwise the run is refused. | `scripts/seed.ts` |
| `JEEVES_DB_ALLOW_UNVERIFIED` | unused | optional: `same-host` only | runtime | no | unset | Production only. `same-host` allows a database on another host name without verified TLS (plaintext or unverified), for a database container on this host's private network (the Podman stacks). Blank or unset: no opt-out. Any other value fails boot. Ignored in demo. | `lib/config/deployment-mode.ts` |
| `PGSSLMODE` | optional | optional | runtime | no | unset (plaintext) | Read by node-postgres when `DATABASE_URL` has no TLS option and `DATABASE_SSL_CA` is unset (not for Supabase hosts): `disable` means plaintext; `prefer`, `require`, `verify-ca` and `verify-full` mean verified TLS; `no-verify` means unverified. The production boot check reads it the same way. | `lib/db/tls-posture.ts` (read by `pg`) |
| `PGSSLNEGOTIATION` | optional | optional | runtime | no | unset | Read by node-postgres when the URL has no `sslnegotiation`: `postgres` or `direct` (`direct` needs TLS). Any other value stops node-postgres from connecting, and the production boot check refuses it for a node-postgres database on another host. | `lib/db/tls-posture.ts` (read by `pg`) |
| `NODE_TLS_REJECT_UNAUTHORIZED` | should not be `0` | must not be `0` | runtime | no | unset | Node.js setting. `0` turns certificate verification off for every TLS connection that does not set it explicitly, including the Neon driver and node-postgres without `DATABASE_SSL_CA`. Production refuses it for a database on another host unless the host is Supabase or `DATABASE_SSL_CA` is set, or `JEEVES_DB_ALLOW_UNVERIFIED=same-host`. | `lib/db/tls-posture.ts` |

### Database TLS in production

Production refuses to boot when the database is on another host and the
connection would not be TLS with certificate verification, judged by what the
driver will actually do, not by what the URL looks like.

- Verified: the Neon driver (always `wss`); Supabase hosts; `DATABASE_SSL_CA`;
  `sslmode=verify-full` (recommended), and `require`, `prefer`, `verify-ca` and
  `allow`, which node-postgres 8 verifies exactly like `verify-full`; `ssl=true`
  or `1`; `sslrootcert`; `PGSSLMODE=require` or `verify-full` with no URL option.
- Not verified: no option at all, `sslmode=disable`, `ssl=0`, `sslmode=no-verify`
  or `ssl=no-verify`, `uselibpqcompat=true` with `sslmode=disable`, `prefer`,
  `require` or `verify-ca`, `PGSSLMODE=no-verify`, and
  `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- Loopback (`localhost`, `127.0.0.0/8` written in full, `[::1]`, a unix socket)
  is exempt.
- For Amazon RDS: set `DATABASE_SSL_CA` to the RDS bundle, or `NODE_EXTRA_CA_CERTS`
  to its path, together with `sslmode=verify-full`.
- The refusal names the problem and both ways out (configure TLS, or set
  `JEEVES_DB_ALLOW_UNVERIFIED=same-host`) and never prints the URL.
- Only the server boot is checked. `npm run db:migrate`, `npm run db:seed` and
  `DATABASE_MIGRATION_URL` are not, and must use the same verified settings
  (`sslmode=verify-full` or `DATABASE_SSL_CA`).

## 3. Identity and sessions

| Variable | Demo | Production | When | Secret | Default | Effect | Source |
|---|---|---|---|---|---|---|---|
| `JEEVES_COOKIE_SECRET` | recommended | **required, 32+ characters** | runtime | yes | none | Signs the browser workspace cookie (`openssl rand -hex 32`). Demo with it blank falls back to a key derived from `DEMO_PASSCODE`; production does not. | `lib/security/workspace-cookie.ts`, `lib/config/deployment-mode.ts` |
| `DEMO_PASSCODE` | deprecated | ignored | runtime | yes | none | There is no passcode gate. Only the legacy seed for the cookie key when `JEEVES_COOKIE_SECRET` is blank, in demo. | `lib/security/workspace-cookie.ts` |
| `APP_BASE_URL` | unused | **required** | runtime | no | none | Absolute `https` URL of this install, no credentials. Production metadata and canonical links. | `lib/config/site-metadata.ts`, `lib/config/deployment-mode.ts` |
| `JEEVES_TENANT_ID` | unused | **required** | runtime | no | none | Identifier of the organisation this install serves. | `lib/config/deployment-mode.ts` |

## 4. Network

| Variable | Demo | Production | When | Secret | Default | Effect | Source |
|---|---|---|---|---|---|---|---|
| `JEEVES_TRUSTED_PROXY_HOPS` | warns if unset off Vercel; malformed fails boot | **required**: `none` or a non-negative integer | runtime | no | unset (read as 0) | Number of reverse proxies in front that *append* to `X-Forwarded-For`. Rate limits (sessions, mutations, operator-token attempts) key on the client address this selects. `0`: the platform overwrites the header, leftmost entry is the client (Vercel). `N >= 1`: the Nth entry from the right (AWS ALB `1`, CloudFront then ALB `2`). A chain shorter than `N` shares one bucket. `none`: nothing in front of the app, the header is ignored and every caller shares one bucket. | `lib/services/route-guard.ts`, `lib/config/deployment-mode.ts`, `lib/config/boot-checks.ts` |
| `PORT` | optional | optional | runtime | no | `3000` | Port the server listens on (`next start`, the image's `server.js`). With the local PGlite store, server pages fetch case details from `http://127.0.0.1:PORT`, so it must be the port this process serves plain HTTP on. | `app/_lib/data-provider.ts` |

Setting `0` anywhere but a platform that overwrites the header lets a caller
forge the leftmost entry and get a fresh rate-limit bucket on every request.
The Podman stacks publish the port with no proxy and set `none`, so the
header is ignored. See `deploy-podman.md` section 6.

## 5. LLM

All LLM calls are mocked in tests. With no `OPENAI_API_KEY`, demo uses the
deterministic keyless mock adapter and cannot spend; production answers 503
(`llm_not_configured`) on LLM routes instead of serving canned drafts.

| Variable | Demo | Production | When | Secret | Default | Effect | Source |
|---|---|---|---|---|---|---|---|
| `OPENAI_API_KEY` | optional | needed for LLM features | runtime | yes | none | Enables the live adapter. | `lib/agents/runtime.ts` |
| `OPENAI_MODEL` | optional | optional | runtime | no | `gpt-5.1` | General model id. | `lib/agents/runtime.ts` |
| `JEEVES_AGENT_RUNTIME` | optional | optional | runtime | no | `ai-sdk` | `agents-sdk` selects the OpenAI Agents SDK adapter; anything else is the AI SDK adapter. | `lib/agents/runtime.ts` |
| `OPENAI_TERRA_MODEL` | optional | optional | runtime | no | `gpt-5.6-terra` | Reviewer model, `agents-sdk` runtime only. | `lib/agents/runtime.ts` |
| `OPENAI_LUNA_MODEL` | optional | optional | runtime | no | `gpt-5.6-luna` | Chat model, `agents-sdk` runtime only. | `lib/agents/runtime.ts` |
| `OPENAI_REASONING_EFFORT` | optional | optional | runtime | no | `low` | `agents-sdk` reasoning effort; an unrecognised value falls back to `low`. | `lib/agents/openai-agents-adapter.ts` |
| `JEEVES_DEEP_REVIEW` | optional | optional | runtime | no | off | `1` enables deep review (policy tools) with the `agents-sdk` runtime and a key. | `lib/agents/runtime.ts`, `lib/agents/openai-agents-adapter.ts` |
| `JEEVES_AGENT_TRACING` | optional | optional | runtime | no | off | `1` turns on Agents SDK tracing; otherwise tracing is disabled. | `lib/agents/openai-agents-adapter.ts` |

## 6. Demo doors

| Variable | Demo | Production | When | Secret | Default | Effect | Source |
|---|---|---|---|---|---|---|---|
| `OPERATOR_TOKEN` | needed to read real requests | unused | runtime | yes | none | Bearer token for `/api/public-intake` and `/operator`. Under 32 characters counts as unset and switches the queue off. | `lib/services/route-guard.ts` |
| `CRON_SECRET` | optional | unused | runtime | yes | none | Bearer token for `GET /api/cron/monitor`. Unset answers 503; in production the route answers 404. | `app/api/cron/monitor/route.ts`, `scripts/reset-demo.ts` |
| `PHOENIX_ENDPOINT` | optional | unused | runtime | no | none | When set to an http(s) URL, the telemetry page shows an amber "endpoint set, not polled" state; an invalid value shows "endpoint is not a valid URL". Nothing contacts the endpoint yet, and the data stays synthetic ("Synthetic data — demo"). | `lib/telemetry/connector.ts` |
| `PHOENIX_PROVIDER_NAME` | optional | unused | runtime | no | built-in name | Label shown for that endpoint. | `lib/telemetry/connector.ts` |

## 7. Marketing site (build time)

Inlined by Next.js at build: set them in the build environment (Vercel project
settings; `--build-arg` for the container image, whose Containerfile declares
them). Setting them when a container runs has no effect. None has a built-in
contact address: unset, the pages render no contact links and the legal pages
say "Contact for this installation is not configured."

| Variable | Default | Effect | Source |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Origin used by the sitemap and robots. | `lib/marketing/site-config.ts` |
| `NEXT_PUBLIC_CONTACT_URL` | none | A `mailto:` or http(s) link that the marketing calls to action point at. Unset or invalid: no call-to-action links. | `lib/marketing/site-config.ts` |
| `NEXT_PUBLIC_PILOT_PRICE` | none | Pilot price; unset renders "Contact for pricing". | `lib/marketing/site-config.ts` |
| `NEXT_PUBLIC_PRIVACY_CONTACT` | none | Where privacy requests go; must be a `mailto:` address, and is shown as "Email ...". A Vercel production build with `JEEVES_MODE=demo` fails without it. | `lib/marketing/site-config.ts`, `lib/marketing/contact.ts` |

## 8. What the boot checks enforce

`instrumentation.ts` runs them once per server start (not during `next build`).
On failure the process logs, marks `/api/health` and `/api/health/live` as 503
and exits with code 1.
One exception, demo only: a database that cannot be reached at all (see the
last paragraph of this section) does not exit the instance.

Production reports every configuration problem at once
(`production configuration is invalid: ...`), among them:

- `DATABASE_URL (or POSTGRES_URL) is required` / `is invalid`
- `The database is on another host and the connection is not verified TLS` (see "Database TLS in production")
- `JEEVES_DB_ALLOW_UNVERIFIED must be same-host or unset`
- `DATA_PROVIDER=mock is not allowed in production`
- `JEEVES_COOKIE_SECRET is required` / `is too short` / `is too weak` (one repeated character, or a placeholder word such as `changeme`)
- `APP_BASE_URL is required` / `must be an https origin` (scheme, host and optional port only: no path, query, fragment or credentials)
- `JEEVES_TENANT_ID is required`
- `JEEVES_TRUSTED_PROXY_HOPS is required` / `must be a non-negative integer`

Then, in both modes, the installation stamp is verified against the database
(`installation check failed: ...`): a production database must be stamped
`production`, hold no demo data, and have every bundled migration applied
(`npm run db:migrate`); demo stamps an unstamped database and refuses a
`production` one, and retries a database read error with a short backoff.
Production retries only errors that say the database cannot be reached (refused,
reset or timed-out connections, a database starting up), about five seconds in
all, each attempt cut off after 3 seconds; a stamp mismatch, a missing migration,
bad credentials or a TLS error stop it at once. A production database with an
empty control catalog logs one warning: approvals are refused until a catalog is
loaded. In demo a malformed `JEEVES_TRUSTED_PROXY_HOPS` also fails the boot.

A demo that still cannot reach its database after the retries (each attempt is
cut off after 3 seconds) does not exit: the marketing and legal pages need no
data. It holds the database closed instead. Nothing reads or writes until the
installation stamp has been verified in that process; database-backed routes
answer `503` with `Retry-After: 15` and the console shows a notice;
`/api/health` answers `503` `degraded`. The check is retried from requests, at
most every 15 seconds. A stamp mismatch still exits at once; a credentials or TLS
error exits after the retries; production never holds: it exits after its
retries.

## 9. Evidence storage

| Variable | Demo | Production | When | Secret | Default | Effect | Source |
|---|---|---|---|---|---|---|---|
| `JEEVES_EVIDENCE_WORKSPACE_MAX_MIB` | optional | optional | runtime | no | demo `100`, production off | Most evidence one workspace may hold, in whole MiB; `none` lifts the ceiling. An upload past it is refused with 413. Malformed (`0`, `100MB`, `1.5`): demo uses `100`; production pauses evidence uploads (503) and logs the variable name. In production it is off unless set. Customer sign-in is not built yet; if an install keeps all initiatives in one workspace, this value caps the whole install. | `lib/evidence/storage-limits.ts` |
| `JEEVES_EVIDENCE_TOTAL_MAX_MIB` | optional | ignored | runtime | no | demo `2048` | Most evidence the whole database may hold, in whole MiB; `none` lifts it. An upload past it is refused with 413. Malformed (`0`, `100MB`, `1.5`): demo uses `2048` and logs the variable name. Ignored in production. | `lib/evidence/storage-limits.ts` |

Both are read per upload, not by the boot checks (section 8).
