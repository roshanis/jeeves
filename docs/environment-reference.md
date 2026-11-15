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

## 2. Database

| Variable | Demo | Production | When | Secret | Default | Effect | Source |
|---|---|---|---|---|---|---|---|
| `DATABASE_URL` | recommended | **required** | runtime | yes | none | Postgres connection string. Wins over `POSTGRES_URL` when nonblank. With neither, the app opens the local PGlite store (demo/dev only: production refuses to boot). | `lib/db/runtime-config.ts`, `lib/db/client.ts` |
| `POSTGRES_URL` | alias | alias | runtime | yes | none | Vercel integration alias, used only when `DATABASE_URL` is blank. | `lib/db/runtime-config.ts` |
| `DATABASE_MIGRATION_URL` | optional | optional | runtime | yes | the runtime URL | Direct connection for `npm run db:migrate`. Required for Supabase on port 6543 (transaction pooling cannot migrate). | `lib/db/migrate.ts`, `scripts/migrate.ts`, `lib/db/connection-config.ts` |
| `DATABASE_SSL_CA` | optional | optional | runtime | no | none | PEM CA for node-postgres. Verification stays on. Refused if the URL disables TLS or sets `ssl`, `sslcert`, `sslkey`, `sslrootcert`, `sslnegotiation` or `uselibpqcompat`. Supabase hosts always use verified TLS. | `lib/db/connection-config.ts`, `lib/db/client.ts` |
| `JEEVES_DB_DRIVER` | optional | optional | runtime | no | by host | `neon` or `pg` forces the driver. By default `*.neon.tech` uses the Neon serverless driver, anything else node-postgres. | `lib/db/driver-select.ts` |
| `JEEVES_PGLITE_DIR` | optional | unused | runtime | no | `./.pglite` | Directory of the local PGlite store when no URL is set. | `lib/db/client.ts` |
| `DATA_PROVIDER` | optional | must not be `mock` | runtime | no | `db` if a URL is set, else `mock` | `mock` serves fixture data (read-only preview); `db` reads the database. Production refuses `mock`. | `lib/data/provider-mode.ts`, `lib/config/deployment-mode.ts` |
| `ALLOW_SEED` | n/a | n/a | runtime | no | unset | `1` lets `npm run db:seed` / reset run with `NODE_ENV=production`. The seed is destructive. | `scripts/seed.ts`, `scripts/reset-demo.ts` |
| `ALLOW_DISCARD_PUBLIC_REQUESTS` | n/a | n/a | runtime | no | unset | Must equal the number of initiatives in `public-` workspaces for `db:seed` or `reset:demo` to proceed; otherwise the run is refused. | `scripts/seed.ts` |

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
| `PHOENIX_ENDPOINT` | optional | unused | runtime | no | none | When set, the telemetry page reports a Phoenix connector as configured. The data stays synthetic ("Synthetic data — demo"). | `lib/telemetry/connector.ts` |
| `PHOENIX_PROVIDER_NAME` | optional | unused | runtime | no | built-in name | Label for that connector. | `lib/telemetry/connector.ts` |

## 7. Marketing site (build time)

Inlined by Next.js at build; set them in the build environment.

| Variable | Default | Effect | Source |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Origin used by the sitemap and robots. | `lib/marketing/site-config.ts` |
| `NEXT_PUBLIC_CONTACT_URL` | a `mailto:` link | Where marketing calls to action point. | `lib/marketing/site-config.ts` |
| `NEXT_PUBLIC_PILOT_PRICE` | none | Pilot price; unset renders "Contact for pricing". | `lib/marketing/site-config.ts` |
| `NEXT_PUBLIC_PRIVACY_CONTACT` | the contact URL | Where privacy requests go. | `lib/marketing/site-config.ts` |

## 8. What the boot checks enforce

`instrumentation.ts` runs them once per server start (not during `next build`).
On failure the process logs, marks `/api/health` as 503 and exits with code 1.

Production reports every configuration problem at once
(`production configuration is invalid: ...`), among them:

- `DATABASE_URL (or POSTGRES_URL) is required`
- `DATA_PROVIDER=mock is not allowed in production`
- `JEEVES_COOKIE_SECRET is required` / `is too short`
- `APP_BASE_URL is required` / `must be an absolute https URL without embedded credentials`
- `JEEVES_TENANT_ID is required`
- `JEEVES_TRUSTED_PROXY_HOPS is required` / `must be a non-negative integer`

Then, in both modes, the installation stamp is verified against the database
(`installation check failed: ...`): a production database must be stamped
`production`, hold no demo data, and have every bundled migration applied
(`npm run db:migrate`); demo stamps an unstamped database and refuses a
`production` one, and retries a database read error with a short backoff. In
demo a malformed `JEEVES_TRUSTED_PROXY_HOPS` also fails the boot.
