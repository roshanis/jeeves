# Agents Build Log

**Project**: Jeeves — AI Governance Gateway demo (fictional payer "Meridian Health")
**Started**: 2026-07-10
**Stack**: Next.js + TypeScript · Vercel eve (or AI SDK fallback per P0 spike) · Neon Postgres + Drizzle · OpenAI GPT-5.x
**Spec**: plan.md (authoritative)

<!-- Both agents append entries here chronologically, standard format per root AGENTS.md. -->

---

## [AGENT: Codex] [2026-07-11T00:53Z]
### Action: Reviewed Claude's product brief and implementation plan; no implementation started
### Files changed: agents-build-log.md
### Diff summary: Added the required review-round log entry only
### Recommendations / Next steps:
- Revise plan.md to narrow the three-day demo to one end-to-end governance case.
- Resolve public-demo mutation controls, accountable approval, domain control catalog, lifecycle versioning, and Eve spike ordering before human GO.

## [AGENT: Claude] [2026-07-11T01:15Z]
### Action: Rewrote plan.md as v2 incorporating all 10 Codex findings; no code written
### Files changed: plan.md
### Diff summary: Adopted Codex three-day cut (one champion end-to-end case, 10-12 seeded initiatives, 4 live review domains); one initiative-centric UI with role switcher replacing five persona apps; public demo read-only + passcode-gated isolated workspace with atomic budget/rate limits; auto-approve reframed as deterministic fast-lane under pre-approved policy with named accountable approver; Admin limited to two audited actions with separation of duties; control catalog across all 8 domains with policy/evidence/exception fields; versioned domain model (Initiative/IntakeVersion/RiskAssessment/ReviewCycle/ReviewDecision/DeploymentVersion/ControlDefinition/EffectiveControl/Observation/Incident) with registry as a view; DB-level append-only audit enforcement; synthetic telemetry labeled with connector status, RL reframed as version promotion + provenance; eve spike moved to P0 with either/or gate and AgentPort/WorkflowPort seams; Playwright golden path required; tie-break authority removed (disagreements go to human); v1 scope preserved as deferred backlog.
### Recommendations / Next steps: Two owner decisions surfaced in plan §12 (confirm three-day cut; confirm fast-lane reframe). Awaiting human GO. P0 will add git init + root AGENTS.md per Codex F10.

## [AGENT: Claude] [2026-07-11T01:40Z]
### Action: Human GO received; vibecode-init executed; plan.md amended with §13 milestone map
### Files changed: plan.md (status + §13), AGENTS.md (new, root — operative Codex rules), .claude/CLAUDE.md, .claude/settings.json, .claude/agents/{code-reviewer,security-reviewer}.md, .codex/agents.md (pointer), .gitignore, agents-build-log.md (header)
### Diff summary: Owner decisions — (1) full v1 breadth restored on 1–2 week budget, structured as milestones M1 champion vertical / M2 breadth / M3 telemetry depth / M4 hardening; (2) fast-lane reframe confirmed (agents never approve). Repo git-initialized; root AGENTS.md carries the 9 hard rules from the Codex review.
### Recommendations / Next steps: Initial commit on main; create codex-worktree + claude-worktree; start M1-P0 (Next.js scaffold via Sonnet worker, eve spike via Codex) with the 2h either/or gate.

## [AGENT: Claude] [2026-07-11T02:30Z]
### Action: Authored docs/seed-spec.md while P0 workers run (Sonnet scaffold in codex-worktree; Codex eve spike — note: gpt-5.6-terra-mini unsupported on this account, running on Codex default model)
### Files changed: docs/seed-spec.md (new, main branch)
### Diff summary: Deterministic seed spec — 9 fictional actors with separation of duties; 12 initiatives covering every demo storyline (champion #1 live-only, fast-lane #2, rejected #3, breach-trending #4 crossing Q-01 at base+9d, RL promotion #5, self-hosted GPU #6, mid-pipeline #7, conditional #8, returned #9, overdue #10, exception-pending #11, healthy #12); 16-entry control catalog (2/domain) + live-enforced Q-01 eval floor; telemetry generation functions; ~120-150 pre-seeded audit events incl. foreshadowing admin threshold change; outcome-metric targets; 4 day-one audit queries. Seed must derive tiers via lib/triage/rules.ts and fail on drift.
### Recommendations / Next steps: P1 worker consumes this spec verbatim. Gate P0 on scaffold acceptance checks + eve verdict.

