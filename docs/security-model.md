# Jeeves — Security Model

What the code enforces today, written from the code (file names in
parentheses), not from intent. Companion to [`SECURITY.md`](../SECURITY.md)
(how to report a problem), [`docs/deploy.md`](deploy.md) (running it) and
[`docs/production-readiness.md`](production-readiness.md) (what a real install
still needs). If this file and the code disagree, the code wins and this file is
wrong.

Jeeves is a demo of an AI governance gateway for a fictional payer. Seeded and
playground data is fictional. The one place it holds real personal data is the
real-request queue (section 6).

## 1. Deployment modes

`JEEVES_MODE` selects the mode (`lib/config/deployment-mode.ts`). Exactly
`demo` is demo mode; anything else, including unset, is **production mode**.

| | Demo | Production |
|---|---|---|
| Who gets in | Anyone, without a password | Nobody yet: single sign-on is not built, `/sign-in` says so |
| Personas | 13 fictional personas, chosen freely | None |
| Playground, real-request door, `/operator`, cron | Open | Closed: every demo door answers 404 (`lib/config/demo-doors.ts`) |
| Console pages | Open | Turned away at the proxy when no credential is present (`lib/config/production-routes.ts`) |
| Boot | Warns about gaps | Refuses to start unless the production settings are complete (`assertProductionConfig`) |

Production mode also stamps the database with its mode and an install id
(`installation` table, migration 0015), so a database made for one mode cannot
be booted in the other.

## 2. Trust boundaries and identities

1. **Public pages** (`/`, `/frameworks/*`, `/pilot`, `/privacy`, `/terms`).
   Static content; no session. In production the marketing pages answer 404 and
   `/` sends the visitor to the console.
2. **The playground** (demo only). `POST /api/session` gives any visitor any
   persona in an isolated workspace of their own. Role is chosen by the
   visitor, so a persona proves nothing about who they are; it only selects
   what the interface lets them try. Playground sessions cannot change the
   seeded records or global control defaults.
3. **The real-request door** (demo only, and only while `OPERATOR_TOKEN` is
   set). `POST /api/public-session` mints a `public`-role session in a
   `public-` workspace. `runMutationGuard` denies `public` by default; exactly
   three routes pass `allowPublic: true`: create an initiative, edit an intake
   draft, submit an intake. A `public` session cannot start LLM calls, draft
   runs, QC or any decision, and never donates its workspace to a persona
   switch.
4. **`/operator` and `GET /api/public-intake`**. Gated by the server-side
   `OPERATOR_TOKEN` (32 characters or more; a shorter value switches the queue
   off and the API answers 404), never by persona role, because every persona
   is free to every visitor. Wrong tokens spend a per-client bucket (capacity
   10, one token per 30 seconds); a locked-out client is refused before the
   compare.
5. **Cron** (`GET /api/cron/monitor`, demo only). Bearer `CRON_SECRET`, compared
   in constant time after hashing both sides. Unset answers 503. The code
   enforces no minimum length; use 32 or more characters.
6. **Production mode.** No identities exist yet. Console reads go through
   `requireViewer`, which sends a request with no valid session to `/sign-in`.

## 3. Sessions and cookies

- A session token is 256 random bits, stored in the `sessions` table and kept
  by the browser in `sessionStorage`, sent as `Authorization: Bearer`.
  Lifetime: 1 hour for a persona session, 30 minutes for a `public` session.
- The `jeeves_workspace` cookie holds the signed workspace id: `HttpOnly`,
  `SameSite=Lax`, `Path=/`, seven days, `Secure` when `NODE_ENV=production`.
  It is signed with `JEEVES_COOKIE_SECRET`. Changing the secret invalidates
  old cookies but does not revoke tokens already issued.
- Session entry and exit endpoints refuse cross-origin requests (403) and
  non-JSON bodies (415).
- Known gaps: `extractSessionToken` still falls back to the cookie
  (auth-F10), and after a persona switch the parent token stays valid until it
  expires.

## 4. Authorization

Every mutation goes through `runMutationGuard` (`lib/services/route-guard.ts`),
in this order, stopping at the first failure: read-only preview check, session
(401), `public`-role denial unless the route opts in (403), rate limit (429),
capped body read (413), field length and total caps (400), then, for LLM
routes, the daily token reservation (429). Then the route checks role, domain
and ownership:

- a reviewer signs or returns only reviews in their own domain;
- a requester edits and submits only their own initiatives;
- a mutation must match the session's workspace exactly; a null workspace is
  refused;
- the lifecycle table (`lib/lifecycle/transitions.ts`) decides which role may
  take which transition.

