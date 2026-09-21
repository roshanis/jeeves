# Jeeves — Deployment Runbook

This is the practical "how do I actually run this" doc. It covers running the
demo locally, deploying it to Vercel with Neon Postgres, the known gaps you
should be honest about if you show this to anyone, and a demo-day checklist.

Jeeves is a **fictional demo**: "Meridian Health" is not a real organization,
all data is synthetic, and no LLM call ever touches real PHI. See the top of
[`README.md`](../README.md) for the full disclaimer.

Deploy itself is **not executed by any agent** in this repo — this document
only describes the steps. A human runs them.

---

## 1. Local demo quickstart

```bash
npm install
npm run db:seed
DATA_PROVIDER=db JEEVES_COOKIE_SECRET=<server-signing-key> npm run dev
```

Notes on each step:

- `npm install` — installs from `package-lock.json` (npm is the toolchain in
  use here; there is no `pnpm-lock.yaml` in the repo despite `AGENTS.md`
  mentioning `pnpm` — use `npm run <script>` from `package.json`).
- `npm run db:seed` runs `tsx scripts/seed.ts`. With no `DATABASE_URL` set,
  this seeds a **persistent local PGlite store** at `./.pglite` (gitignored)
  — no external service, no signup. The seed is deterministic (fixed PRNG
  seed `"meridian-2026"`, fixed base date), so re-running it reproduces the
  same rows.
- `DATA_PROVIDER=db` forces the app to read through `DbDataProvider` (Neon
  when `DATABASE_URL` is set, otherwise the same PGlite store the seed just
  wrote to). Without this variable and without `DATABASE_URL`, the app falls
  back to `MockDataProvider` — an in-memory fixture set, not what you just
  seeded. See `lib/data/index.ts` for the exact selection logic.
- `JEEVES_COOKIE_SECRET=<server-signing-key>` signs browser workspace continuity.
  Use a high-entropy random key, generated for example with `openssl rand -hex 32`.
  Visitors never enter it. Existing DEMO_PASSCODE settings remain a deprecated
  signing fallback only: it signs new cookies and verifies existing ones during migration.

What you'll see at `http://localhost:3000`:

- A read-only portfolio board of **12 seeded initiatives** (tiers, states,
  the outcome-metrics strip) — browsable without signing up.
- **Try the demo** starts an isolated requester session and opens intake.
  Visitors can use the sample intake and switch roles in the header. Business
  actions require a server-issued session; shared examples and global defaults
  remain read-only to visitors.
- Once inside the live loop, agent drafting runs on the **deterministic,
  keyless mock adapter** by default (`lib/agents/mock-adapter.ts`). Nothing
  is sent to OpenAI unless you also set `OPENAI_API_KEY` in your
  environment — see `lib/agents/index.ts`: the adapter switches to the real
  OpenAI-backed adapter (`lib/agents/openai-adapter.ts`, model from
  `OPENAI_MODEL`) only when `OPENAI_API_KEY` is set and non-empty.

Other scripts you have available (`package.json`):

```bash
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm test            # vitest run (full unit suite)
npm run test:e2e    # playwright test (boots its own server on :3117)
npm run build        # next build
npm run start        # next start (after build)
```

---

## 2. Vercel deploy steps

1. **Import the project** into Vercel from this repository (Next.js is
   auto-detected; framework preset "Next.js", no custom build command
   needed — `next build` / `next start` are the defaults and match
   `package.json`).
2. **Connect a hosted PostgreSQL database.** Neon remains supported; the Vercel
   Supabase integration supplies `POSTGRES_URL`. Use the transaction pooler for
   serverless runtime traffic and a direct/session connection for migrations.
