# Jeeves — AI Governance Gateway (Demo)

**Status:** APPROVED — human GO 2026-07-11. Owner decisions (§12): (1) full v1 breadth on a **1–2 week budget** — see §13 milestone map; (2) fast-lane autonomy reframe **confirmed**. Implementation delegated to Codex (gpt-5.6-terra-mini) and Sonnet workers; Claude orchestrates and reviews.
**Author:** Claude (orchestrator). **Reviewer:** Codex (gpt-5.6-terra). **Date:** v1 2026-07-10, v2 2026-07-11, GO 2026-07-11.

---

## 0. What changed in v2 (read this to decide GO)

Codex's core finding: v1 tried to ship five persona experiences, eight live review tracks, two chats, telemetry, and controls in three days — realistically 1–2 weeks of work — and had public-demo safety and governance-credibility gaps. v2 adopts Codex's **three-day cut**: one champion end-to-end governance case, one initiative-centric UI, honest synthetic telemetry, a safe public-demo model, and a versioned domain model. Original v1 scope is preserved as a post-demo backlog (§11), not deleted.

## 1. Decisions in force (owner's, from interview — amendments marked ⚠)

| Decision | Value |
|---|---|
| Positioning | Public demo on Vercel; fictional payer "Meridian Health"; synthetic data only; no Optum affiliation |
| Roles | Requester, Reviewer, Program Office, Audit/Leadership, Admin — ⚠ now one initiative-centric UI where the demo role changes available actions and saved views, not five separate apps (Codex F8, Sierra-aligned) |
| Governance domains | All 8 visible (Legal, Procurement, Tech Arch, Responsible AI, Security, Privacy/HIPAA, Clinical Safety, Data Governance); ⚠ 3–4 implemented as live agent drafts, rest seeded (Codex cut) |
| Risk model | Deterministic tiers Low/Med/High/Critical from healthcare overlay questions (PHI? member-facing? care/coverage influence? vendor-hosted?) |
| Autonomy | ⚠ Agents draft, recommend, route, and flag missing evidence — they never approve. Low-risk = deterministic **fast-lane under a pre-approved policy** with a named accountable approver (was "agent auto-approve"; Codex F3 — owner to confirm, §12) |
| Agent framework | ⚠ **DECIDED at P0 gate (2026-07-11): FALLBACK — Vercel AI SDK + Workflow SDK** (Codex spike verdict: eve 0.22.4 owns workflow lifecycle, model-directed fan-out, undocumented durable cancel, beta churn; AgentPort fit good, WorkflowPort fit insufficient). agents/ directory layout kept as our own convention; eve reconsidered post-GA as optional AgentPort adapter |
| Runtime LLM | OpenAI GPT-5.x |
| Build agents | Codex gpt-5.6-terra implements; Claude orchestrates + reviews; ⚠ disagreements are surfaced to the human, never tie-broken by Claude (Codex F10) |
| DB | Neon Postgres + Drizzle (one dev branch + isolated test schema; no Docker) |
| Effort | 3 days, with per-phase stop conditions (§10) |

## 2. The champion demo storyline (one end-to-end case)

Seed 10–12 initiatives for organizational depth. The live demo runs ONE:

**"Prior-auth clinical summarizer"** — member-facing, PHI-touching, influences coverage decisions.

1. **Intake** (structured form, not chat) → completeness check flags a missing data-retention answer.
2. **Deterministic triage** → Critical tier → all 8 domains required; eve drafts 4 live (Responsible AI, Privacy/HIPAA, Clinical Safety, Legal); 4 arrive pre-seeded.
3. **Human review**: reviewer edits a draft, signs; approver issues a **conditional approval** (named, accountable) with conditions linked to controls.
4. **Versioned effective controls** generated for the deployment from the control catalog (§7).
5. **Synthetic eval-quality breach** (hallucination-rate series crosses threshold) — evaluated synchronously via admin "Run monitor" action → deployment **paused**, reassessment ReviewCycle opened, incident recorded. Idempotent: re-running the monitor creates no duplicates.
6. **Audit query** (structured, evidence-linked): "member-facing initiatives touching PHI, with approver and current control status" → rows link to decisions, signatures, events.
7. **Fast-lane counterpoint**: one seeded Low-tier initiative approved via pre-approved policy, accountable approver shown.
8. **Admin actions — exactly two live**: change an eval threshold; pause/resume a deployment. Both require a reason and write audit events. Admin cannot approve initiatives or sign reviews (separation of duties).

Outcome metrics strip (Sierra-style, outcomes not activity): review cycle time, first-pass completeness rate, estimated reviewer hours saved, evidence freshness, overdue controls.

## 3. Public-demo safety model (Codex F2)

- Public visitors: **read-only** seeded mode — no unauthenticated mutation endpoint exists.
- Live/mutable demo: passcode-gated, runs in an **isolated demo workspace** (session-scoped data namespace, resettable), atomic per-day token budget check, input length limits, per-IP rate limiting.
- Seeded flows never call the LLM provider — provider outage cannot break the demo.

