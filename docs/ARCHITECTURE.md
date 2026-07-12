# Jeeves — Architecture & Security Posture Reference

**Audience:** engineering reviewer / handoff. **Authoritative spec:** [`plan.md`](../plan.md) — this
document is a from-the-code reference for the system plan.md describes, not a
replacement for it. Read `plan.md` §4 (stack + ports), §5 (domain model), §3
(safety model), and §13 (milestone map) alongside this doc. The chronological
build record, including review findings and disagreements, is
[`agents-build-log.md`](../agents-build-log.md) — later entries reflect the
current state; where this document and an earlier doc (e.g. `docs/deploy.md`,
`docs/MORNING-REPORT.md`) disagree, the build log and the code itself win.

Jeeves is a **fictional demo**: "Meridian Health" is not a real organization,
every actor/initiative/approval/control/telemetry series is synthetic and
produced by a deterministic seed script (`scripts/seed.ts`), and no real PHI,
PII, or production data exists anywhere in this repository.

---

## 1. Overview

Jeeves models the full governance lifecycle of an AI initiative at a
healthcare payer: structured intake → deterministic risk triage → an
agent-drafted review fanned out across up to eight governance domains → human
sign-off → a named, accountable approval decision → versioned effective
controls → post-deployment monitoring, with a breach able to pause a
deployment and open a reassessment cycle — all wrapped in a structured,
evidence-linked audit trail. The central design commitment, enforced at the
type level and in code review, is **agents draft, humans decide**: no
`AgentPort`/`WorkflowPort` result ever carries approval authority, and every
state transition that matters is performed by application code against
Postgres, never inside an adapter.

The stack is Next.js (App Router) + TypeScript, Tailwind + shadcn/ui,
Recharts, Neon Postgres + Drizzle ORM, and the Vercel AI SDK (behind
app-owned ports) — see §3 for why eve was evaluated and rejected at the P0
gate. All LLM calls are mocked in tests and the app runs fully keyless by
default (§3, §7).

---

## 2. Domain model

Source of truth: [`lib/domain/types.ts`](../lib/domain/types.ts) (shared value
types) and [`lib/db/schema.ts`](../lib/db/schema.ts) (the real Drizzle Postgres
schema, plan.md §5). Migrations live in [`drizzle/`](../drizzle/).

### 2.1 Shared value types (`lib/domain/types.ts`)

- **`Tier`** — `"low" | "medium" | "high" | "critical"`, deterministically
  derived from overlay flags (§5 below); never LLM-influenced.
- **`Domain`** — the eight governance domains: `legal`, `procurement`,
  `tech-architecture`, `responsible-ai`, `security`, `privacy-hipaa`,
  `clinical-safety`, `data-governance`.
- **`OverlayFlags`** — six booleans captured at intake: `phi`,
  `memberFacing`, `careCoverageInfluence`, `vendorHosted`, `humanInLoop`,
  `individualImpact`. (This is the 6-flag model; the build log records that
  the original 4-flag model mapped identical inputs to different tiers and
  was corrected early — see `agents-build-log.md` 2026-07-11T03:10Z.)
- **`ActorRole`** — `requester | reviewer | approver | admin | program |
  system`.
- **`LifecycleState`** — the twelve-state lifecycle graph (§5.4).
- **`Actor`** — `{ id, role }`, the minimal identity every service/lifecycle
  call operates on.

### 2.2 Entities and tables (`lib/db/schema.ts`)