3. **Set environment variables** in the Vercel project settings:

   | Variable | Required | Notes |
   |---|---|---|
   | `DATABASE_URL` or `POSTGRES_URL` | Yes | Explicit nonblank `DATABASE_URL` wins; otherwise the Vercel integration `POSTGRES_URL` is used consistently for runtime, pages and incident reads. Neon hosts use the Neon driver; other PostgreSQL hosts use `pg`. Vercel refuses local PGlite fallback. |
   | `DATABASE_MIGRATION_URL` | For Supabase migrations | Direct or session-pooler connection on port 5432. Runtime transaction-pooler URLs on port 6543 cannot run migrations. |
   | `DATABASE_SSL_CA` | Optional | Project CA if required; recognized Supabase connections verify certificates and use a bounded pool. |
   | `DATA_PROVIDER` | Optional | Defaults to DB when either runtime URL exists. `db` makes this explicit; `mock` deliberately shows the read-only preview dataset. |
   | `JEEVES_COOKIE_SECRET` | Yes for new deployments | Random server-only signing key for browser workspace continuity. Visitor entry is passwordless. Existing DEMO_PASSCODE can serve only as a deprecated signing fallback. |
   | `OPENAI_API_KEY` | Optional | Only set this if you want **live** LLM-drafted reviews during the demo. Omit it and the app runs entirely on the keyless mock adapter — safe default for a public URL. |
   | `OPENAI_MODEL` | Optional (only meaningful with `OPENAI_API_KEY`) | Model id for the real adapter, e.g. the value in `.env.example` (`gpt-5.1`). Unused when `OPENAI_API_KEY` is unset. |

4. **Migrate the selected database first.** There is no migrate or seed step that runs on
   Vercel itself — Vercel serves the app, it does not run one-off scripts.
   Run this from your local machine, pointed at the same database Vercel
   uses:

   ```bash
   DATABASE_MIGRATION_URL="<direct/session connection to the same database>" npm run db:migrate
   ```

   `npm run db:migrate` (`scripts/migrate.ts` -> `lib/db/migrate.ts`) applies
   every migration under `drizzle/` and does nothing else. It is:

   - **non-destructive** — it never deletes rows, and `lib/db/migrate.test.ts`
     asserts that existing rows (including `audit_events`) survive a run;
   - **idempotent** — safe to re-run; drizzle's migrations journal table
     skips anything already applied;
   - **driver-matched** — it selects the Neon, node-postgres or PGlite migrator to match
     the selected connection. `DATABASE_MIGRATION_URL` selects a separate
     operator connection; absent that, the runtime URL precedence applies.
     Supabase transaction-pooler connections on port 6543 are rejected for migrations.

   This is the command to use against a database that holds real data, and
   it is the only one on this page that is safe to point at production.

   > Prefer this over `npx drizzle-kit push`. `push` diffs your local schema
   > against the live database and applies the difference directly, which can
   > drop columns; it also bypasses the migrations journal, so the database
   > and `drizzle/` fall out of step. `npx drizzle-kit migrate` is equivalent
   > to `npm run db:migrate` but needs the `drizzle-kit` devDependency and
   > `drizzle.config.ts` (which throws unless `DATABASE_URL` is set).

5. **Seed only an explicitly approved disposable demo database.**

   ```bash
   DATABASE_URL="<your Neon pooled connection string>" npm run db:seed
   ```

   Read this before running it: `npm run db:seed` **wipes every seeded
   table and repopulates it**, and to do that it issues
   `ALTER TABLE audit_events DISABLE TRIGGER ALL` so it can delete the
   append-only audit log (`scripts/seed.ts`, "Wipe in FK-safe order"). That
   is correct for a demo dataset and catastrophic for a real one — the audit
   log is the compliance record the product exists to keep.

   `scripts/seed.ts` refuses to run when `NODE_ENV=production` unless you
   set `ALLOW_SEED=1`. Treat that prompt as the question it is, not a
   formality. Seeding also assumes the schema already exists (including the
   append-only trigger in `drizzle/0002_audit_events_append_only.sql`), which
   is why step 4 comes first. Do not seed against a database that is
   currently serving a live demo audience mid-session.

6. **Playwright is NOT run on Vercel.** `npm run test:e2e` boots its own
   production build/server on a fixed local port (3117) and is a local/CI-only
   check (see `playwright.config.ts`). Vercel's build step only runs
   `next build`; do not wire Playwright into the Vercel build or deploy
   pipeline.

