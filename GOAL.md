# GOAL.md — Overnight Autonomous Build Directive (Jeeves)

**Authorized by:** Roshan (repo owner), 2026-07-11, before going to sleep.
**You are:** the orchestrator (Claude) continuing an already-approved build. The Plan-First Gate
was satisfied 2026-07-11 (human GO: full breadth, 1–2 week budget). Do NOT wait for further
human input — work through the mission until done or blocked, then write the morning report.

## 0. Read these first, in order
1. `plan.md` — approved spec (v2 + GO amendments + P0 gate decision)
2. `AGENTS.md` — 9 hard rules (inviolable) + stack
3. `agents-build-log.md` — tail 6 entries = current state
4. `docs/seed-spec.md` (esp. §2.1), `docs/intake-spec.md`, `docs/ui-spec.md`, `docs/policies/INDEX.md`
5. Harness task list (tasks #1–#8 map to plan §9/§13 phases)

## 1. State snapshot (as of 2026-07-11 ~05:00Z)
- `main`: docs/specs complete (seed, intake, ui, demo script, policy corpus). Latest commit ~`06b1753`+.
- `claude-worktree` @ `da57f46`: **verified** pure domain logic — lib/{domain,triage,approval,controls,lifecycle}, 114 tests, 100% coverage.
- `codex-worktree`: Next.js scaffold ~90% done (a resumed Sonnet worker may still be finishing:
  package.json scripts, lib/agents/ports.ts, .env.example, home page, lib/db/schema.ts placeholder).
  Verify its state before building on it; finish those 5 items yourself if the worker died.
- **P0 gate DECIDED: FALLBACK — Vercel AI SDK + Workflow SDK.** Never introduce eve.
- Codex model note: `gpt-5.6-terra-mini` is NOT supported on this account — use Codex default model
  via the `codex:codex-rescue` agent, or Sonnet workers.

## 2. Mission (in order; each step gated on the previous)
1. **Close task #1 (P0):** verify scaffold acceptance (lint/test/build/boot on PORT=3111), commit it
   on codex-worktree, then merge codex-worktree AND claude-worktree into main (expect a
   package.json/lockfile union-merge — keep the scaffold's Next.js deps plus the lib branch's vitest
   family; re-run full suite after merge). Fast-forward both worktrees to the merged main.
2. **Task #2 (P1):** Drizzle schema per plan §5 (uniqueness constraints; AuditEvent append-only via
   DB trigger in a migration), deterministic seed implementing docs/seed-spec.md exactly (champion
   = UNSUBMITTED intake draft; breach series must cross Q-01 with ≥3 sustained points), read-only
   initiative-centric UI per docs/ui-spec.md (home board, initiative detail tabs, role switcher,
   outcome metrics). Tests: plan §8 #1-2, 6, 9-11 (extend the existing 114).
3. **Task #3 (P2):** intake form per docs/intake-spec.md → live triage (reuse lib/triage) →
   WorkflowPort fan-out drafting 4 domains (RAI, Privacy/HIPAA, Clinical Safety, Legal) with
   MOCKED AgentPort output citing real MP-§ anchors → reviewer sign-off → conditional approval
   (named accountable approver) → versioned effective controls. Build the real OpenAI AgentPort
   adapter (AI SDK `generateText` + `Output.object`, model from env) but wire tests + demo path
   to the mock; live calls activate only when OPENAI_API_KEY exists at runtime.
4. **Task #4 (P3):** Run-monitor action (reuse lib/controls/evaluate) → idempotent breach →
   deployment paused → reassessment cycle; two admin actions (Q-01 threshold change, pause/resume)
   with mandatory reasons + audit events. Tests §8 #4-7.
5. **Task #5 (P4/P5) — partial:** structured audit query (4 canned queries from seed-spec §7),
   public read-only mode + passcode-gated demo workspace + atomic budget + rate limits,
   Playwright golden path (champion steps 1–6). STOP before the actual Vercel deploy.
6. If time remains: start task #6 (M2) — extend reviewer fan-out to all 8 domains (mocked).

## 3. Operating rules
- **Delegate implementation** to workers (Codex default model or Sonnet; Haiku for mechanical),
  one self-contained task each. **Verify everything yourself**: run the tests, read key diffs.
  Commit only verified work; descriptive messages; stage explicit paths; never `git add -A`.
- TDD throughout; ALL LLM calls mocked in tests; keep lib/ coverage >80% (it is currently 100%).
- Append to `agents-build-log.md` every round (standard format). Update harness task statuses.
- If a worker dies (API overload etc.), resume it via SendMessage with a precise finish-list —
  that has worked twice tonight.
- **DB without credentials:** no DATABASE_URL is available overnight. Use PGlite (or SQLite-free
  in-memory pg equivalent) behind the same Drizzle schema for dev/tests; the schema must remain
  Neon/Postgres-compatible. Document the swap point. Do NOT sign up for any service.
- Context hygiene: if context exceeds ~50%, run /context-summarizer before continuing.

## 4. Hard limits (violating any of these = stop and write the morning report instead)
- No `git push`, no remotes, no deploys, no external service signups, no real API keys, never
  touch `.env*` (only `.env.example`).
- Do NOT kill processes you didn't start — the machine runs unrelated `next dev` servers
  (eveagents, mapencroach, ports ~3000+). Use PORT=3111 for boot checks.
- No destructive git (reset --hard, force anything, checkout . , clean).
- Fictional data only; no real-org names anywhere (grep before committing docs/UI copy).
- AGENTS.md hard rules 1–9 apply to every line of code (agents never approve; SoD; append-only
  audit at DB level; labeled synthetic telemetry; idempotency; state transitions in app code).

## 5. Blocked? 
Log the blocker in the build log, add it to the morning report, mark the harness task
appropriately, and MOVE ON to the next non-dependent piece of work. Never idle-wait on a worker:
if one goes silent >20 min with no disk activity, resume or replace it.

## 6. Morning report (mandatory final act)
Write `docs/MORNING-REPORT.md`: commits per branch (hash + one-liner), test counts + coverage,
tasks closed, screenshots-worthy states to demo, blockers, judgment calls made overnight, and a
short "Needs Roshan" list — expected items: Neon DATABASE_URL, OPENAI_API_KEY + OPENAI_MODEL
choice, DEMO_PASSCODE value, Vercel deploy approval (task #5 remainder), and review of any
disagreements between agents (per tie-breaker rule, none may be resolved unilaterally).

**End state that counts as success:** tasks #2–#4 completed and merged green on main; #5
dev-complete except deploy; morning report written.
