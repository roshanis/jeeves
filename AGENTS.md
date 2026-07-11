# Jeeves — Agent Rules (repo root, loaded by Codex)

Global rules: `~/.codex/AGENTS.md` applies in full. Project-specific rules below take precedence.

## Project
Jeeves — AI Governance Gateway demo for a fictional healthcare payer ("Meridian Health").
**`plan.md` is the authoritative spec** (v2 + GO amendments: full v1 breadth, 1–2 week budget,
fast-lane autonomy reframe confirmed by human 2026-07-11). Log every round to `agents-build-log.md`
in the standard entry format. Default collaboration: Codex implements, Claude reviews.

## Stack
- Next.js (App Router) + TypeScript, Tailwind + shadcn/ui, Recharts
- Vercel eve agent framework (or Vercel AI SDK + Workflow SDK fallback — decided at P0 spike; check the build log for the spike verdict)
- Neon Postgres + Drizzle ORM (one dev branch + isolated test schema; no Docker)
- OpenAI GPT-5.x runtime LLM via env `OPENAI_MODEL`; ALL LLM calls mocked in tests

## Commands
- `pnpm test` (Vitest) · `pnpm test:e2e` (Playwright golden path) · `pnpm lint`

## Layout
- `app/` Next.js routes · `agents/` eve agents-as-directories · `lib/` domain logic (>80% coverage target) · `scripts/seed.ts` · `tests/`

## Hard Rules (from the Codex plan review — do not violate)
1. Agents draft, recommend, route, and flag missing evidence — they NEVER approve. Low-risk fast-lane = deterministic pre-approved policy with a named accountable approver.
2. Public visitors are read-only. Every mutation/LLM endpoint requires demo passcode + isolated demo workspace + atomic `run_budget` check + rate limit + input length caps.
3. `AuditEvent` is append-only at the DB level (role permissions/trigger), not just in app code.
4. Authoritative state transitions live in application code + Postgres — never inside eve/fallback adapters. Adapters implement app-owned `AgentPort`/`WorkflowPort` types only.
5. Separation of duties: Admin cannot approve initiatives or sign reviews. Admin's two live actions (eval-threshold change, pause/resume) require a reason and write audit events.
6. All synthetic telemetry labeled "Synthetic data — demo" with connector-status chips. No imitation third-party panels, no dead deep links.
7. Idempotency: seed, sign-off retry, monitor re-runs — no duplicate incidents/reviews. Uniqueness constraints per plan §5.
8. TDD: failing test first; LLM calls mocked; one Playwright golden-path test is required, not optional.
9. Fictional data only ("Meridian Health") — nothing implying real Optum/UHC affiliation, no real PHI/PII ever.

## Branches
- `main` production-ready only · `codex-worktree` (Codex) · `claude-worktree` (Claude). Reviewer diffs against `main` before merge; human approves merges.