7. **Deploy.** Once env vars and the hosted schema are verified, trigger
   the Vercel deploy (push to the connected branch, or deploy from the
   Vercel dashboard/CLI). Visit the deployed URL and confirm the portfolio
   board renders the 12 seeded initiatives before sharing the link further.

---

## 3. KNOWN GAPS — read this before you rely on this in production

This section is deliberately blunt. These are real limitations in the
current code, not hypothetical ones.

> **(a) Neon transactions — RESOLVED (M2.5).** An earlier version of this
> caveat warned that `lib/db/client.ts` used `drizzle-orm/neon-http`, whose
> `transaction()` is a stub with no `BEGIN`/`COMMIT`/`ROLLBACK`. That swap
> has since been made: `lib/db/client.ts` now uses
> `drizzle-orm/neon-serverless` over a pooled `@neondatabase/serverless`
> WebSocket `Pool` whenever `DATABASE_URL` is set, which supports real
> interactive transactions. Every state-changing service call
> (`lib/services/initiative-service.ts`, `monitor-service.ts`,
> `admin-service.ts`, `promotion-service.ts`, `exception-service.ts`) goes
> through `db.transaction(fn)`, and that is a genuine rollback-on-throw
> transaction under both PGlite (tests, local dev) and pooled Neon
> (production) — including the compare-and-set predicates those services
> rely on.

> **(b) Rate limiting, sessions and budgets are persisted.**
> Sessions, atomic daily budgets and token-bucket rate limits live in Postgres.
> Anonymous entry uses a separate allowance from authenticated persona switching
> so visitors can explore multiple reviewer roles while workspace creation stays
> bounded. Mutation limits and input caps remain enforced by the shared guard.

> **(c) Public URL cost exposure — mitigations already in place, and what
> to verify before sharing the link.**
> In place today:
> - Visitors enter without a password and can select any fictional persona.
>   `/api/session` issues an isolated workspace token; business mutations still
>   require a valid non-null workspace session, role checks and ownership.
> - Visitor writes cannot alter shared examples or global control defaults.
> - An atomic daily token-budget check (`lib/security/budget.ts`, `reserve()`)
>   caps total LLM usage per day, serialized per day-key so concurrent
>   requests can't race past the cap.
> - Per-client rate limiting (`lib/security/rate-limit.ts`, token bucket).
> - Input length caps (`lib/security/input-limits.ts`).
> - **The keyless mock adapter is the default.** Unless you explicitly set
>   `OPENAI_API_KEY`, no visitor request calls a real LLM
>   provider, so there is no OpenAI bill exposure from a shared public URL
>   at all.
>
> Verify before sharing the URL:
> - Confirm whether `OPENAI_API_KEY` is set on the deployment. The daily
>   budget cap **is** global: it moved to Postgres in M2.5 and uses
>   `DbBudgetStore`'s atomic `INSERT … ON CONFLICT` upsert
>   (`lib/security/budget.ts`), serialized per day-key, so concurrent
>   requests on different instances cannot race past the cap. (An earlier
>   version of this bullet said the cap was per-instance "given gap (b)" —
>   that was left over from before the move and contradicted gap (b) directly.
>   Rate limits are now persisted as well.) A public visitor can consume the
>   shared model budget when a provider key is configured; this is a public
>   playground, not an authenticated customer environment.
> - Configure an independent random `JEEVES_COOKIE_SECRET`. With no signing
>   key or legacy signing fallback, entry returns 503 without creating a session.
>   Changing signing material invalidates old browser workspace cookies; it does
>   not revoke existing session tokens before their normal expiry.
> - Don't seed against a database that's serving a live public demo (see
>   §2 step 4).

---

## 4. Backups and restore

Short version: **Neon's own branching and point-in-time restore are the
backup mechanism; this repository adds nothing on top, and nothing here
substitutes for setting a retention window on the Neon project.**

That matters more here than in a typical app. `audit_events` is append-only
at the database level, which protects it from the *application* — it does not
protect it from a dropped database, a deleted Neon branch, or a reseed run
against the wrong `DATABASE_URL`. The append-only trigger and a backup solve
different problems.

