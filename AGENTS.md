# Jeeves — Agent Rules (repo root, loaded by Codex)

Global rules: `~/.codex/AGENTS.md` applies in full. Project-specific rules below take precedence.

## Project
Jeeves — AI Governance Gateway demo for a fictional healthcare payer ("Meridian Health").
**`plan.md` is the authoritative spec** (v2 + GO amendments: full v1 breadth, 1–2 week budget,
fast-lane autonomy reframe confirmed by human 2026-07-11). Log every round to `agents-build-log.md`
in the standard entry format. Default collaboration: Codex implements, Claude reviews.

## Stack
- Next.js (App Router) + TypeScript, Tailwind + shadcn/ui, Recharts
- **Vercel AI SDK** (default) + optional OpenAI Agents SDK behind `AgentPort`; application-owned bounded draft fan-out. Workflow SDK was proposed at P0 but is not implemented; do not introduce eve. `agents/` directory-per-agent layout is our own convention.
- Neon Postgres + Drizzle ORM (one dev branch + isolated test schema; no Docker)
- OpenAI GPT-5.x runtime LLM via env `OPENAI_MODEL`; ALL LLM calls mocked in tests

## Commands
- `npm test` (Vitest) · `npm run test:e2e` (Playwright golden path) · `npm run lint` · `npm run typecheck` · `npm run db:seed`
- npm is the toolchain (pnpm is not installed on this host — decided at P0).

## Layout
- `app/` Next.js routes · `agents/` prompt directories · `lib/` domain logic (>80% coverage target) · `scripts/seed.ts` · `tests/`

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

## Branches
- `main` production-ready only · `codex-worktree` (Codex) · `claude-worktree` (Claude). Reviewer diffs against `main` before merge; human approves merges.
