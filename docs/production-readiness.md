# Jeeves — Production Readiness Assessment

> Assessed 2026-09-11; revised 2026-09-12 after a remediation pass; the
> retired-passcode, test-count and driver statements were corrected 2026-11-15. Items
> marked FIXED were closed in that pass and carry the evidence. Every claim below was
> checked against the code, not inferred from the docs; where a finding was
> measured against a running build, the measurement is quoted.
>
> Companion to `docs/deploy.md`. That document tells you how to deploy the
> demo; this one tells you what would have to change before this is a system
> a real payer could run its governance on.

---

## Verdict

**As a public demo: ready.** Deploy it, share the URL, run it in front of an
audience. `docs/deploy.md` is the runbook and the safety posture for
a shared link is sound.

**As a production installation: no — but for one reason now, not two.**

The 2026-09-12 pass closed the second blocker (per-instance rate limiting) and
the two "should fix" items that were genuinely fixable in code. What remains
is **authentication**, and that is disqualifying on its own.

The distinction matters because almost everything *else* about this codebase
is production-grade, which makes it easy to mistake for production-ready. It
is not the engineering that falls short; it is that the product's central
guarantee — that an approval carries a named, accountable human — is not
actually enforced.

---

## 1. Blockers

### 1.1 There is no authentication — approver identity is self-asserted

**The finding.** `app/api/session/route.ts` accepts `{ personaKey }` only.
Entry is passwordless (section 1.3): any visitor *chooses which person they
are* from the 13 fictional personas and is placed in their own isolated
workspace. There is no identity provider behind that choice, and none in a
customer installation either; that is the known gap this section is about.

**Why it is disqualifying rather than incomplete.** The product's central
claim is "agents draft, humans decide", realised as a *named accountable
approver* recorded against every decision. That name is the primary artifact
this system produces. Today any visitor can present as Angela
Torres and record an approval in her name. The audit log will faithfully,
immutably record an attribution that was never authenticated — which is worse
than no audit log, because it carries the authority of one.

