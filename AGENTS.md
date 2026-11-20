# Jeeves — Agent Rules (repo root, loaded by Codex)

Global rules: `~/.codex/AGENTS.md` applies in full. Project-specific rules below take precedence.

## Project
Jeeves — AI Governance Gateway demo for a fictional healthcare payer ("Meridian Health").
**`plan.md` is the authoritative spec** (v2 + GO amendments: full v1 breadth, 1–2 week budget,
fast-lane autonomy reframe confirmed by human 2026-07-11). Log every round to `agents-build-log.md`
in the standard entry format. Default collaboration: Codex implements, Claude reviews.

## Stack
- Next.js 16 (App Router) + TypeScript, Tailwind + shadcn/ui, Recharts.
- **Vercel AI SDK** (default) + optional OpenAI Agents SDK (`JEEVES_AGENT_RUNTIME`) behind the app-owned `AgentPort`; application-owned bounded draft fan-out. With `OPENAI_API_KEY` unset the deterministic offline mock adapter runs. Workflow SDK was proposed at P0 but is not implemented; do not introduce eve. `agents/` holds prompt and output-contract Markdown (our own convention, no code).
- PostgreSQL through Drizzle ORM: PGlite in unit tests and local dev with no URL, node-postgres or the Neon serverless driver at runtime (`lib/db/driver-select.ts`). Hosted databases in use include Supabase and Neon; `deploy/podman/` holds Podman container templates.
- OpenAI GPT-5.x runtime LLM via env `OPENAI_MODEL`; ALL LLM calls mocked in tests.
- Tests: Vitest (jsdom, PGlite) and Playwright.

## Commands
npm is the toolchain.
- `npm test` (Vitest) · `npm run test:e2e` (Playwright golden path) · `npm run lint` · `npm run typecheck`
- `npm run db:migrate` applies migrations · `npm run test:postgres` runs the real-PostgreSQL integrity suite.
- `npm run db:seed` and `npm run reset:demo` are DESTRUCTIVE and demo-only: they delete visitor workspaces and the audit log, and refuse unless `JEEVES_MODE=demo`. Never run them against a shared or hosted database, or with a `DATABASE_URL` you did not set yourself.
- `npm run smoke:production` smoke-tests a production-mode build.

## Layout
- `app/` Next.js routes (`app/(console)`, `app/(marketing)`, `app/api`) · `agents/` prompt directories · `lib/` domain logic (>80% coverage target) · `components/` UI · `scripts/` (seed, migrate, reset, smoke) · `drizzle/` migrations · `deploy/` container templates · `tests/` and `*.test.ts` beside code.
- Reference docs: `docs/deploy.md`, `docs/deploy-podman.md`, `docs/environment-reference.md`, `docs/security-model.md`, `docs/production-readiness.md`, `docs/ARCHITECTURE.md`. `docs/archive/` is historical, not guidance.

## Deployment modes
`JEEVES_MODE` (`lib/config/deployment-mode.ts`) is `demo` or `production`, and **defaults to production**: only exactly `demo` selects demo. Local development, tests and CI set `JEEVES_MODE=demo`.
- **Demo**: passwordless personas, the playground, the real-request door, `/operator`, cron.
- **Production**: no personas, playground, public intake, operator queue or cron; every demo door answers a bare 404. Boot checks (`lib/config/boot-checks.ts`, run from `instrumentation.ts`) refuse to start unless the production settings are complete, and the installation stamp in the database refuses a database made for the other mode. Single sign-on is not built yet. Settings and what is refused: `docs/environment-reference.md`, `docs/deploy.md`, `docs/security-model.md`.

## Hard Rules (from the Codex plan review — do not violate)
1. Agents draft, recommend, route, and flag missing evidence — they NEVER approve. Low-risk fast-lane = deterministic pre-approved policy with a named accountable approver.
2. Public visitors may start a passwordless demo session and choose fictional personas. Every mutation/LLM endpoint requires a valid session with a non-null isolated workspace, atomic `run_budget` check where applicable, rate limit and input length caps. Visitor sessions cannot mutate shared seed records or global control defaults. Human authorization: 2026-09-19, "lets visitors play".
   A second, separate door exists for REAL requests (human decision 2026-09-26): `/api/public-session` issues a `public`-role session in a `public-` workspace that can only create, edit and submit an intake (`runMutationGuard` denies `public` unless a route passes `allowPublic: true`). Those requests are read by the site's operators at `/operator` via `/api/public-intake`, which is gated by the server-side `OPERATOR_TOKEN` and must never be gated by persona role — every persona is available to every visitor. A `public` session must never donate its workspace to a persona switch.
3. `AuditEvent` is append-only at the DB level: triggers refuse UPDATE, DELETE and TRUNCATE (migrations 0002 and 0014), not just app code. The role that owns the table can still disable them, so production installs run the app as a non-owner role (see docs/deploy.md); do not describe this as a privilege-level guarantee.
4. Authoritative state transitions live in application code + Postgres — never inside eve/fallback adapters. Adapters implement app-owned `AgentPort` types only.
5. Separation of duties: Admin never approves or rejects an initiative, never signs a review, and never approves or rejects a control exception (those are Approver-only; renewal requests stay open to anyone with a stake). What Admin can do today:
   - change an eval threshold, pause a deployment, resume it (`/api/admin/threshold`, `/api/admin/deployments/[id]/pause|resume`), each with a required reason and a before/after audit event; a resume after an approved reassessment is the `deploy` transition;
   - revoke an approved control exception, and roll back a deployment version (the Approver can too), each with a reason;
   - open QC (`start_qc`) and return an intake to the requester from QC (reason required); the Program persona can do both as well (the open-QC action takes no reason);
   - run triage (shared with Program) and start a draft run (shared with Requester).
   The state machine in `lib/lifecycle/transitions.ts` also lets Admin `retire`, and `deploy` an approved initiative, but no route or button exposes those today. Check that file before changing this list.
6. All synthetic telemetry labeled "Synthetic data — demo" with connector-status chips. No imitation third-party panels, no dead deep links.
7. Idempotency: seed, sign-off retry, monitor re-runs — no duplicate incidents/reviews. Uniqueness constraints per plan §5.
8. TDD: failing test first; LLM calls mocked; one Playwright golden-path test is required, not optional.
9. Seeded, playground and synthetic-telemetry data is fictional ("Meridian Health") — nothing implying real Optum/UHC affiliation, and no real PHI is ever stored or sent to an LLM. The one exception is the real-request queue of rule 2 (`/api/public-session`, `/operator`), which stores what visitors type: names, e-mail addresses and free text. Treat those rows as personal data (see docs/deploy.md); never copy them into staging or seed over them.

10. Production mode is the default. Every demo-only route handler calls `demoDoorClosed()` first (and lists any extra method in `demoDoorFallbacks`); demo-only code reached another way calls `assertDemoMode`. Copy that names the fictional payer, a demo persona or a demo default belongs behind the deployment-mode check.
11. Never weaken a boot check or the installation stamp to make something start. If production refuses to boot, fix the configuration.
12. Never run `db:seed`, `reset:demo` or a restore against a shared or hosted database, and never from a shell whose `DATABASE_URL` you did not set for that purpose.

## Branches
- `main` production-ready only · `codex-worktree` (Codex) · `claude-worktree` (Claude). Reviewer diffs against `main` before merge; human approves merges.
