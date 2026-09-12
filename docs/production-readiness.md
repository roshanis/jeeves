# Jeeves — Production Readiness Assessment

> Assessed 2026-09-11; revised 2026-09-12 after a remediation pass. Items
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
audience. `docs/deploy.md` is an accurate runbook and the safety posture for
a shared link is sound.

**As a production installation: no — but for one reason now, not two.**

The 2026-09-12 pass closed the second blocker (per-instance rate limiting) and
the two "should fix" items that were genuinely fixable in code. What remains
is **authentication**, and that is disqualifying on its own.

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

### 1.2 Rate limiting is per-instance and will not hold on serverless — FIXED 2026-09-12

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

The in-memory `TokenBucketRateLimiter` remains in the tree — it is still the
right tool for a single-process context — but no longer guards any route.

**Correctly scoped already:** sessions and the daily token budget are *not*
affected — both moved to Postgres. `DbBudgetStore.reserveAtomic()` is a single
`INSERT … ON CONFLICT DO UPDATE` with a `setWhere` cap predicate and
`.returning()`, i.e. a genuine atomic compare-and-set that holds across
instances. (`docs/deploy.md` §3(c) claimed otherwise until 2026-09-11; it was
stale and contradicted §3(b). Now corrected.)

---

## 2. Should fix before a pilot

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

### 2.3 No staging environment — DOCUMENTED 2026-09-12, not built

`docs/deploy.md` §5 now describes the cheap version — a second Vercel project
against a Neon *branch* of production, so the data is realistic by
construction and costs almost nothing — along with the traps (separate
`DEMO_PASSCODE`, `OPENAI_API_KEY` unset, and the fact that a branch inherits
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
stored, because the name on it was chosen by whoever typed the shared
passcode. Everything else on this page is an engineering task. This one is a
product decision about what the system is for.