**Separation of duties.** Agents draft, recommend and route; they never
approve. Only the Approver approves or rejects initiatives and control
exceptions. Admin never approves or signs a review; Admin changes thresholds,
pauses and resumes deployments, revokes exceptions and rolls back deployments
(each with a reason and an audit event), and opens or returns QC. The exact
list is rule 5 of [`AGENTS.md`](../AGENTS.md).

## 5. Abuse controls

Rate limits are token buckets kept in Postgres, so they hold across instances.
The client key is derived from `X-Forwarded-For` using
`JEEVES_TRUSTED_PROXY_HOPS` (required in production), then HMAC-hashed with the
signing secret before it is stored.

| Policy | Bucket |
|---|---|
| Business mutations | capacity 20, 0.5 tokens per second |
| Anonymous session entry | capacity 5, one token per 30 seconds |
| Public (real-request) session mint | capacity 10, one token per 60 seconds |
| Persona switch | capacity 20, 0.2 tokens per second |
| Wrong operator token | capacity 10, one token per 30 seconds |

Request bodies are capped at 1 MiB by default and a route may set a lower cap;
text fields have per-field limits and a 100,000-character total. LLM use is
capped by an atomic per-day reservation of 500,000 tokens for the whole
database (`lib/security/budget.ts`). Evidence uploads have per-workspace and
whole-database storage ceilings (`JEEVES_EVIDENCE_*_MAX_MIB`).

## 6. Data

The inventory of personal data, who can read it and how to remove a request's
content is in [`docs/deploy.md`](deploy.md) section 5, "Personal data". It is
not repeated here so that there is one copy. In short: seeded and playground
records are fictional; a real request stores the submitter's name, e-mail
address and free text in `initiatives` and `intake_versions`, and the title in
`audit_events`; operators with `OPERATOR_TOKEN` can read it; there is no
retention period yet.

**Audit log.** `audit_events` is append-only because database triggers refuse
UPDATE, DELETE and TRUNCATE (migrations 0002 and 0014); the evidence tables and
`installation` have similar guards. This is not a privilege boundary: the role
that owns the tables can run `ALTER TABLE ... DISABLE TRIGGER`, and the
application's own role owns them in the current layout (`scripts/seed.ts` does
exactly that to reset a demo). A production install therefore needs a separate
owner/migrator role and the application running as a non-owner role that has
only the privileges it needs; see `docs/deploy.md` and `docs/production-readiness.md`.
Until that is in place, do not describe the audit log as protected by
permissions.

**LLM calls.** With `OPENAI_API_KEY` unset, the offline mock adapter runs and
nothing leaves the server. With it set, draft runs, intake chat and auditor
answers send the initiative's content to OpenAI. Real-request submissions never
reach an LLM.

## 7. Transport and headers

TLS is terminated by the platform or a proxy in front of the app. The app sets,
on every route (`next.config.ts`): a Content-Security-Policy limited to
same-origin resources (`script-src` and `style-src` keep `'unsafe-inline'`
because Next's hydration and Recharts inject inline code without a nonce),
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`
for two years with `includeSubDomains` and `preload`, a `Permissions-Policy`
that denies camera, microphone and geolocation, and `Cache-Control: no-store`
on per-viewer JSON. The app does not filter HTTP methods: block `TRACE` at the
load balancer (`docs/deploy.md` section 3).

## 8. Secrets

| Secret | Used for | Minimum |
|---|---|---|
| `JEEVES_COOKIE_SECRET` | Signs the workspace cookie and keys the rate-limit hash | 32 characters, enforced at boot in production; generate with `openssl rand -hex 32` |
| `OPERATOR_TOKEN` | Opens `/operator` and `/api/public-intake` | 32 characters; shorter is treated as unset |
| `CRON_SECRET` | Authorizes the cron monitor run | None enforced; use 32 or more |
| `DATABASE_URL`, `POSTGRES_URL` | Database access | n/a; production requires verified TLS to a remote host |
| `OPENAI_API_KEY` | Live LLM adapter | n/a; any non-empty value selects the live adapter |

Secrets come from the environment only, never from the repository;
`.env.example` carries no values.

## 9. Out of scope

- Authentication of real people in production (not built).
- Protecting the audit log from whoever holds the table owner's credentials.
- Retention and a title-redaction path for real requests.
- Denial of service beyond the per-client limits above; a distributed attack
  needs the platform's own controls.
- The security of the OpenAI service, the hosting platform and the database
  provider.
- Anything under `deploy/` beyond what `docs/deploy-podman.md` states.