## [AGENT: Claude] [2026-07-11T03:10Z]
### Action: Fixed seed-spec tier inconsistency; reviewed + accepted policy corpus (Sonnet worker); launched 4 more parallel workers
### Files changed: docs/seed-spec.md (6-flag overlay model + §2.1 authoritative triage/routing rules; commit 15b1b14), docs/policies/* (10 files, Sonnet worker — reviewed: INDEX cross-refs verified, no real-org names, normative quotable sections; accepting)
### Diff summary: Caught drift bug — identical 4-flag inputs mapped to different tiers; added human-in-the-loop + individual-impact overlay questions and first-match tier rules; all 12 seed initiatives now derive consistently. Policy corpus: 8 domain policies (MP-L/P/T/R/S/H/C/D) + FL-2026-01 fast-lane + INDEX with storyline citation targets.
### Recommendations / Next steps: Workers in flight — (1) Sonnet scaffold in codex-worktree, (2) Codex eve spike, (3) Sonnet pure domain logic in claude-worktree (lib/triage, lib/approval, lib/controls, lib/lifecycle + TDD vs seed-spec fixtures), (4) Sonnet docs/ui-spec.md, (5) Sonnet docs/intake-spec.md, (6) Haiku docs/demo-script.md. Orchestrator reviews each before commit.

## [AGENT: Claude] [2026-07-11T03:45Z]
### Action: Reviewed + accepted 3 doc-worker deliverables with orchestrator corrections
### Files changed: docs/demo-script.md (Haiku worker + 4 review fixes), docs/intake-spec.md (Sonnet worker, accepted as-is), docs/ui-spec.md (Sonnet worker + 1 fix)
### Diff summary: demo-script review caught: champion member-facing flag contradicted seed fixture; retention gap wrongly described as blocking submission (intake-spec: fires post-triage); rejection attributed to a reviewer (SoD violation — only accountable approver rejects); three-vs-four result rows; real-org audience reference scrubbed. ui-spec fix: banner disclaimer named a real org — replaced with "not affiliated with any real organization". intake-spec verified: overlay questions verbatim, champion prefill retentionIntent=null, RFT rules implementable, worker flagged seed.ts must load champion as UNSUBMITTED draft (noted for P1 prompt).
### Recommendations / Next steps: Commit all three. Remaining in flight: scaffold, eve spike, domain-logic bundle.

## [AGENT: Claude] [2026-07-11T04:25Z]
### Action: Verified + accepted domain-logic bundle (Sonnet worker, resumed once after API-overload crash); committed da57f46 on claude-worktree
### Files changed: lib/{domain,triage,approval,controls,lifecycle}/* + minimal package.json/tsconfig/vitest.config (claude-worktree branch)
### Diff summary: 114 tests / 100% lib coverage / strict TS, verified independently by orchestrator (typecheck + full suite re-run; rules.ts audited against seed-spec §2.1 — exact match). Worker judgment calls accepted: strict > breach comparison (noise-free formula crosses at day 11, seeded noise will shift it — evaluator is agnostic); transition() takes Actor {id, role}; rejected/retired terminal; deploy=admin|system. Deviation accepted: @vitest/coverage-v8 devDep (required for coverage runs).
### Recommendations / Next steps: Merge into main after P0 gate alongside scaffold (package.json union-merge expected). Remaining in flight: Sonnet scaffold (codex-worktree), Codex eve spike.

## [AGENT: Codex] [2026-07-11T04:40Z]
### Action: Completed the read-only P0 Eve research gate and selected the fallback architecture (entry appended by Claude on Codex's behalf; Codex session 019f4eb7-da16-7470-9582-5395ff175bfa)
### Files changed: N/A — research only; no files changed.
### Diff summary: Compared Eve 0.22.4 against Vercel AI SDK + Workflow SDK for agent definition, Next.js embedding, OpenAI configuration, durable approval, fan-out/progress, schedules, evals, port isolation, and maturity. Key evidence: Eve owns the workflow lifecycle; fixed 8-domain fan-out is model-directed or experimental (QuickJS dynamic workflows); durable cancellation undocumented; approval is tool-level (Eve session protocol), not an app-owned checkpoint; beta churn (needsApproval→approval; open issue #693 breaking withEve on Next 16). AgentPort fit is good; WorkflowPort fit insufficient. Verdict: FALLBACK (AI SDK + Workflow SDK).
### Recommendations / Next steps: Define+test AgentPort/WorkflowPort contracts first; AI SDK structured output (generateText + Output.object) for typed drafts; app-authored Workflow SDK orchestration with createHook/resumeHook behind authenticated routes; Postgres authoritative for progress/approval/audit/cancel. Reassess Eve post-GA as optional AgentPort adapter only.

## [AGENT: Claude] [2026-07-11T04:45Z]
### Action: P0 GATE DECISION — adopted FALLBACK architecture (Vercel AI SDK + Workflow SDK) per Codex spike; updated plan.md §1/§4/§13 and AGENTS.md
### Files changed: plan.md, AGENTS.md, .claude/CLAUDE.md, agents-build-log.md
### Diff summary: Codex's verdict accepted without disagreement — the WorkflowPort mismatch (deterministic fan-out, app-owned approval checkpoints, durable cancel) is exactly the boundary plan hard rule 4 requires. agents/ directory-per-agent layout retained as our own convention. eve reconsidered post-GA as optional AgentPort adapter (backlogged).
### Recommendations / Next steps: Scaffold worker finishing in codex-worktree; then merge both worktrees to main and close task #1. Overnight execution governed by GOAL.md.
