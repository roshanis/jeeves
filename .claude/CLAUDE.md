# Global Agent Guidelines — Vibecode Like a Boss

> Keep this file under 200 lines. Last updated: 2026-07-08

---

## 1. Safety Rules (Non-Negotiable)

These apply before any other instruction.

- **Never delete, overwrite, or move files without explicit human approval + git backup.**
- **Never share API keys, secrets, or sensitive data.** If you see them, redact and warn.
- **Always think step-by-step before acting.** (Plan requirements are in §2.)
- **Never run untrusted scripts, or calls that send project code/data to external services, without human review.**
- **Never take irreversible actions without confirmation** — git force-push, rm -rf, DROP TABLE, kill -9, etc.

### File Operations
- Show exactly what will be affected before deleting or overwriting anything
- When in doubt, copy to a `.backup` or use `git stash` — never just delete
- Never modify `.env`, secrets files, or credentials without explicit instruction

### Git Safety
- Never `git push --force` to main/master without explicit confirmation
- Never `git reset --hard`, `git clean -f`, or `git checkout .` without confirming
- Never amend a commit that has already been pushed
- Never revert user changes unless explicitly asked
- Before any destructive git op: show the user the diff first

### Data & Processes
- Never DROP tables, TRUNCATE, or bulk DELETE without showing scope first
- Never `kill`/`pkill` processes without confirmation
- Never modify CI/CD pipelines or shared infrastructure without discussion

---

## 2. Plan-First Gate

**For non-trivial changes (multi-file, destructive, or architectural), output this before touching code:**

```
## Plan

1. [File: path/to/file] — What will change and why
2. [File: path/to/test] — Tests that will be written first (TDD)
3. [File: ...] — ...

## Tests
- [ ] Test A covers scenario X
- [ ] Test B covers edge case Y

## Risk
- [Any destructive actions, external calls, or permission needs]

Waiting for human GO signal (or reviewer feedback) before proceeding.
```

Do not write code until the human replies "GO" or a reviewer agent approves.

Skip the gate when: the user has already approved a plan, the session runs in auto-accept/plan-approved mode, or the user invoked a skill/command whose purpose is implementation (e.g. /tdd-guardian). Trivial fixes (typos, one-liners) don't need it.

---

## 3. Model & Cost Routing

Expensive models (Fable, Opus) are **orchestrators, not workers**. Route the bulk of the work to cheaper executors; spend premium tokens only on judgment.

### Orchestrator (Fable/Opus) handles directly
- Plans, architecture decisions, and the Plan-First Gate
- Reviewing and verifying delegated work before accepting it
- Tie-breaking, risk calls, and anything that needs full conversation context
- Trivial edits where delegating costs more than doing it (typos, one-liners)

### Delegate everything else
- **Substantial implementation, debugging, root-cause hunts** → Codex (`codex:codex-rescue` agent or `/codex:rescue`) — uses Codex quota, not Claude tokens
- **Standard implementation, refactors, test writing** → Agent tool with `model: "sonnet"`
- **Codebase searches, exploration, mechanical/bulk edits** → Agent tool with `model: "haiku"` (use the Explore agent for read-only searches)

### Delegation rules
- Subagents start cold: write self-contained prompts — file paths, constraints, acceptance criteria, and what to report back
- Never accept delegated work unverified: the orchestrator reads the diff and runs the tests (TDD rules in §5 still apply)
- One clear task per delegation
- If Codex is unavailable, fall back to Sonnet; escalate to the orchestrator model only after a worker has failed twice

---

## 4. Dual-Agent Workflow

When operating alongside another agent (Codex, Cursor, Grok):

### Shared Build Log
- All agents append to `agents-build-log.md` in the project root
- Format every entry as:
  ```
  ## [AGENT: Claude|Codex|Cursor|Grok] [ISO 8601 timestamp, e.g. 2026-07-05T14:30Z]
  ### Action: <what was done>
  ### Files changed: <list>
  ### Diff summary: <key changes>
  ### Recommendations / Next steps:
  ```
- Before each action, read log entries added since your last entry (plus the latest reviewer entry) to stay in sync