**What it would take.** Real IdP integration (SAML/OIDC against the
customer's directory), server-side role assignment derived from directory
group membership rather than a client-side switcher, and per-user sessions
replacing the self-chosen persona. Every mutation route would then authorise
against the authenticated principal instead of a workspace token. This is a
project, not a task.

**Note on scope.** The demo's own posture is *correct for a demo* and
carefully built: every visitor writes only into their own isolated workspace
and cannot change shared seeds or global defaults, real requests arrive
through a separate `public`-role door (section 1.3), the workspace cookie is signed
(`lib/security/workspace-cookie.ts`) after an earlier review found it could
be forged to adopt another workspace, and the session route validates the persona key against the fixed list. None of that is wasted work —
it is simply solving a different problem than authentication.

### 1.2 Rate limiting is per-instance and will not hold on serverless — FIXED 2026-09-12

**The finding.** `lib/security/rate-limit.ts`'s `TokenBucketRateLimiter` is
held in module scope (see the module-scoped `rateLimiter` and
`sessionAttemptLimiter` reset in `route-guard.ts`'s
`resetGuardStateForTests`). On Vercel each lambda instance has its own
memory, and instances scale out and recycle.

**Consequence.** Every per-client limit (session issue, mutations, the
real-request limit) was per instance. A caller who spreads requests across a
warm fan-out gets a multiple of the configured budget, and a cold start resets
it entirely.

**FIXED.** The buckets moved to Postgres — `rate_limit_buckets`
(`drizzle/0009_rate_limit_buckets.sql`), driven by
`lib/security/db-rate-limit.ts`. The consume path is a single
`INSERT … ON CONFLICT DO UPDATE` whose `WHERE` re-derives the refilled
balance and applies only when a token is available: the same
compare-and-set shape `DbBudgetStore.reserveAtomic()` uses, and the reason
concurrent requests across instances are safe. A read-modify-write in
application code would not have been, however carefully written — two
instances would read the same balance and both spend it.

`lib/security/db-rate-limit.test.ts` asserts the property the Map could never
have: two independent limiter instances over one database share a single
allowance. It also covers a 12-request concurrent burst against a capacity of
5, which yields exactly 5.

The unused in-memory `TokenBucketRateLimiter` and its exclusive tests were
retired on 2026-09-19. Shared rate-limit types and the active database limiter
remain; its focused tests cover burst, refill, isolation and shared allowance.

**Client key (X-Forwarded-For).** The bucket key is the client address from
`X-Forwarded-For`, read according to `JEEVES_TRUSTED_PROXY_HOPS` (the number of
trusted proxies that append to the header; `0` is only right where the
platform overwrites it, as on Vercel). Left unset anywhere else, the leftmost
entry is whatever the caller sent, so a random header per request gets a fresh
bucket each time. Production boot therefore refuses to start without an explicit
integer, a malformed value fails boot in both modes, and demo off Vercel warns
when it is unset. See `docs/deploy-podman.md` §6 for the values per shape.

**Correctly scoped already:** sessions and the daily token budget are *not*
affected — both moved to Postgres. `DbBudgetStore.reserveAtomic()` is a single
`INSERT … ON CONFLICT DO UPDATE` with a `setWhere` cap predicate and
`.returning()`, i.e. a genuine atomic compare-and-set that holds across
instances. (`docs/deploy.md` §3(c) claimed otherwise until 2026-09-11; it was
stale and contradicted §3(b). Now corrected.)

---

### 1.3 Two ways in: the playground and real requests — REVISED 2026-09-26

There is no passcode. Main's passwordless playground (PR #15, human decision
2026-09-19) gives any visitor any of the 13 personas, each visitor in their
own isolated workspace. Alongside it there is a separate door for REAL
requests (human decision 2026-09-26), and the two must never mix.

**Real requests.** `POST /api/public-session` mints a `public`-role session in
a `public-` workspace. `runMutationGuard` denies `public` unless a route opts
in with `allowPublic: true`; exactly three do (create initiative, edit intake
draft, submit intake). The role is deliberately NOT `requester`, which would
unlock the LLM-spending intake chat and 8-domain draft run.

**Who reads them.** `/operator` (via `GET /api/public-intake`), gated by the
server-side `OPERATOR_TOKEN` — compared in constant time, rate-limited on
failure, and treated as unconfigured below 32 characters (queue off, 404).
It is NOT gated by persona role: every persona, Program Office and Admin
included, is available to every visitor, so a role-gated queue would show
strangers each other's names, emails and requests. The queue is read-only;
operators reply by email to the address each submitter gave.

**Found and fixed while merging with the playground:**
- A real-request session was a valid *parent* for a persona switch, and the
  new persona inherited its workspace. A visitor who sent a real request and
  then tried the demo could approve their own request, and every sample they
  made afterwards landed in the operator queue. Fixed in the route and,
  independently, in `issueDemoSession`, which now refuses `public-`
  workspaces outright.
- `/api/session` accepted `public:<id>` persona keys (which `resolveActor`
  recognises for real-request sessions), letting a caller choose their own
  actor id and skip the real-request rate limit. Now demo personas only.
- The real-request actor id was half the live session token, persisted in
  `audit_events.actor`. Now an independent random id.
- Seeded shared drafts: a real-request session could reach the seeded
  champion draft and was stopped only by a crash (an anonymous 500). Main's
  strict shared-row rule now stops it at 404; a regression test pins that.

**What is NOT protected.** No captcha: the real-request limit (10 sessions per
client, one refill per 60s) and the 64KB body cap are the only ceiling. No
retention policy on `public-` workspace rows, and strangers may type real
personal data in despite the warning on the form.

### 1.4 Site essentials — ADDED 2026-09-13/14, two gaps accepted

