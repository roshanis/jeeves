# Jeeves — Production Readiness Assessment

> Assessed 2026-09-11 against the tree at that date. Every claim below was
> checked against the code, not inferred from the docs; where a finding was
> measured against a running build, the measurement is quoted.
>
> Companion to `docs/deploy.md`. That document tells you how to deploy the
> demo; this one tells you what would have to change before this is a system
> a real payer could run its governance on.

---

## Verdict

**As a public demo: ready.** Deploy it, share the URL, run it in front of an
audience. `docs/deploy.md` is an accurate runbook and the safety posture for
a shared link is sound.

**As a production installation: no.** Two findings are structural rather than
things to patch, and the first is disqualifying on its own.

The distinction matters because almost everything *else* about this codebase
is production-grade, which makes it easy to mistake for production-ready. It
is not the engineering that falls short; it is that two of the product's
load-bearing guarantees are not actually enforced.

---

## 1. Blockers

### 1.1 There is no authentication — approver identity is self-asserted

**The finding.** `app/api/session/route.ts` accepts `{ passcode, personaKey }`.
The caller supplies a single shared passcode and then *chooses which person
they are*. `components/jeeves/role-context.tsx` is explicit that switching
role is client-side and never re-fetches a different data set.

**Why it is disqualifying rather than incomplete.** The product's central
claim is "agents draft, humans decide", realised as a *named accountable
approver* recorded against every decision. That name is the primary artifact
this system produces. Today anyone holding the passcode can present as Angela
Torres and record an approval in her name. The audit log will faithfully,
immutably record an attribution that was never authenticated — which is worse
than no audit log, because it carries the authority of one.

**What it would take.** Real IdP integration (SAML/OIDC against the
customer's directory), server-side role assignment derived from directory
group membership rather than a client-side switcher, and per-user sessions
replacing the shared passcode. Every mutation route would then authorise
against the authenticated principal instead of a workspace token. This is a
project, not a task.

**Note on scope.** The demo's own posture is *correct for a demo* and
carefully built: public visitors are strictly read-only, the passcode gates
the mutable workspace, the workspace cookie is signed
(`lib/security/workspace-cookie.ts`) after an earlier review found it could
be forged to adopt another workspace, and the session route deliberately does
not reveal which half of the credential failed. None of that is wasted work —
it is simply solving a different problem than authentication.

### 1.2 Rate limiting is per-instance and will not hold on serverless

**The finding.** `lib/security/rate-limit.ts`'s `TokenBucketRateLimiter` is
held in module scope (see the module-scoped `rateLimiter` and
`sessionAttemptLimiter` reset in `route-guard.ts`'s
`resetGuardStateForTests`). On Vercel each lambda instance has its own
memory, and instances scale out and recycle.

**Consequence.** The passcode brute-force bucket — 5 attempts, refilling at
1/30s — is per instance. An attacker who spreads attempts across a warm fan-out
gets a multiple of the configured budget, and a cold start resets it entirely.
With a low-entropy passcode (which is what a demo passcode is designed to be)
this is the practical way in.

**What it would take.** Move the buckets to the shared store the sessions and
budget already use. This one *is* a task, not a project: `DbBudgetStore` in
`lib/security/budget.ts` is a working model of the same pattern.

**Correctly scoped already:** sessions and the daily token budget are *not*
affected — both moved to Postgres. `DbBudgetStore.reserveAtomic()` is a single
`INSERT … ON CONFLICT DO UPDATE` with a `setWhere` cap predicate and
`.returning()`, i.e. a genuine atomic compare-and-set that holds across
instances. (`docs/deploy.md` §3(c) claimed otherwise until 2026-09-11; it was
stale and contradicted §3(b). Now corrected.)

---

## 2. Should fix before a pilot

### 2.1 No backup or restore procedure

There is no documented backup, restore, or point-in-time-recovery process for
the Neon database. For a system whose value proposition is an immutable audit
trail, "what happens when the database is lost" has no written answer. Neon's
own branching/PITR features probably cover it; nothing says so, which means
nobody has decided the retention window.

### 2.2 The test suite cannot see the rendering path production uses

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

A green suite here does not certify the path production runs. Worth either
making the mock reproduce the DB's emptiness for pre-review states, or adding
a provider-parity test that asserts the two agree per lifecycle state.

### 2.3 No staging environment in the runbook

`docs/deploy.md` goes from local to production. There is no documented
environment in which to rehearse a migration against realistic data before
running it against the real thing.

### 2.4 Database sizing is unreviewed

No index review, no connection-pool sizing, no query-plan work. The demo
dataset is 12 initiatives and a few hundred rows, and `db-provider.ts` says so
explicitly — it loads whole tables and assembles the read model in memory,
which it calls "simpler and more auditable than a lattice of joins, and well
within budget for a Neon/PGlite demo database." That is an honest and correct
trade for a demo and an obvious problem at a real payer's volumes. The Inbox
alone fans out to `getInitiativeDetail` per initiative.

---

## 3. What is genuinely production-grade

Listed because it is substantial, and because the gaps above are easier to
weigh against it.

- **Transactions are real.** `lib/db/client.ts` uses
  `drizzle-orm/neon-serverless` over a pooled WebSocket `Pool` when
  `DATABASE_URL` is set. Every state-changing service goes through
  `db.transaction(fn)` with genuine rollback-on-throw, including the
  compare-and-set predicates those services rely on. An earlier version used
  `neon-http`, whose `transaction()` is a stub; that was found and fixed.
- **The audit log is append-only at the database level**, not in application
  code — `drizzle/0002_audit_events_append_only.sql` installs triggers that
  raise on UPDATE and DELETE, enforced regardless of which role issues the
  statement. `lib/db/schema.test.ts` tests it at the DB level.
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
- **1022 unit tests across 90 files, plus 22 e2e**, all passing.

---

## 4. Backend database setup — direct answer

| | Status |
|---|---|
| Schema + migrations | Ready — 9 migrations, Drizzle, hand-written trigger/view migrations included |
| Driver + transactions | Ready — pooled Neon serverless, real interactive transactions |
| Append-only audit enforcement | Ready — DB-level triggers, tested |
| Non-destructive migration path | **Added 2026-09-11** — see below |
| Backup / restore | **Missing** — undocumented |
| Sizing, indexes, pooling | **Unreviewed** — demo-scale by design |
| Staging environment | **Missing** |

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
with it?"* — not yet, and the work is not evenly distributed. The database,
transactional integrity, audit immutability, and web security posture are in
good shape. Authentication does not exist, and without it the system's central
output — a named accountable approval — is not trustworthy, no matter how
immutably it is stored.