### What to set up before this holds real data

1. **Set a PITR retention window on the Neon project.** Neon's history
   retention determines how far back you can branch or restore. The default
   on free tiers is short; pick a window that matches how long you would need
   to notice a bad write. Governance records are the product, so err long.
2. **Take a branch before any migration.** Neon branches are copy-on-write
   and cheap:

   ```bash
   # before: neonctl branches create --name pre-0009 --parent main
   DATABASE_URL="<pooled url>" npm run db:migrate
   ```

   `npm run db:migrate` is non-destructive and tested as such
   (`lib/db/migrate.test.ts`), but a branch costs nothing and covers the case
   where the migration is correct and the *schema change* is the mistake.
3. **Never point `npm run db:seed` at a database with real data.** It wipes
   every seeded table and disables the `audit_events` append-only triggers to
   do it. The `ALLOW_SEED=1` guard under `NODE_ENV=production` is the only
   thing standing between a mistyped `DATABASE_URL` and the loss of the
   compliance record.

### Restore

Restore is a Neon operation, not an application one: branch from a timestamp
before the bad write and repoint `DATABASE_URL` at the new branch. There is
no application-level undo, and there deliberately is no "delete audit events"
path to undo *with* — the trigger rejects `DELETE` from the app entirely.

### Not covered

No automated backup verification, and no drill. A backup nobody has restored
from is a hypothesis. If this goes to a pilot, restoring into a scratch
branch and booting the app against it should be part of the runbook, not a
thing discovered during an incident.

---

## 5. Staging

There is **no staging environment**, and the steps above go straight from a
local machine to production.

For a demo that is proportionate. For anything with real data it is not,
because the one operation you most want to rehearse — a migration against
realistic data — is the one with no rehearsal space.

The cheap version, if a pilot happens:

1. A second Vercel project pointed at a **Neon branch** of production rather
   than a separate database. Branches are copy-on-write, so this is close to
   free and the data is realistic by construction.
2. Deploy there first, run `npm run db:migrate` against the branch, boot the
   app, and confirm the console renders before touching production.
3. `JEEVES_COOKIE_SECRET` must differ between the two, and `OPENAI_API_KEY` should
   be unset on staging unless a specific test needs it — the daily token
   budget is per database, so a staging branch has its own cap and its own
   bill.

Note that a Neon branch shares the parent's data at the moment of branching,
including anything sensitive. In this demo everything is synthetic, so it is
moot — but that stops being true the moment it is not a demo.

---

## 6. Demo-day checklist

Run through this the morning of a demo, in order:

1. **Seed fresh.**
   ```bash
   DATABASE_URL="<Neon pooled connection string>" npm run db:seed
   ```
   Confirms a clean, deterministic 12-initiative dataset.

2. **Verify `/audit` queries.** Visit `/audit` and run all four canned
   queries (`lib/data/dto.ts` → `CannedAuditQueryId`):
   - `member-facing-phi`
   - `approved-by-torres`
   - `overdue-controls`
   - `q01-control-changes`

   Confirm `member-facing-phi` returns exactly 4 rows (per the Playwright
   golden path assertion in `tests/e2e/golden-path.spec.ts`) and every row
   links to its decision/control/audit evidence.

3. **Run the champion loop once on the mock adapter.** With
   `OPENAI_API_KEY` unset, walk the champion storyline end-to-end
   (intake → triage → 4 drafted reviews → sign-off → conditional approval
   → effective controls) to confirm the live loop works without any
   external LLM dependency. This is also what CI/Playwright exercises.

4. **Then, optionally, set `OPENAI_API_KEY`** (and `OPENAI_MODEL` if you
   want a specific model) if you want genuinely live-generated draft text
   during the walkthrough, understanding the budget-cap caveat in §3(c).

5. **Walk the beats in `docs/demo-script.md`.** That document has the full
   15-minute stakeholder talk track, screen-by-screen, including
   anticipated questions and answers — use it as the actual run-of-show.

6. **Reset before the next audience** if you mutated anything live: re-seed
   (step 1) to restore the deterministic baseline.