The public-facing basics (404, per-page metadata, icon set, Open Graph,
loading states, confirmation page, legal pages, cookie notice) are in place
and covered by `tests/seo/page-metadata.test.ts` and
`tests/ui/site-essentials.test.tsx`. Two decisions left deliberate gaps:

**No analytics.** Decided 2026-09-13. The site loads no third-party scripts
at all, so the privacy page's "no advertising, no tracking pixel and no
third-party analytics" is simply true, and the cookie notice stays
informational rather than becoming a consent gate. If analytics are added
later and they set cookies, the notice MUST become a real consent gate with
a working reject path, and the script must not load before consent —
`components/jeeves/cookie-notice.tsx` documents that at its head. A
cookieless provider (Vercel Analytics, Plausible, Fathom) avoids that work.

**No postal address on the legal pages.** Decided 2026-09-13: email is the
sole contact point, and no address is invented. This is honest, and adequate
for a demonstration. It is NOT adequate for a production service marketed to
EU/UK visitors, where a controller's identity and address are generally
expected on a privacy notice. Set a real entity and address before this is
used commercially.

Also outstanding, and smaller: the project has no `public/` directory and no raster images, so there is
nothing to compress.

## 2. Should fix before a pilot

### 2.0 The audit log is trigger-enforced, not privilege-enforced