## 4. Stack

Next.js (App Router) + TypeScript + Tailwind/shadcn + Recharts; Neon Postgres + Drizzle; Vitest + one **required** Playwright golden-path test; **Vercel AI SDK + Workflow SDK (P0 gate decision)** behind **capability-oriented ports** — `AgentPort` (draft review, triage assist, completeness check; AI SDK `generateText` + `Output.object` structured drafts) and `WorkflowPort` (deterministic fan-out, progress, human pause/resume via `createHook`/`resumeHook` behind authenticated routes, cancel) — defined in app-owned types. Authoritative state transitions live in application code + Postgres, never inside adapters. eve backlogged as optional post-GA AgentPort adapter.

## 5. Domain model (Codex F5 — versioned, registry as a view)

`Initiative` · `IntakeVersion` · `RiskAssessment` (versioned) · `ReviewCycle` (initial | reassessment) · `ReviewDecision` (per domain: drafted/signed/returned; conditional approvals with conditions) · `DeploymentVersion` (incl. model version — the RL story is **version promotion with feedback-data provenance sign-off**, not training dashboards) · `ControlDefinition` · `EffectiveControl` (versioned, per deployment) · `Observation` (synthetic telemetry, labeled) · `Incident` / reassessment linkage · `AuditEvent` (append-only **at the DB level**: revoke UPDATE/DELETE from app role + trigger; tested at DB level, not just app-path) · `RunBudget`.
Uniqueness/linkage constraints: one ReviewDecision per (cycle, domain); breach identity unique per (deployment, control, window); budget row unique per day. Registry = a SQL view over authoritative records.

## 6. Control catalog (Codex F4 — all 8 domains, not just ops)

`ControlDefinition` fields: domain, applicability (tier/flags), policy source + version, owner, required evidence, cadence, enforcement mode (monitor/gate/block), exception process, remediation owner. Seed the catalog across all 8 domains; live enforcement demonstrated for the eval-quality control only (the breach storyline). Everything else renders honestly as catalog + status.

## 7. Telemetry honesty (Codex F6)

Every synthetic panel is labeled "Synthetic data — demo" with a connector-status chip (e.g. "Arize: not connected"). No imitation Arize panels, no dead deep links. Eval series are shown as our own observations with an explicit "export to Arize AX / Phoenix" integration point documented. GPU utilization appears only on the one initiative labeled as a self-hosted workload.

## 8. Tests (written first; LLM calls mocked)

