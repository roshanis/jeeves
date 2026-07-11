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
DATA_PROVIDER=db DEMO_PASSCODE=<choose-a-passcode> npm run dev
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
- `DEMO_PASSCODE=<choose-a-passcode>` gates the live/mutable demo workspace
  (see §3). Pick any non-empty string for local use.

What you'll see at `http://localhost:3000`:

- A read-only portfolio board of **12 seeded initiatives** (tiers, states,
  the outcome-metrics strip) — browsable with no passcode.
- A **"Run the live loop"** entry point that requires the demo passcode
  before any mutation (intake edits, triage, draft-run, sign, decide,
  monitor run, admin actions). Public visitors without the passcode stay
  strictly read-only — there is no unauthenticated mutation endpoint.
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
npm test            # vitest run (438 tests as of this writing)
npm run test:e2e    # playwright test (5 tests; boots its own dev server on :3117)
npm run build        # next build
npm run start        # next start (after build)
```

---

## 2. Vercel deploy steps

1. **Import the project** into Vercel from this repository (Next.js is
   auto-detected; framework preset "Next.js", no custom build command
   needed — `next build` / `next start` are the defaults and match
   `package.json`).
2. **Provision a Neon Postgres database** (or use an existing Neon project)
   and copy its **pooled** connection string.
3. **Set environment variables** in the Vercel project settings:

   | Variable | Required | Notes |
   |---|---|---|
   | `DATABASE_URL` | Yes | Neon Postgres connection string. Use the **pooled** connection string form (`...neon.tech/...?sslmode=require`), matching `.env.example`. Read by `lib/db/client.ts` via `@neondatabase/serverless` (`neon-http` driver) whenever it is set. |
   | `DATA_PROVIDER` | Yes | Set to `db`. Without `DATABASE_URL` this would fall back to PGlite/mock — you want the Neon-backed provider in production. |
   | `DEMO_PASSCODE` | Yes | Gates the live/mutable demo workspace (`app/api/session/route.ts` reads it directly via `process.env.DEMO_PASSCODE`). Pick something you're comfortable pasting into a browser prompt in front of an audience — it is not a secret-grade credential, but treat it like one anyway (see §3). |
   | `OPENAI_API_KEY` | Optional | Only set this if you want **live** LLM-drafted reviews during the demo. Omit it and the app runs entirely on the keyless mock adapter — safe default for a public URL. |
   | `OPENAI_MODEL` | Optional (only meaningful with `OPENAI_API_KEY`) | Model id for the real adapter, e.g. the value in `.env.example` (`gpt-5.1`). Unused when `OPENAI_API_KEY` is unset. |

4. **Seed Neon before the demo.** There is no seed step that runs on Vercel
   itself — Vercel serves the app, it does not run one-off scripts. Seed
   Neon from your local machine, pointed at the same database Vercel uses:

   ```bash
   DATABASE_URL="<your Neon pooled connection string>" npm run db:seed
   ```

   Re-running this is safe for local iteration — the seed script is
   deterministic and intended to run against a clean schema per
   `docs/seed-spec.md`. If you need a totally fresh demo dataset, reset the
   Neon branch/schema first, then re-seed. Do not seed against a database
   that is currently serving a live demo audience mid-session.

5. **Run migrations against Neon first, then seed.** `drizzle.config.ts`
   requires `DATABASE_URL` to be set at invocation time (it throws a clear
   error otherwise). From your local machine:

   ```bash
   DATABASE_URL="<your Neon pooled connection string>" npx drizzle-kit push
   ```

   (or `migrate`, depending on which workflow you prefer — either way this
   runs locally against Neon, not on Vercel.) This must happen before
   `npm run db:seed` against the same database, since seeding assumes the
   schema — including the append-only `AuditEvent` trigger in
   `drizzle/0002_audit_events_append_only.sql` — already exists.

6. **Playwright is NOT run on Vercel.** `npm run test:e2e` boots its own
   `next dev` server on a fixed local port (3117) and is a local/CI-only
   check (see `playwright.config.ts`). Vercel's build step only runs
   `next build`; do not wire Playwright into the Vercel build or deploy
   pipeline.

7. **Deploy.** Once env vars are set and Neon is migrated + seeded, trigger
   the Vercel deploy (push to the connected branch, or deploy from the
   Vercel dashboard/CLI). Visit the deployed URL and confirm the portfolio
   board renders the 12 seeded initiatives before sharing the link further.

---

## 3. KNOWN GAPS — read this before you rely on this in production

This section is deliberately blunt. These are real limitations in the
current code, not hypothetical ones.

> **(a) Neon HTTP transactions are not real transactions.**
> `lib/db/client.ts` uses `drizzle-orm/neon-http` (the `@neondatabase/serverless`
> HTTP driver) whenever `DATABASE_URL` is set. That driver's `transaction()`
> method does **not** wrap statements in `BEGIN`/`COMMIT`/`ROLLBACK` — see the
> caveat documented in `lib/services/initiative-service.ts` (top-of-file
> comment) and `node_modules/drizzle-orm/neon-http/session.d.ts`. Every
> state-changing service call (`lib/services/initiative-service.ts`,
> `monitor-service.ts`, `admin-service.ts`) calls `db.transaction(fn)`
> uniformly, and that call **is** a real, rollback-on-throw transaction
> under PGlite (all tests, and local/dev without `DATABASE_URL`) — but it is
> **not** atomic under the Neon HTTP driver in production. A partial write
> (e.g. initiative state changes but the paired `AuditEvent` insert fails)
> is theoretically observable against real Neon today.
> **Before any production Neon writes**, swap `lib/db/client.ts` to a
> pooled/websocket Neon driver that supports real HTTP-safe transactions
> (e.g. `drizzle-orm/neon-serverless` over `@neondatabase/serverless`'s
> `Pool`, or another driver with genuine `BEGIN`/`COMMIT` support). The
> call sites in the services layer are already written against the
> `db.transaction(fn)` interface and should not need to change shape.

> **(b) Route-guard state (session, rate limit, budget) is in-memory, per
> instance.**
> `lib/security/session.ts`, `lib/security/rate-limit.ts` (`TokenBucketRateLimiter`),
> and the `InMemoryBudgetStore` in `lib/security/budget.ts` all keep their
> state in process memory (a `Map`), not in Postgres. This is fine for a
> **single-instance** deployment — one Vercel serverless region/function
> instance serving the demo. It is **not** fine for multi-region or
> multi-instance deployment: a visitor could get a fresh rate-limit bucket
> or a fresh daily budget just by landing on a different instance, and a
> session token issued by one instance won't validate against another's
> memory. If you ever scale this past a single instance, these three need a
> shared backing store (the `BudgetStore` interface is already designed to
> be swapped for a DB-backed `RunBudget` implementation per plan.md §5;
> session/rate-limit would need the equivalent).

> **(c) Public URL cost exposure — mitigations already in place, and what
> to verify before sharing the link.**
> In place today:
> - Public visitors are strictly **read-only**; there is no unauthenticated
>   mutation endpoint (`AGENTS.md` hard rule 2).
> - The live/mutable workspace requires the `DEMO_PASSCODE` you set
>   (`app/api/session/route.ts`), and issues a session token scoped to an
>   isolated demo workspace (`lib/security/session.ts`).
> - An atomic daily token-budget check (`lib/security/budget.ts`, `reserve()`)
>   caps total LLM usage per day, serialized per day-key so concurrent
>   requests can't race past the cap.
> - Per-client rate limiting (`lib/security/rate-limit.ts`, token bucket).
> - Input length caps (`lib/security/input-limits.ts`).
> - **The keyless mock adapter is the default.** Unless you explicitly set
>   `OPENAI_API_KEY`, no request — passcode or not — ever calls a real LLM
>   provider, so there is no OpenAI bill exposure from a shared public URL
>   at all.
>
> Verify before sharing the URL:
> - Confirm whether `OPENAI_API_KEY` is set on the deployment. If it is,
>   understand that (given gap (b)) the daily budget cap is **per instance**,
>   not truly global — size your expectations accordingly, or unset the key
>   for a fully public link and only set it for a controlled live session.
> - Confirm `DEMO_PASSCODE` is actually set (not the `.env.example`
>   placeholder) — an empty/misconfigured passcode falls back to `""`,
>   which `app/api/session/route.ts` will simply fail closed against a
>   non-empty submitted passcode, but don't rely on that; set it explicitly.
> - Don't seed against a database that's serving a live public demo (see
>   §2 step 4).

---

## 4. Demo-day checklist

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