The append-only guarantee is a trigger (`drizzle/0002_audit_events_append_only.sql`),
not a `REVOKE`/`GRANT` split: no migration revokes privileges. The runtime
role is the table owner and the migrator uses the same role, so anyone holding
the application's database credentials can `ALTER TABLE audit_events DISABLE
TRIGGER` and rewrite history (`scripts/seed.ts` does exactly that for the
reseed). **Production prerequisite:** a separate owner/migrator role, and a
runtime role without ownership that holds only INSERT and SELECT on
`audit_events`, the evidence tables and any other append-only table. Not built.
When it is, the runtime role also needs to read the migration history, which
the production boot check compares with the build:
`GRANT USAGE ON SCHEMA drizzle TO <role>; GRANT SELECT ON drizzle.__drizzle_migrations TO <role>;`
(the boot refuses with `migrations_unreadable` and names these grants when
they are missing).

### 2.1 No backup or restore procedure — DOCUMENTED 2026-09-12, not yet exercised

`docs/deploy.md` §4 now covers it: set a PITR retention window on the Neon
project, branch before every migration, and never point `npm run db:seed` at
real data. It also states plainly what the append-only trigger does and does
not protect against — it stops the *application* deleting audit rows; it does
nothing about a dropped database or a reseed against the wrong
`DATABASE_URL`.

Still open, and deliberately called out in that section: **nobody has
restored from a backup.** A backup nobody has restored from is a hypothesis.
Restoring into a scratch branch and booting the app against it belongs in the
runbook before a pilot, not in an incident.

### 2.2 The test suite cannot see the rendering path production uses — FIXED 2026-09-12

`lib/data/mock-provider.ts` and `lib/data/db-provider.ts` are required to stay
shape-identical, and they are — but they disagree about *content* for the same
initiative. The mock synthesizes pending reviews and controls even for an
`intake_draft` initiative; the DB provider returns empty arrays, because
review rows are only written by `triage()` and effective controls only by
`decide()`.

This is not academic. It is precisely why the blockers-rail bug fixed on
2026-09-11 survived: `tests/ui/initiative-blockers-rail.test.tsx` loaded its
fixture from the mock provider, so the buggy state was unreachable from the
test, and the suite was green while the deployed app told a Critical-tier,
un-triaged initiative that "all required reviews signed and controls met."

**FIXED — both, in fact.** `lib/data/provider-parity.test.ts` asserts the
lifecycle invariants the real system enforces, and the mock is now gated to
honour them: no review rows before `triage()` writes them, and no effective
controls before `decide()` generates them.

Measuring it first was worth doing — the divergence was four initiatives, and
one case that looked like a fifth was the invariant being wrong rather than
the mock: `conditionally_approved` legitimately carries controls before
anything is deployed, because generation happens at decision time, not
deployment. The test encodes that distinction.

The failing state is now reachable from a mock-sourced fixture, so a test
like the original blockers-rail one would catch the original bug.

### 2.2a Production-mode smoke test — ADDED

Nothing used to start a real production-mode server, which is how a relative
`Location` in `proxy.ts` made every signed-out page answer 500 unnoticed.
`npm run smoke:production` closes that gap. It migrates a throwaway Postgres
database, stamps it `production`, boots the real server (the standalone build
the container image runs, or `next start`), and checks the HTTP behaviour on
the wire: redirects, 404s for marketing pages and demo doors, 401s for gated
reads, the sign-in page and its security headers, robots, sitemap and health.
It also starts the server four times with a deliberately bad configuration and
requires each to refuse to boot.

It stamps its database for good, so it only accepts `SMOKE_DATABASE_URL`
(there is no fallback to `DATABASE_URL`) naming a database called
`jeeves_smoke_<name>`. Create one with `CREATE DATABASE jeeves_smoke_local;`.
It needs a finished build and never builds: run
`DATA_PROVIDER=mock JEEVES_MODE=demo npm run build` first. Then:

    SMOKE_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/jeeves_smoke_local npm run smoke:production

`SMOKE_PORT` changes the port (default 3217) and `SMOKE_SERVER=standalone` or
`next-start` forces the server command. The run is repeatable on the same
database and exits 1 if any check fails.

A production image is built with `JEEVES_DEMO_ENABLED=0`, which compiles demo
mode out. To check such a build, add `SMOKE_DEMO_LOCKED=1`: the server is then
started with `JEEVES_MODE=demo` set, and every production check must still
pass, which is the proof that the flag cannot open the demo on that build. Run
against a build that is not locked, the same command fails, because the server
enters demo mode and refuses the production-stamped database.

### 2.3 No staging environment — DOCUMENTED 2026-09-12, not built

`docs/deploy.md` §5 now describes the cheap version — a second Vercel project
against a Neon *branch* of production, so the data is realistic by
construction and costs almost nothing — along with the traps (a separate
`JEEVES_COOKIE_SECRET`, `OPENAI_API_KEY` unset, and the fact that a branch inherits
whatever the parent held at branch time).

**It is described, not built.** Nobody has stood one up, so the rehearsal
space still does not exist.

### 2.4 Database sizing — REVIEWED 2026-09-12; indexes added, read model unchanged

**Index review done.** Postgres indexes primary keys and unique constraints
only — never foreign keys — and while several composite uniques here happen to
cover their leading FK column, seven filter/join columns had no cover at all.
`drizzle/0010_query_path_indexes.sql` adds them, most importantly
`initiatives(workspace_id)`: workspace read-isolation filters *every* read and
that column was unindexed.

**The read model is unchanged, and it is the real constraint.**
`db-provider.ts` loads whole tables and assembles the portfolio in memory —
"simpler and more auditable than a lattice of joins, and well within budget
for a Neon/PGlite demo database" — and the Inbox fans out to one
`getInitiativeDetail` per initiative. Both are correct trades at 12
initiatives. Neither is fixed by an index, because an index cannot speed up a
query that reads every row. At a real payer's volumes the read model has to
change first; the indexes only stop the point lookups and joins from being a
second problem on top.

Still not done: connection-pool sizing and query-plan work against realistic
data — neither of which is meaningful without the staging environment in
§2.3.

---

## 3. What is genuinely production-grade

Listed because it is substantial, and because the gaps above are easier to
weigh against it.

- **Transactions are real.** `lib/db/driver-select.ts` picks the driver
  (Neon serverless WebSocket pool, node-postgres, or PGlite) from the
  connection URL. Every state-changing service goes through
  `db.transaction(fn)` with genuine rollback-on-throw, including the
  compare-and-set predicates those services rely on. An earlier version used
  `neon-http`, whose `transaction()` is a stub; that was found and fixed.
- **The audit log is append-only at the database level**, not in application
  code — `drizzle/0002_audit_events_append_only.sql` installs triggers that
  raise on UPDATE and DELETE for every role, but the table owner can disable them.
  `lib/db/schema.test.ts` tests it at the DB level. A production boot therefore
  checks that all six append-only triggers (audit_events, installation) exist
  and are enabled, and refuses to start otherwise (`audit_triggers` in
  `lib/config/installation-check.ts`). See the prerequisite below: the runtime
  role currently owns the table.
- **Security response headers are thorough**: a real CSP pinning every
  fetchable resource to same-origin, HSTS with preload, `X-Frame-Options:
  DENY`, nosniff, Referrer-Policy, Permissions-Policy. `next/image` is
  disabled outright because the optimizer pulls in sharp, which carries
  unpatched HIGH CVEs, and nothing in the app used it.
- **Workspace read-isolation** is applied consistently, including for
  incidents, which carry no workspace column of their own and resolve
  ownership via `deploymentId -> initiative.workspaceId`.
- **CI gates every push**: typecheck, lint, unit tests with coverage, and the
  Playwright golden path.
- **A large unit suite plus a Playwright golden path**; run `npm test` and
  `npm run test:e2e` for the current counts.

---

## 4. Backend database setup — direct answer

| | Status |
|---|---|
| Schema + migrations | Ready — Drizzle migrations under `drizzle/`, hand-written trigger/view migrations included |
| Driver + transactions | Ready — driver chosen in `lib/db/driver-select.ts`, real interactive transactions |
| Append-only audit enforcement | Ready — DB-level triggers, tested |
| Non-destructive migration path | **Added 2026-09-11** — see below |
| Shared rate limiting | **Added 2026-09-12** — §1.2 |
| Provider-parity tests | **Added 2026-09-12** — §2.2 |
| Backup / restore | **Documented** (deploy.md §4) — never exercised |
| Indexes | **Reviewed**, 7 added (0010) |
| Pooling, query plans | **Unreviewed** — needs staging first |
| Read model | **Demo-scale by design** — whole-table loads; the real scaling constraint |
| Staging environment | **Documented** (deploy.md §5) — not built |

### The migration path (fixed 2026-09-11)

Until this date, `migrate()` was called from exactly two places: `scripts/seed.ts`
and `lib/db/test-client.ts`. The seed script wipes every table first and issues
`ALTER TABLE audit_events DISABLE TRIGGER ALL` to delete the append-only audit
log. `docs/deploy.md` also documented `npx drizzle-kit push`, but `push` diffs
and applies directly — it can drop columns — and bypasses the migrations
journal.

`npm run db:migrate` (`scripts/migrate.ts` -> `lib/db/migrate.ts`) is now the
supported path: non-destructive, idempotent, and driver-matched to whatever
`getDb()` would open. `lib/db/migrate.test.ts` asserts it preserves rows
(audit events included) and leaves the append-only triggers armed. Verified
end-to-end against a populated store: 122 audit events, 12 initiatives and 23
effective controls, identical before and after.

---

## 5. Summary for a decision-maker

If the question is *"can we show this to a customer?"* — yes, today.

If it is *"can we install this at a payer and let them govern real AI systems
with it?"* — not yet, and the remaining work is now concentrated in one place.
The database, transactional integrity, audit immutability, rate limiting, web
security posture and test fidelity are all in good shape.

Authentication does not exist. Until it does, the system's central output — a
named accountable approval — is not trustworthy, no matter how immutably it is
stored, because the name on it was chosen by whoever picked the persona. Everything else on this page is an engineering task. This one is a
product decision about what the system is for.