1. Triage rules: overlay answers → tier (PHI+member-facing ⇒ ≥High; care/coverage ⇒ Critical)
2. Tier → required domains matrix
3. Fast-lane eligibility: policy match + completeness; accountable approver always recorded
4. **State transitions**: full lifecycle graph incl. breach → paused → reassessment; illegal transitions rejected
5. **Idempotency**: seed, sign-off retry, duplicate signature rejected, monitor re-run creates no duplicate incident
6. Control evaluation: threshold crossing, sustained window, tier default vs deployment override precedence
7. **Concurrency**: parallel budget consumption never exceeds cap (atomic check)
8. **Mutation gating & session isolation**: unauthenticated mutation = 403; demo-workspace writes never touch seeded data
9. Evidence versioning: audit query returns the decision/control version in force at the time
10. Structured auditor queries return correct rows with evidence links
11. DB-level append-only enforcement on AuditEvent
12. **Playwright golden path (required)**: champion storyline steps 1→6
Coverage: >80% on `lib/` logic (owner's global TDD rule — held; UI exempt).

## 9. Phases + stop conditions

- **P0** (½ day): `git init` + worktrees, root `AGENTS.md` (mirror of build rules), scaffold, **eve spike (2h hard gate: choose eve or fallback — never both)**. *Stop condition: app boots, ports defined, decision logged.*
- **P1** (¾ day): domain model + migrations + seed (10–12 initiatives, storylines) + read-only initiative-centric UI + outcome metrics. *Stop: seeded demo browsable end-to-end read-only.*
- **P2** (1 day): live loop — intake form → triage → 4 live eve draft reviews (fan-out with mocked output first, durable polish second) → sign-off → conditional approval → effective controls. *Stop: champion steps 1–4 work live.*
- **P3** (½ day): breach → pause → reassessment; two admin actions with reasons + audit events. *Stop: steps 5 + 8 work.*
- **P4** (¼ day): structured audit query with evidence links (step 6).
- **P5** (¼ day): public read-only mode + passcode workspace + budget/rate limits verified, deploy, demo script, README.
- Deferred if behind: P4 first, then durable-workflow polish (mocked fan-out is acceptable for the demo).

## 10. Delegation

Codex: P1 domain model/seed, P2 loop, P3 controls engine. Sonnet: UI pages/charts. Haiku: fixtures/mechanical. Claude: phase-gate diff reviews, build log, surfacing disagreements to the human. All work logged in `agents-build-log.md`.

## 11. Deferred backlog (v1 scope, post-demo)

Conversational intake chat · free-form ask-the-auditor NL chat · all 8 domains live · real Arize Phoenix/AX integration via OTel · interactive RL training panels · GPU quota controls · cron-scheduled monitoring · ServiceNow/Ariba integration stubs · real auth/RBAC.

## 12. Owner decisions needed at GO

1. **Confirm the three-day cut** (this plan) — or keep v1's full breadth and extend the budget to ~1–2 weeks.
2. **Confirm the autonomy reframe**: "agent auto-approve low-risk" → "deterministic fast-lane under pre-approved policy with named accountable approver." Codex and I both recommend it — it strengthens the healthcare governance story; agents never hold approval authority.

## 13. Milestone map (GO amendment — full breadth over 1–2 weeks)

### 13a. Original GO map (superseded by the 2026-07-11 reorder below — kept for provenance)

- **M1 — Champion vertical (days 1–3):** §9 phases P0–P5 exactly as written. Ends with the champion storyline deployed and demo-able. *The three-day cut is now milestone 1, not the whole project.* **[DELIVERED]**
- **M2 — Breadth:** all 8 domains live; conversational intake chat; free-form ask-the-auditor NL chat.
- **M3 — Telemetry depth:** self-hosted Arize Phoenix; RL promotion view; GPU quota controls; scheduled monitoring.
- **M4 — Hardening & polish:** full control-catalog UI, exception workflows, security pass, session ritual.

### 13b. Reorder (Codex review 2026-07-11 — ACCEPTED with judgement, Claude)

Codex verdict: *approve the direction, but rebase and reorder.* Two High findings drove it:
(1) **hardening cannot remain last** — transactions, persistent session/rate/budget state, workspace isolation, authorization, and idempotency must precede scheduled monitoring and any **public** Vercel deploy; (2) **the console redesign must precede feature expansion** — don't pile Phoenix/GPU/exceptions onto an interface we were replacing.

Owner nuance (Claude judgement): this is a **synthetic-data, read-only-public / passcode-gated demo** — M2.5 is a *hard gate before any public Vercel deploy*, **not** a blocker on finishing the console UX or running the demo locally/preview. So UX (M2) proceeds now; M2.5 lands before we expose a public URL.

- **M1 — Champion vertical:** *[DELIVERED]* — full read-only + live governance loop, breach→pause→reassess, audit console, two admin actions.
- **M2 — UX + workflow breadth (current):**
  - Governance **operations console** replaces the marketing UI — left-nav shell, working Inbox/Portfolio/Monitoring, restrained enterprise palette. *[DELIVERED this session]*
  - Initiative **record-as-case-file** + 3-column **Review Workbench** as the central experience. *[IN PROGRESS — workbench DONE; case-file reshape in flight]*
  - Run **all 8 domains** through a durable, bounded-concurrency workflow (retry / resume / per-domain failure visibility / cancellation / atomic budget reservation) — replacing the single-request `Promise.allSettled` in `lib/workflow/review-run.ts`.
  - Harden both chats: strict payload limits, role checks, grounded/cited responses.
  - **Honesty fix:** golden path + `docs/demo-script.md` exercise all 8 domains, not 4.
  - *Exit:* all-8 mocked E2E passes; one live-provider smoke; workflow resumes after interruption.
- **M2.5 — Deployment foundation (HARD GATE before any public deploy):** transaction-capable pooled Neon driver (today `neon-http.transaction()` is a stub — atomic only on PGlite); persistent sessions, rate limits, atomic budget; real workspace-scoped records + queries; requester-ownership + reviewer-assignment authorization; required-review completeness before approval; concurrency-safe sign/return/decide/monitor; dynamic DB-backed pages; security headers; guarded seeding. *Exit:* isolated Vercel preview passes two-session isolation + mutation tests.
- **M3 — Operate loop:** authenticated, idempotent **scheduled** monitoring first; Phoenix/Arize as a **separately managed connector** (not assumed in-process) with connector health / last-sync / trace ids; synthetic OTel traces; GPU quotas only for the one self-hosted initiative; extend the promotion view (eval comparison, provenance evidence, history, rollback); cost + token-budget telemetry. *Exit:* a scheduled breach creates exactly one incident + reassessment; connector failure never breaks the demo.
- **M4 — Governance operations + release:** full control-catalog fields (owner, cadence, applicability, enforcement mode, remediation owner, evidence freshness, versions) + filtering; exception request/approve/expire/renew/reject/revoke workflow with SoD + full audit linkage; security-reviewer pass + accessibility/browser pass; demo reset ritual (workspace reset, connector check, budget check, build SHA, smoke test, passcode rotation); preview → walkthrough → **human-approved** production promotion.
- Gate between milestones: tests green, code-reviewer verdict, build-log entry, human checkpoint.

---
*GO given — building. Each phase still ends with tests green + reviewed diff before merge (Plan-First Gate satisfied 2026-07-11). Milestone reorder accepted 2026-07-11 per Codex review; recorded in `agents-build-log.md`.*