| Entity | Table | Key columns | Constraints |
|---|---|---|---|
| Initiative | `initiatives` | `id` (PK), `slug` (unique), `title`, `requester`, `state`, `tier` (nullable pre-triage), `accountableApprover`, `workspaceId` (nullable) | — |
| IntakeVersion | `intake_versions` | `initiativeId` FK, `version`, `submitted`, `fields` (JSONB), `missing` (JSONB) | unique `(initiativeId, version)` |
| RiskAssessment | `risk_assessments` | `initiativeId` FK, `version`, `intakeVersionId` FK, `tier`, `flags` (JSONB), `requiredDomains` (JSONB) | unique `(initiativeId, version)` |
| ReviewCycle | `review_cycles` | `initiativeId` FK, `kind` (`initial`\|`reassessment`), `riskAssessmentId` FK, `openedAt`, `closedAt`, `incidentId` (nullable — set only for breach-opened reassessments) | — |
| ReviewDecision | `review_decisions` | `cycleId` FK, `domain`, `status` (`pending`\|`drafted`\|`signed`\|`returned`), `reviewer`, `draftMd`, `citations` (JSONB), `signedAt`, `returnReason` | **unique `(cycleId, domain)`** — one ReviewDecision per (cycle, domain), plan §5 |
| Initiative-level decision | `initiative_decisions` | `initiativeId` FK, `cycleId` FK, `type` (`approved`\|`conditionally_approved`\|`rejected`\|`fast_lane_approved`), `approver`, `policyId` (fast-lane only), `citations`, `conditions` (JSONB `{text, controlId}[]`) | separate table from `ReviewDecision` on purpose — initiative-level accountable decisions vs. per-domain drafts |
| DeploymentVersion | `deployment_versions` | `initiativeId` FK, `version` (e.g. "v2.1"), `status` (`deployed`\|`paused`\|`awaiting_promotion_signoff`\|`retired`), `modelVersion`, `selfHosted`, `feedbackProvenanceSignedOff`, `deployedAt`/`pausedAt`/`retiredAt` | — |
| ControlDefinition | `control_definitions` | `id` (e.g. "H-01", "Q-01"), `domain` (or `"runtime"` for Q-01), `applicability`, `policySource`, `owner`, `requiredEvidence`, `cadence`, `enforcementMode` (`monitor`\|`gate`\|`block`), `exceptionProcess`, `remediationOwner`, plus Q-01-only `observationKind`/`tierDefaultThresholds`/`sustainedWindow` | catalog — read-mostly |
| EffectiveControl | `effective_controls` | `deploymentId` FK, `controlId` FK, `version`, `status` (`met`\|`pending`\|`overdue`\|`breached`\|`exception_requested`), `thresholdOverride`, `evidence`/`evidenceAt`, `dueAt`, `remediationOwner` | **unique `(deploymentId, controlId, version)`** |
| Observation | `observations` | `deploymentId` FK, `kind` (`cost_tokens_usd_day`\|`eval_hallucination`\|`eval_relevance`\|`gpu_util_pct`), `ts`, `value` | synthetic telemetry, always labeled as such in the UI |
| Incident | `incidents` | `deploymentId` FK, `controlId` FK, `windowStart`, `identityKey` (unique, `${deploymentId}:${controlId}:${windowStartTsMs}`), `detectedAt`, `reviewCycleId` (nullable), `resolvedAt` | **unique `identityKey`** and unique `(deploymentId, controlId, windowStart)` — deterministic breach identity enables idempotent upsert-on-conflict re-runs |
| AuditEvent | `audit_events` | `initiativeId` FK (nullable), `ts`, `actor`, `actorRole`, `action`, `detail`, `before`, `after`, `metadata` (JSONB) | **append-only at the DB level** — see §2.3 |
| RunBudget | `run_budget` | `day` (`YYYY-MM-DD`, unique), `tokensUsed`, `tokensCap` | **unique per day** |
| Session | `sessions` | `token` (PK), `personaKey`, `workspaceId`, `expiresAt` (epoch-ms, checked in app code), `createdAt` | added M2.5 inc.1 — see §6.1 |

The **registry** (plan §5: "registry as a view") is `initiative_registry`, a
read-only SQL view defined in
[`drizzle/0001_initiative_registry_view.sql`](../drizzle/0001_initiative_registry_view.sql):
`initiatives LEFT JOIN` the latest `risk_assessments` row `LEFT JOIN` the
latest `deployment_versions` row. It is never written to directly — all
writes land on the authoritative tables above.

### 2.3 Append-only audit enforcement