### Role: Reviewer
- When acting as reviewer: read Codex's log entries → output numbered recommendations → append to log
- When acting as implementer: read reviewer feedback → iterate → append result to log

### Tie-breaker
- If Claude and Codex disagree: surface the disagreement to the human with both positions clearly stated. Don't resolve unilaterally.

---

## 5. TDD — Non-Negotiable

Even for POCs.

1. Write failing test first
2. Implement until test passes
3. Run full test suite
4. Fix any regressions
5. Reviewer verifies >80% coverage on changed files

Exception: for docs/config-only work, run lightweight checks (lint, format/link validation) instead of inventing tests.

---

## 6. Git Worktrees

Each agent operates in its own worktree:
- Codex → `codex-worktree` branch
- Claude → `claude-worktree` branch

Commit only when requested or required. Stage reviewed files explicitly (no blanket `git add -A`) and use a descriptive message.

Reviewer runs `git diff <target-branch>...HEAD` (usually `main`) and reviews before any merge.

---

## 7. Context Management

When context usage exceeds 50%: run `/context-summarizer` to compact and preserve key decisions before continuing.

---

## 8. Code Quality

- No security vulnerabilities (XSS, SQLi, command injection, OWASP Top 10)
- Only validate at system boundaries — trust internal code
- Minimum complexity for the task — no premature abstractions
- No placeholder/stub code left in — finish or clearly mark `TODO:` with a ticket reference

---

## 9. Communication

- Flag blockers and unexpected findings immediately
- Be concise — lead with the answer, not the reasoning
- Surface all risky actions with risk level and safer alternatives

---

## Project Overrides

<!-- AGENTS.md (repo root) is the single source for project facts: stack, layout,
deployment modes and the full hard rules. This section mirrors only the commands
and the hard rules, so the two files cannot disagree. Change AGENTS.md first. -->

### Project
Jeeves — AI Governance Gateway demo for a fictional healthcare payer ("Meridian Health").
`plan.md` is the authoritative spec; **`AGENTS.md` is the single source** for how the repo
works today (stack, directories, the two deployment modes, hard rules). Read it before
changing code. `JEEVES_MODE` defaults to production; tests and local dev set `demo`.

### Commands (npm is the toolchain)
- `npm test` (Vitest) · `npm run test:e2e` (Playwright golden path) · `npm run lint` · `npm run typecheck`
- `npm run db:migrate` · `npm run test:postgres` (real-PostgreSQL integrity suite)
- `npm run db:seed` and `npm run reset:demo` are destructive and demo-only: never against a shared or hosted database.

### Hard Rules (mirror of AGENTS.md — see it for the full wording)
- Agents draft/recommend/route — they NEVER approve. Admin never approves initiatives or exceptions (rule 5 lists what Admin can do).
- Two doors, never mixed: the playground (any persona, isolated workspace, no passcode) and the real-request door (`public`-role session in a `public-` workspace; `runMutationGuard` denies `public` by default and exactly three routes pass `allowPublic: true`: create initiative, edit intake draft, submit intake, pinned by app/api/__tests__/mutation-gate-inventory.test.ts; never mint public sessions as `requester`). A `public` session never donates its workspace to a persona switch, and `issueDemoSession` never puts a persona session in a `public-` workspace. The real-request queue (`/operator`, `/api/public-intake`) is gated by `OPERATOR_TOKEN`, never by persona role (guarded by app/api/__tests__/public-submission.test.ts).
- Every mutation endpoint requires a valid session with a non-null isolated workspace, plus an atomic budget check where applicable.
- `AuditEvent` is append-only through database triggers; the table owner can still disable them, so production runs the app as a non-owner role. State transitions live in app code + Postgres, never in agent adapters.
- Seeded and playground data is fictional and synthetic telemetry is labeled "Synthetic data — demo"; the real-request queue stores real names, e-mail addresses and free text. No fake integrations or dead deep links.
- Production mode is the default: demo-only routes call `demoDoorClosed()` first; never weaken a boot check or the installation stamp.

### Branch Strategy
- main: production-ready only
- claude-worktree: Claude's branch
- codex-worktree: Codex's branch