`AuditEvent` is append-only **at the database level**, not just by
application-code discipline. Rather than a GRANT/REVOKE role split (both
PGlite in tests and Neon serverless in production run as a single connection
role, so a role-based revoke wouldn't hold), the enforcement is a trigger —
[`drizzle/0002_audit_events_append_only.sql`](../drizzle/0002_audit_events_append_only.sql):

```sql
CREATE OR REPLACE FUNCTION "audit_events_append_only"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only: % is not permitted (row id=%)',
        TG_OP, COALESCE(OLD."id", NEW."id");
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_no_update" BEFORE UPDATE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();
CREATE TRIGGER "audit_events_no_delete" BEFORE DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();
```

This is tested at the DB level (plan §8 test 11), not only via the app code
path.

### 2.4 Migration history (`drizzle/`)

| Migration | Purpose |
|---|---|
| `0000_real_falcon.sql` | Initial schema (drizzle-kit generated) — all core tables + FKs + the uniqueness indexes listed in §2.2 |
| `0001_initiative_registry_view.sql` | Hand-written `initiative_registry` read-only view |
| `0002_audit_events_append_only.sql` | Hand-written append-only trigger (§2.3) |
| `0003_sessions.sql` | M2.5 inc.1 — DB-backed `sessions` table (§6.1) |
| `0004_initiatives_workspace.sql` | M2.5 inc.2a — nullable `workspace_id` on `initiatives`, non-breaking (§6.5) |

`0001`–`0004` are hand-written rather than `drizzle-kit`-generated (the tool
requires `DATABASE_URL` at invocation time, unavailable in the build
environment); they are applied by the same migration runner as `0000` in
tests and deploys.

### 2.5 Lifecycle state machine

Defined in `lib/lifecycle/transitions.ts` (the single source of truth for
legal transitions — plan.md README: "the single source of truth for legal
state transitions"). Twelve states: `intake_draft → submitted → triaged →
(in_review | fast_lane_approved) → (approved | conditionally_approved |
rejected) → deployed ↔ paused → re_review → (deployed | retired)`, with
`retired` reachable from every operating state. Key authority rules baked
into the transition table:

- Only an **approver** may `approve` / `conditionally_approve` / `reject` —
  explicitly *not* admin (separation of duties).
- `fast_lane_approve` requires both a `policyId` and a named
  `accountableApprover` in context — the deterministic fast lane still names
  an accountable human, never an agent.
- `pause` and `resume` require a non-empty `reason` in context.
- Every transition call returns `{ before, after, auditEvent }` that the
  caller must persist in the same transaction — the lifecycle module itself
  never touches the database.

### 2.6 Triage and fast-lane logic

- **Tier derivation** — `lib/triage/rules.ts`: first-match-wins rules over
  the six overlay flags (e.g. `careCoverageInfluence && !humanInLoop` →
  `critical`; `phi` → at least `high`). Matches `docs/seed-spec.md` §2.1
  exactly; the seed script fails on drift.
- **Domain routing** — `lib/triage/routing.ts`: tier sets a base domain list
  (Low: 2 domains; Medium/High: 5; Critical: all 8), and individual flags
  (`phi`, `vendorHosted`, `careCoverageInfluence`) add domains on top,
  regardless of tier.
- **Fast-lane eligibility** — `lib/approval/eligibility.ts`: eligible only
  when tier is `low`, intake is complete, and `phi`/`memberFacing`/
  `careCoverageInfluence` are all false. All failing criteria are reported at
  once (not just the first), and the accountable approver is always named,
  never an agent.
- **Control evaluation / breach detection** — `lib/controls/evaluate.ts`:
  threshold resolution is project/deployment override, else tier default;
  breach detection is a sustained-window rule (Q-01: 3 consecutive
  above-threshold observations) over a caller-supplied `nowTs` (never the
  wall clock), producing a deterministic `identityKey` that makes re-running
  the monitor idempotent (§5.6).

---

## 3. Ports & adapters

Defined in [`lib/agents/ports.ts`](../lib/agents/ports.ts) — the **only**
contract adapters may implement; nothing in `app/` or `lib/` may import an
adapter directly, only these types.

### 3.1 The P0 decision: fallback, not eve

At the P0 gate (`agents-build-log.md` 2026-07-11T04:40Z–04:45Z), Codex spiked
Vercel eve 0.22.4 against a fallback of the **Vercel AI SDK + Workflow SDK**
and the plan.md-decided verdict was **fallback**: eve owns the workflow
lifecycle, its fixed 8-domain fan-out is model-directed/experimental,
durable cancellation is undocumented, and its approval model is a
tool-level session protocol rather than an app-owned checkpoint — all in
tension with hard rule 4 (authoritative state lives in app code + Postgres,
never inside an adapter). `AgentPort` fit was judged good; `WorkflowPort` fit
was judged insufficient. eve is backlogged as a possible post-GA `AgentPort`
adapter only; the `agents/` directory-per-agent layout (`agents/reviewer/`,
`agents/triage/`, `agents/auditor/`, `agents/intake/`, `agents/ops-monitor/`)
is kept as this project's own convention, independent of that decision.

### 3.2 `AgentPort` — single-shot capability methods

```ts
export interface AgentPort {
  draftReview(input: DraftReviewInput, options?: InvokeOptions): Promise<PortResult<DraftReviewOutput>>;
  triageAssist(input: TriageAssistInput, options?: InvokeOptions): Promise<PortResult<TriageAssistOutput>>;
  checkCompleteness(input: CompletenessCheckInput, options?: InvokeOptions): Promise<PortResult<CompletenessCheckOutput>>;
  auditorAnswer(input: AuditorAnswerInput, options?: InvokeOptions): Promise<PortResult<AuditorAnswerOutput>>;
  intakeInterview(input: IntakeInterviewInput, options?: InvokeOptions): Promise<PortResult<IntakeInterviewOutput>>;
}
```

`DraftReviewOutput` carries a `recommendation` (`recommend-sign-off` |
`recommend-conditional` | `recommend-return`), never a `decision` — the port
cannot approve (hard rule 1); a `ReviewDecision` row is only ever created by
app code when a named human signs. `TriageAssistOutput` is explicitly
advisory: "the authoritative tier comes from the deterministic overlay-rules
in `lib/`... this output exists to explain and cross-check, never to
decide." `auditorAnswer` is grounded only on caller-supplied
`groundingRows` — the adapter never reaches into `lib/data` itself.

Every port method returns a `PortResult<T>` discriminated union
(`{ ok: true, value } | { ok: false, error: PortFailure }`), and every
`PortFailure` is one of `validation | provider | timeout | cancelled |
budget-exhausted` — no raw provider error crosses the port boundary.

### 3.3 `WorkflowPort` — fan-out, progress, pause/resume, cancel

```ts
export interface WorkflowPort {
  startFanOut<TItem, TTaskInput, TItemResult, TResumePayload = unknown>(
    input: FanOutInput<TItem, TTaskInput>,
    options?: InvokeOptions,
  ): Promise<PortResult<WorkflowRunHandle<TItem, TItemResult, TResumePayload>>>;
}
```

`WorkflowRunHandle` exposes an async-iterable `events()` stream, a terminal
`result()`, `resume(payload)` for a `paused-for-human` gate, and
`cancel(reason?)`. The interface doc is explicit that consuming these events
never mutates authoritative state by itself — app code listens, then
performs its own Postgres transitions (hard rule 4). In practice, the actual
fan-out implementation (`lib/workflow/review-run.ts`, §5.3) is
"WorkflowPort-shaped" but hand-written directly against Postgres rather than
constructed via a generic `WorkflowPort` runtime — this is the accepted,
documented shape for the demo (plan §9: "mocked fan-out is acceptable").

### 3.4 Adapters

Selected by [`lib/agents/index.ts`](../lib/agents/index.ts)`#getAgentPort()`
— the **only** place app code should call to get an `AgentPort`:

```ts
export function getAgentPort(): AgentPort {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && apiKey.trim().length > 0) {
    return createOpenAIAgentPort();
  }
  return createMockAgentPort();
}
```

- **`lib/agents/openai-adapter.ts`** — real adapter, Vercel AI SDK v7
  (`ai` + `@ai-sdk/openai`), `generateText` with `Output.object` for
  structured drafts, model from `OPENAI_MODEL` (fallback documented as
  `gpt-5.1`), `maxRetries: 0` (retry policy lives in the caller, not the
  SDK — see §5.3), and an explicit deadline race mapped to the `timeout`
  `PortFailure`.
- **`lib/agents/mock-adapter.ts`** — deterministic, keyless default. Same
  input always produces the same output (a small artificial per-domain
  delay is the only non-trivial variance, and it respects `AbortSignal`).
  This is what every test and the default (no `OPENAI_API_KEY`) demo run
  uses — nothing is sent to a real provider unless the key is explicitly
  set and non-empty.

Authoritative state transitions never live in either adapter — they live in
`lib/services/*` and `lib/lifecycle/transitions.ts` against Postgres.

---

## 4. Data providers

Defined in [`lib/data/provider.ts`](../lib/data/provider.ts):

```ts
export interface WorkspaceScopedReadOptions {
  viewerWorkspaceId?: string | null;
}

export interface DataProvider {
  listInitiatives(opts?: WorkspaceScopedReadOptions): Promise<InitiativeSummary[]>;
  getInitiativeDetail(slug: string, opts?: WorkspaceScopedReadOptions): Promise<InitiativeDetail | null>;
  outcomeMetrics(): Promise<OutcomeMetrics>;
  controlCatalog(): Promise<ControlRow[]>;
  auditQuery(id: CannedAuditQueryId): Promise<AuditQueryRow[]>;
}
```

`{ viewerWorkspaceId }` semantics (opt-in, back-compatible): options omitted
→ no filter (today's default everywhere); `null` → seeded/public rows only
(`workspace_id IS NULL`); an id → seeded rows **plus** that workspace's own
live-created rows.

### 4.1 `DbDataProvider` (`lib/data/db-provider.ts`)

Backed by whichever `Db` handle `lib/db/client.ts#getDb()` returns (§4.3):
Neon via the pooled `drizzle-orm/neon-serverless` driver when `DATABASE_URL`
is set, otherwise a persistent local PGlite store. Loads the ~10 relevant
tables in parallel per call (`loadSnapshot()`) and assembles the DTOs
in-memory — reasonable for the demo's small (12-initiative) dataset.
Workspace filtering is applied either as a SQL predicate (list queries) or an
in-memory visibility check (`isVisibleToViewer`) depending on the method.

### 4.2 `MockDataProvider` (`lib/data/mock-provider.ts`)

A hand-authored, fully deterministic fixture set matching
`docs/seed-spec.md` — no randomness, no wall-clock reads, no network I/O. At
module load it re-derives each fixture's tier via the real `lib/triage/rules.ts`
and throws on drift, so the mock provider cannot silently diverge from the
authoritative triage rules. Supports the same `viewerWorkspaceId` semantics
as `DbDataProvider` for interface parity.

### 4.3 `app/_lib/data-provider.ts` selector + the PGlite coherence hop

`lib/data/index.ts#getProvider()` selects `DbDataProvider` vs
`MockDataProvider` based on `DATA_PROVIDER`/`DATABASE_URL`, but does so via a
lazy CJS `require()` that Turbopack's Next 16 dev server cannot resolve
correctly (`"DbDataProvider is not a constructor"`). `app/_lib/data-provider.ts`
re-implements the identical selection logic with a static ESM import as a
workaround for UI route/page code, pending an upstream cleanup of
`lib/data/index.ts`.

The same file also solves a real coherence bug specific to local PGlite dev:
Next's dev server maintains multiple server module graphs in one process
(page-render graph vs. route-handler graph), and `getDb()`'s
`globalThis`-scoped memoization (§4.3, `lib/db/client.ts`) only fixed
cross-*module* incoherence within a graph — a page render still could not
see rows an API route handler had just written, because PGlite's WASM state
was captured per graph. `getInitiativeDetailCoherent()` works around this by
having the initiative detail **page** hop over HTTP to the UI-owned
`GET /initiatives/[slug]/detail-data` route handler (which shares the
route-handler module graph) instead of querying the DB directly, forwarding
the incoming `jeeves_workspace` cookie so the hop preserves read-scoping.
This hop is skipped entirely when a real `DATABASE_URL` is set (Neon's
driver is stateless per query — no coherence problem) or in mock mode
(static in-memory fixtures).

---

## 5. The governance workflow

### 5.1 Intake → triage

`POST /api/initiatives` creates the `initiatives` + first `intake_versions`
row (`lib/services/initiative-service.ts`). `POST /api/initiatives/[id]/submit`
enforces requester ownership (§6.4) and transitions `intake_draft →
submitted`. `POST /api/initiatives/[id]/triage` computes the tier and
required-domain set deterministically (`lib/triage/rules.ts` +
`lib/triage/routing.ts`, §2.6), writes a `risk_assessments` row, and
transitions to `in_review` or, for an eligible Low-tier initiative, directly
to the fast lane (§2.6, §5.5).

### 5.2 Draft-run fan-out — bounded concurrency + retry

`POST /api/initiatives/[id]/draft-run` runs
[`lib/workflow/review-run.ts`](../lib/workflow/review-run.ts)`#startDraftRun()`.
This is the module the build log calls the hardening pass that replaced an
earlier single-request `Promise.allSettled` fan-out. Key properties, all
directly in the source comments:

- **Bounded concurrency** — a hand-rolled worker-pool limiter
  (`runWithConcurrencyLimit`) caps in-flight `draftReview` calls at
  `options.concurrency` (default **3**), rather than firing up to 8
  concurrent LLM calls per HTTP request.
- **Per-domain retry** — up to `options.maxAttempts` total attempts per
  domain (default **2**, i.e. one retry). Retries every `PortFailure` kind
  *except* `validation` (permanently invalid, will fail identically) and
  `cancelled` (a deliberate abort), and additionally skips a `provider`
  failure whose `retryable` is explicitly `false`. No backoff sleep between
  attempts — documented as acceptable for the deterministic mock adapter,
  flagged as a follow-up before a real provider (`agents-build-log.md`
  2026-07-11T15:10Z).
- **Idempotency / resumability** — state lives entirely in Postgres
  (`review_decisions` + an `audit_events` trail), no in-memory run registry.
  The unique `(cycleId, domain)` index means a re-invocation for the same
  cycle only re-attempts domains still `pending`/`failed`; anything already
  `drafted`/`signed`/`returned` is left untouched — safe to call again after
  a server restart, and safe to call again if only some domains succeeded.
- **All 8 domains, live** — after an honesty pass recorded in the build log
  (2026-07-11T16:05Z), the golden path and demo materials fan out all 8
  required domains for the Critical-tier champion case in one run, not a
  4-live-plus-4-seeded split.

### 5.3 Sign / return / decide

Reviewers sign or return a domain's draft via
`POST /api/reviews/[cycleId]/[domain]/sign` /
`.../return` — gated to the reviewer's own assigned domain (§6.4). The
approver decides at the initiative level via `POST /api/initiatives/[id]/decide`
with `approved | conditionally_approved | rejected`, optionally attaching
`conditions: { text, controlId }[]` for a conditional approval — written to
`initiative_decisions`, distinct from the per-domain `review_decisions` rows.
Only an `approver` actor may call `decide`; the lifecycle module enforces
this even if a route somehow let another role through.

### 5.4 Effective controls

Post-decision, `generateEffectiveControls()`
(`lib/services/initiative-service.ts`) filters `control_definitions` by
tier/flag applicability and writes versioned `effective_controls` rows
against the initiative's deployment (unique per `(deploymentId, controlId,
version)`), so a later re-generation produces a new version rather than
mutating history in place.

### 5.5 Fast lane

A Low-tier, fully-flag-clear initiative can take the deterministic fast lane
(`lib/approval/eligibility.ts`, §2.6) instead of the full review loop — but
this still transitions through `fast_lane_approve`, which requires a
`policyId` and a named `accountableApprover` in the same way the manual path
requires an approver actor. Agents are never in this path's authority chain.

### 5.6 Monitor — breach → pause → reassessment

`POST /api/monitor/run` runs `lib/services/monitor-service.ts#runMonitor(nowTs)`
(`nowTs` is always a required parameter, never a wall-clock read, so a demo
or test can replay history deterministically). For every deployed initiative
carrying the Q-01 eval-quality effective control, it loads `observations`,
resolves the effective threshold, and evaluates the sustained-breach rule
(both reused unchanged from `lib/controls/evaluate.ts`, §2.6). On a breach,
inside one `db.transaction()`:

1. Idempotently creates an `incidents` row keyed on the deterministic
   `identityKey` — a second call for the same window inserts nothing new
   (checked in-transaction, backstopped by the DB unique index).
2. Transitions the deployment + initiative to `paused` (`transition(...,
   "pause", SYSTEM_ACTOR, reason)`).
3. Opens a reassessment `review_cycles` row (`kind: "reassessment"`) linked
   to the incident.
4. Generates a human-readable incident summary — breach *detection* is
   deterministic app code; the agent only narrates a detection that already
   happened (there is no `AgentPort` method for this yet, so the module
   falls back to a deterministic mock generator when the resolved port is
   the mock port, keeping the demo keyless-safe without inventing a new
   port method outside scope).
5. Writes an `AuditEvent` for every transition.

A partial write (state changed but no incident row, or vice versa) is
prevented by the single transaction — subject to the Neon-transaction
caveat in §6.7.

---

## 6. Security posture

This is the section to scrutinize most closely before any public deploy.

### 6.1 Sessions — DB-backed, role never from the request

Sessions moved from a module-scoped in-memory `Map` to the `sessions` table
(migration `0003_sessions.sql`, M2.5 inc.1) so a session survives a process
restart and is shared across serverless instances, rather than resetting per
instance. `lib/services/route-guard.ts#resolveSession()` is the load-bearing
function:

```ts
export async function resolveSession(token: string | null): Promise<ResolvedSession> {
  if (!token) return { actor: null, workspaceId: null };
  const [session] = await getDb().select({ personaKey: sessions.personaKey, expiresAt: sessions.expiresAt, workspaceId: sessions.workspaceId })
    .from(sessions).where(eq(sessions.token, token)).limit(1);
  if (!session) return { actor: null, workspaceId: null };
  if (session.expiresAt <= Date.now()) {
    await getDb().delete(sessions).where(eq(sessions.token, token));
    return { actor: null, workspaceId: null };
  }
  return { actor: resolveActor(session.personaKey), workspaceId: session.workspaceId ?? null };
}
```

The actor's **role always comes from `resolveActor(session.personaKey)`** —
a server-side persona directory (`lib/services/actors.ts`) keyed by the
`personaKey` stored server-side at session issuance — never from anything a
client submits in a request body. `extractSessionToken()` reads a bearer
`Authorization` header or the `jeeves_session` cookie; either way the token
is opaque and the role lookup path is identical.

### 6.2 Mutation guard pipeline

`lib/services/route-guard.ts#runMutationGuard(req, body, options)` is the
one pipeline every mutating route calls, in strict order, short-circuiting
on the first failure:

1. **Session** — `resolveSession(extractSessionToken(req))`; no actor → 401,
   no side effects.
2. **Rate limit** — per-client token bucket (`TokenBucketRateLimiter`,
   capacity 20, refill 0.5/s); exceeded → 429.
3. **Input size** — `validateInputSize()` against per-field caps and a total
   payload cap (default 100 KB); fails → 400 with per-field gaps.
4. **Budget** (opt-in via `options.requiresBudget`) — atomic daily reserve
   (§6.3); denied → 429 "demo token budget exhausted for today".

On success, callers get back `{ actor, workspaceId }` — the workspace comes
from the session row, never re-derived from anything client-supplied. A
dedicated, separate slow bucket (`checkSessionAttempt`, 5 attempts / 30s
refill) protects `POST /api/session` itself, which necessarily sits outside
`runMutationGuard` (there is no session yet to check) — this was HIGH
security-review finding #1 (brute-forceable passcode) and is fixed
(`agents-build-log.md` 2026-07-11T09:30Z, T11:15Z).

### 6.3 Atomic per-day token budget

`lib/security/budget.ts#DbBudgetStore.reserveAtomic()` performs the
cap-check-and-increment as one conditional upsert, so PostgreSQL's own row
lock on the conflicting `run_budget` day-row prevents two concurrent
processes from both reading "under cap" before either writes:

```ts
const rows = await db.insert(runBudget)
  .values({ id: day, day, tokensUsed: requested, tokensCap: dailyCap })
  .onConflictDoUpdate({
    target: runBudget.day,
    set: { tokensUsed: sql`${runBudget.tokensUsed} + ${requested}`, tokensCap: dailyCap },
    setWhere: sql`${runBudget.tokensUsed} + ${requested} <= ${dailyCap}`,
  })
  .returning();
```

`.returning()` comes back empty when the `setWhere` predicate fails (i.e.
the reservation would exceed the cap), which the caller treats as denied.
The cap is `500_000` tokens/day (`route-guard.ts`). An `InMemoryBudgetStore`
exists for pure unit tests; production/dev-with-Postgres always uses
`DbBudgetStore`.

### 6.4 Requester ownership + reviewer-domain authorization

`lib/services/actors.ts` holds the server-side actor directory and a
`REVIEWER_DOMAIN` map (each of the four reviewer personas owns exactly one
domain: Elena Vasquez → clinical-safety, Marcus Webb → privacy-hipaa, Sofia
Grant → responsible-ai, James Liu → legal). `reviewerDomainFor(actorId)`
backs a check in the sign/return routes that rejects (403) a reviewer
attempting to act on a domain that isn't theirs. Similarly,
`POST /api/initiatives/[id]/submit` checks the acting actor's directory
display name against `initiatives.requester` and 403s a non-owning
requester (a no-op check for `system`/`admin` actors). Both were added in
M2.5 inc.3 (`agents-build-log.md` 2026-07-11T21:40Z).

### 6.5 Per-browser workspace isolation

This is a **read-scoping hint, not an auth credential**, and the design
constraint behind it is explicit in the build log
(2026-07-11T23:15Z): a naive "one workspace per login" model breaks the
champion demo, because the loop is requester → reviewer → approver as
**separate logins**, and if each login got a fresh isolated workspace the
reviewer/approver couldn't see the requester's just-created initiative. The
adopted model is a **per-browser** workspace, reused across persona
switches within one browser:

- `POST /api/session` (`app/api/session/route.ts`) reads the incoming
  `jeeves_workspace` cookie; if present, the new session is issued bound to
  *that* workspace id instead of a fresh one, and the cookie is
  re-set/refreshed (httpOnly, `sameSite: lax`, 7-day max-age, `secure` in
  production). If absent, a fresh workspace id is derived from the new
  session token and the cookie is set for the first time.
- **Mutations stay bearer-token-only.** `extractSessionToken()` reads
  `Authorization: Bearer` or the (separate) `jeeves_session` cookie for
  auth; the `jeeves_workspace` cookie is never consulted by
  `runMutationGuard` for authorization — it is only read, on the GET/read
  side, by `app/_lib/data-provider.ts#getCurrentWorkspaceId()` to decide
  which rows a page renders. Because a read-scoping cookie cannot authorize
  a mutation, there is no CSRF surface from this cookie.
- `initiatives.workspace_id` is **nullable** and filtering is **entirely
  opt-in**: seeded/shared demo rows stay `NULL` and visible to everyone;
  only rows created by a live, session-bound requester get tagged; omitting
  `viewerWorkspaceId` anywhere (every pre-existing caller) preserves prior
  behavior exactly (`drizzle/0004_initiatives_workspace.sql`).

### 6.6 Other controls

- **Security response headers** — set globally in
  [`next.config.ts`](../next.config.ts)`#headers()`: `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `Strict-Transport-Security` (2yr,
  includeSubDomains, preload), `Permissions-Policy` (camera/mic/geo all
  denied), `X-DNS-Prefetch-Control: off`. Deliberately **no CSP yet** —
  documented as a follow-up requiring a careful nonce/hash rollout so it
  doesn't break Recharts or Next's inline styles/scripts.
- **Passcode verification** (`lib/security/passcode.ts`) uses
  `node:crypto.timingSafeEqual` over length-normalized buffers so response
  timing doesn't leak how close a guess's length is to correct; an empty
  expected passcode is treated as "misconfigured" distinct from "mismatch"
  so misconfiguration fails closed without a confusing 200.
- **Input limits** (`lib/security/input-limits.ts`) — per-field character
  caps plus a total payload cap (default 100 KB); strips C0/C1 control
  characters except tab/newline/CR. Explicitly scoped to size/shape only —
  prompt-injection defense is the agents' job (grounding rules in
  `agents/*/instructions.md`), not this module's.
- **Guarded seeding** (`scripts/seed.ts`) refuses to run when
  `NODE_ENV=production` unless `ALLOW_SEED=1` is explicitly set, preventing
  an accidental reseed of a live hosted demo.
- **Public read path has no unauthenticated mutation endpoint anywhere** —
  independently verified in a dedicated security review
  (`agents-build-log.md` 2026-07-11T09:30Z): guard order is 401→429→400→
  budget on all mutating routes, roles are never read from request bodies,
  LLM markdown is rendered inert (React-escaped, no
  `dangerouslySetInnerHTML` anywhere), and budget is reserved before every
  provider call.

### 6.7 Documented, accepted gaps

- **Rate limiting remains in-memory, per-instance** — sessions and the
  token budget moved to Postgres in M2.5 inc.1, but
  `TokenBucketRateLimiter` was explicitly kept process-local; the build log
  and `lib/services/route-guard.ts`'s own comment both call this "an
  accepted demo posture; shared limiting is a follow-up increment." Fine for
  a single-instance deployment; a multi-instance/multi-region deployment
  would give a visitor a fresh bucket just by landing on a different
  instance.
- **Neon transaction semantics** — resolved in this codebase's current
  state: `lib/db/client.ts` uses `drizzle-orm/neon-serverless` over a
  pooled `@neondatabase/serverless` WebSocket `Pool`, which supports real
  interactive `BEGIN`/`COMMIT`/`ROLLBACK` transactions (Codex,
  `agents-build-log.md` 2026-07-11T14:41Z, superseding the earlier
  `neon-http` stub-transaction gap recorded in `docs/deploy.md` — that doc
  is stale on this point). `docs/deploy.md`'s "Neon HTTP transactions are
  not real transactions" caveat should be read as historical, not current.
  **Note for reviewers:** the top-of-file comment in
  `lib/services/initiative-service.ts` still describes the old
  `drizzle-orm/neon-http` stub-transaction behavior verbatim — that comment
  itself is now stale code-side documentation drift (not just a stale
  standalone doc) and should be updated to reflect the `neon-serverless`
  swap the next time that file is touched.

---

## 7. Testing strategy

- **Hermetic in-memory PGlite** — every Vitest run against the DB layer uses
  [`lib/db/test-client.ts`](../lib/db/test-client.ts)`#createTestDb()`,
  which spins up a brand-new in-memory `PGlite()` instance (no `dataDir`,
  never touches the persistent `./.pglite/` dev store or `DATABASE_URL`) and
  runs **every** migration under `drizzle/` — including the hand-written
  registry-view and append-only-trigger migrations — via
  `migrate(db, { migrationsFolder: "./drizzle" })`. Each test file/case gets
  a fresh, fully-migrated schema; nothing is shared between tests.
- **Route tests mock `getDb()`**, not the route logic: `vi.mock("@/lib/db/client",
  () => ({ getDb: () => testDb }))` with `testDb` created fresh per test via
  `createTestDb()` — the routes' real Drizzle queries execute end-to-end
  against that hermetic DB, so a route test is closer to an integration
  test than a mock-heavy unit test.
- **Every LLM call is mocked by default** — `getAgentPort()` returns the
  deterministic mock adapter whenever `OPENAI_API_KEY` is unset (true for
  every CI/test run unless explicitly overridden), so no test depends on
  network access or a real provider key.
- **The required Playwright golden path**
  ([`tests/e2e/golden-path.spec.ts`](../tests/e2e/golden-path.spec.ts)) has
  two describe blocks:
  - A read-only suite (always runs): the inbox banner/attention table, the
    12-row portfolio, the champion initiative's Critical tier badge and
    intake completeness gap, the Evals tab's "Synthetic data — demo" label,
    the audit console's `member-facing-phi` query returning exactly 4 rows,
    and the controls catalog reporting 17 controls.
  - A live-loop suite, skipped unless `DEMO_PASSCODE` is set in the runner
    environment, that drives the full mutable champion path through the
    real `/api/**` routes across three separate persona logins sharing one
    browser's workspace cookie (requester creates+submits → triage lands
    Critical/8 domains → all 8 domains fan out live via the mock adapter and
    flip to Drafted → Marcus Webb signs Privacy/HIPAA, demonstrating
    reviewer-domain authorization → Angela Torres conditionally approves
    with one condition → the Audit tab shows the decision event).
- **Coverage** — `vitest.config.ts` runs under `jsdom` (chosen up front for
  component tests, even though the DB/logic suites don't need a DOM),
  includes `lib/**`, `app/**`, `scripts/**`, and `tests/**`, and configures
  (but does not yet hard-enforce) coverage reporting targeting >80% on
  `lib/` per plan §8.
- **Toolchain note:** the project's actual scripts run under **npm**
  (`npm test`, `npm run test:e2e`, `npm run lint`), confirmed by
  `package.json`, `package-lock.json` (no `pnpm-lock.yaml` exists), and
  explicit call-outs in both `README.md` and `docs/deploy.md`
  ("npm is the toolchain in use here... despite `AGENTS.md` mentioning
  pnpm"). Treat any reference to `pnpm <script>` in this repo's own docs or
  in the global CLAUDE.md as aspirational/historical, not current.

---

## 8. Known limitations / follow-ups

Pulled directly from `agents-build-log.md` and in-code comments — kept
candid on purpose:

1. **Rate limiting is in-memory and per-instance** (§6.7) — the one
   explicitly-deferred piece of the M2.5 hardening gate; DB-backed sessions
   and budget landed, rate limiting did not.
2. **`dayChains` in `lib/security/budget.ts` is never pruned** — one map
   entry accumulates per distinct day key for the in-process serialization
   fallback path; negligible for a demo's lifetime, unbounded for a
   long-lived server (flagged `TODO(P4)` in the source, review finding #7).
3. **Retry has no backoff sleep** — `lib/workflow/review-run.ts`'s
   `draftWithRetry` retries immediately; acceptable against the
   deterministic mock adapter, called out as needing jittered backoff
   before pointing this at a real, rate-limited provider at scale
   (`agents-build-log.md` 2026-07-11T15:10Z).
4. **`lib/data/index.ts`'s lazy `require()` is Turbopack-incompatible** —
   worked around in `app/_lib/data-provider.ts` (§4.3) rather than fixed at
   the source; the upstream cleanup is still pending.
5. **No Content-Security-Policy** — deliberately deferred pending a
   nonce/hash rollout that won't break Recharts/Next inline scripts (§6.6).
6. **M4 hardening is only partly done** — the control-catalog page exists,
   but exception request/approve/expire/renew/reject/revoke workflows and a
   final full security/accessibility sweep remain open per the plan.md §13b
   milestone map.
7. **Workspace isolation is a foundation, not a hard boundary** — `NULL`
   `workspace_id` rows (all seeded data) remain visible to every visitor by
   design; the isolation added in M2.5 inc.2a/2b scopes *live-created* rows
   only, and is explicitly a read-scoping convenience for the demo, not a
   tenant-isolation guarantee suitable for a genuinely multi-tenant
   deployment.
8. **`docs/deploy.md` and `docs/MORNING-REPORT.md` are snapshots, not
   living docs** — both were written mid-build and are stale on specifics
   (e.g. `docs/deploy.md` still describes the pre-M2.5 `neon-http`
   transaction gap and a 4-domain live loop; `docs/MORNING-REPORT.md`
   predates M2.5 entirely). `agents-build-log.md`'s later entries and the
   current source are authoritative over both.
