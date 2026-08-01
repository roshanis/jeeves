/**
 * Transactional domain operations for the initiative lifecycle (plan.md §2
 * champion storyline steps 1-4; task brief deliverable 1).
 *
 * Every state-changing operation here:
 *   1. Calls `lib/lifecycle/transitions.ts#transition()` — the ONLY source
 *      of truth for whether a lifecycle move is legal (role/SoD/reason
 *      checks happen there, not here).
 *   2. Persists the domain-row change (e.g. `initiatives.state`) AND the
 *      returned `AuditEvent` payload in the SAME `db.transaction()` call —
 *      plan.md §8 "transactionality": a partial write (state changed, no
 *      audit row, or vice versa) must never be observable.
 *
 * Driver note (corrected — a prior version of this comment claimed
 * `db.transaction()` was a no-op under the Neon HTTP driver; that is no
 * longer accurate and misled a reviewer): `lib/db/client.ts` builds its
 * production `Db` handle via `drizzle-orm/neon-serverless` over a
 * process-wide `@neondatabase/serverless` WebSocket `Pool`, specifically
 * *because* the application requires real interactive transaction support
 * (see that file's header). `db.transaction(fn)` is therefore a REAL
 * transaction with rollback-on-throw in every environment this module runs
 * in: PGlite (all tests, and local/dev when `DATABASE_URL` is unset) and the
 * pooled Neon WebSocket driver (production, when `DATABASE_URL` is set)
 * alike — including the compare-and-set (CAS) reads-then-writes and
 * multi-statement writes throughout this file, which depend on that
 * transactional isolation being real, not simulated.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../db/schema";
import {
  auditEvents,
  controlDefinitions,
  deploymentVersions,
  effectiveControls,
  initiativeDecisions,
  initiatives,
  intakeVersions,
  reviewCycles,
  reviewDecisions,
  riskAssessments,
} from "../db/schema";
import type { Actor, Domain, LifecycleState, OverlayFlags, Tier } from "../domain/types";
import { transition, IllegalTransitionError, type AuditEventPayload } from "../lifecycle/transitions";
import { runSingleDomainDraft } from "../workflow/review-run";
import type { AgentPort } from "../agents/ports";
import { evaluateCompleteness } from "../intake/completeness";
import type { IntakePayload } from "../intake/types";
import { deriveTier } from "../triage/rules";
import { requiredDomains } from "../triage/routing";
import { fastLaneEligibility } from "../approval/eligibility";
import { applicabilityApplies } from "./applicability";
import { ACTOR_DIRECTORY, FAST_LANE_POLICY, SYSTEM_ACTOR, isPersonaKey, reviewerDomainFor } from "./actors";
import { workspaceMismatch } from "./workspace-guard";

/* -------------------------------------------------------------------------
 * Shared errors
 * ---------------------------------------------------------------------- */

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  readonly issues: readonly string[];
  constructor(message: string, issues: readonly string[] = []) {
    super(message);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

/**
 * Thrown when a compare-and-set UPDATE affects 0 rows because the row's
 * state changed between this transaction's read and its write (security-
 * hardening pass, external-review finding #3: "governance transitions race
 * under concurrency"). Route handlers map this to HTTP 409.
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * Workspace-authorization guard (external-review finding #1): throws the
 * SAME `NotFoundError` shape used for an unknown id when `resource`'s
 * workspace doesn't match the acting session's — a workspace mismatch must
 * never be distinguishable from "this id doesn't exist".
 */
function assertWorkspaceAccess(
  resourceWorkspaceId: string | null,
  sessionWorkspaceId: string | null,
  entity: string,
  id: string,
): void {
  if (workspaceMismatch(resourceWorkspaceId, sessionWorkspaceId)) {
    throw new NotFoundError(entity, id);
  }
}

/**
 * The common base type of both the top-level `Db` handle AND the
 * transaction-scoped handle passed into a `db.transaction(async (tx) => ...)`
 * callback for either driver. `PgTransaction<TQueryResult, ...>` (what `tx`
 * actually is inside the callback) extends `PgDatabase<TQueryResult, ...>`,
 * so typing every helper's `tx` parameter against the HKT-generic base class
 * (rather than the driver-concrete `Db` union) lets the SAME helper accept
 * `tx` from either a Neon HTTP or a PGlite transaction callback — Drizzle's
 * driver-concrete transaction types are not structurally assignable to each
 * other, but both satisfy this common, less specific supertype.
 */
type Tx = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Re-exported so callers (route handlers) can catch by type without a second import. */
export { IllegalTransitionError };

/* -------------------------------------------------------------------------
 * Shared helpers
 * ---------------------------------------------------------------------- */

function nowTs(): number {
  return Date.now();
}

function overlayFromPayload(payload: IntakePayload): OverlayFlags {
  return {
    phi: payload.overlay.touchesPHI === true,
    memberFacing: payload.overlay.memberFacing === true,
    careCoverageInfluence: payload.overlay.careCoverageInfluence === true,
    vendorHosted: payload.overlay.vendorHosted === true,
    humanInLoop: payload.overlay.humanInTheLoop === true,
    individualImpact: payload.overlay.individualImpact === true,
  };
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${base || "initiative"}-${randomUUID().slice(0, 8)}`;
}

/** Persist the AuditEventPayload from `transition()` as an `audit_events` row, in-transaction. */
async function insertAuditEvent(
  tx: Tx,
  initiativeId: string | null,
  payload: AuditEventPayload,
  detail: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditEvents).values({
    id: `evt-${randomUUID()}`,
    initiativeId,
    ts: new Date(payload.ts),
    actor: payload.actor.id,
    actorRole: payload.actor.role,
    action: payload.action,
    detail,
    before: payload.before,
    after: payload.after,
    metadata: metadata ?? null,
  });
}

/**
 * Compare-and-set (CAS) state update (external-review finding P2-5a:
 * "concurrent triage()/submitIntake() duplicate work"). Requires the
 * `observedState` the caller read the row to be in immediately before this
 * write — mirrors `decide()`'s own CAS predicate (`eq(initiatives.state,
 * observedState)` + `.returning()` rowcount check) rather than the prior
 * blind `where(eq(id))` update. Two concurrent `triage()` calls that both
 * read `'submitted'` would, without this predicate, both pass and both
 * write — one call's risk_assessments/review_cycles rows silently
 * duplicating the other's (the 0006 unique index doesn't catch this: the two
 * cycles get different `cycleId`s). With the predicate, the losing call's
 * update affects 0 rows and throws `ConflictError` — always BEFORE that
 * call's OWN risk_assessments/review_cycles writes, since every call site in
 * this file performs its first `updateInitiativeState` for a given
 * transaction before any of its other domain-row writes.
 */
async function updateInitiativeState(
  tx: Tx,
  initiativeId: string,
  observedState: LifecycleState,
  state: LifecycleState,
  extra?: { tier?: Tier; accountableApprover?: string | null },
): Promise<void> {
  const updated = await tx
    .update(initiatives)
    .set({
      state,
      ...(extra?.tier !== undefined ? { tier: extra.tier } : {}),
      ...(extra?.accountableApprover !== undefined
        ? { accountableApprover: extra.accountableApprover }
        : {}),
      updatedAt: new Date(nowTs()),
    })
    .where(and(eq(initiatives.id, initiativeId), eq(initiatives.state, observedState)))
    .returning();
  if (updated.length === 0) {
    throw new ConflictError(
      `initiative ${initiativeId} changed concurrently (expected state '${observedState}')`,
    );
  }
}

async function loadInitiativeOrThrow(
  tx: Tx,
  initiativeId: string,
): Promise<typeof initiatives.$inferSelect> {
  const rows = await tx.select().from(initiatives).where(eq(initiatives.id, initiativeId));
  const row = rows[0];
  if (!row) throw new NotFoundError("initiative", initiativeId);
  return row;
}

/**
 * Requester-ownership guard for requester-role-gated mutations (`submitIntake`
 * and any future one). Ownership is determined by matching the acting
 * actor's directory display name (`ACTOR_DIRECTORY[actor.id].name`) against
 * `initiatives.requester` (a display-name string set at `createDraft` time)
 * — no schema change / no `requesterId` column needed. Only enforced when
 * the acting actor is a requester-role actor, so SYSTEM_ACTOR/admin internal
 * calls that legitimately act on any initiative are never blocked. Throws
 * the same `IllegalTransitionError` type used elsewhere so route handlers
 * map this to 403 without an additional catch clause.
 */
function requireRequesterOwnership(
  actor: Actor,
  initiative: { id: string; slug: string; requester: string },
): void {
  if (actor.role !== "requester") return;
  const actorName = isPersonaKey(actor.id) ? ACTOR_DIRECTORY[actor.id].name : actor.id;
  if (actorName !== initiative.requester) {
    throw new IllegalTransitionError(
      `requester '${actor.id}' does not own initiative '${initiative.slug}'`,
      "intake_draft",
      "submit",
      actor.role,
    );
  }
}

async function latestIntakeVersion(
  tx: Tx,
  initiativeId: string,
): Promise<typeof intakeVersions.$inferSelect | null> {
  const rows = await tx
    .select()
    .from(intakeVersions)
    .where(eq(intakeVersions.initiativeId, initiativeId));
  if (rows.length === 0) return null;
  return rows.slice().sort((a, b) => b.version - a.version)[0]!;
}

async function latestRiskAssessment(
  tx: Tx,
  initiativeId: string,
): Promise<typeof riskAssessments.$inferSelect | null> {
  const rows = await tx
    .select()
    .from(riskAssessments)
    .where(eq(riskAssessments.initiativeId, initiativeId));
  if (rows.length === 0) return null;
  return rows.slice().sort((a, b) => b.version - a.version)[0]!;
}

async function latestReviewCycle(
  tx: Tx,
  initiativeId: string,
): Promise<typeof reviewCycles.$inferSelect | null> {
  const rows = await tx.select().from(reviewCycles).where(eq(reviewCycles.initiativeId, initiativeId));
  if (rows.length === 0) return null;
  return rows.slice().sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())[0]!;
}

/* -------------------------------------------------------------------------
 * 1. createDraft
 * ---------------------------------------------------------------------- */

export interface CreateDraftInput {
  payload: IntakePayload;
  requesterActor: Actor;
  requesterName: string;
  /**
   * Workspace to tag the created initiative with (M2.5 inc.2a foundation).
   * Omitted/undefined/null -> row stays untagged (workspace_id NULL),
   * matching today's behavior for seeded/non-session creation paths.
   */
  workspaceId?: string | null;
}

export interface CreateDraftResult {
  initiativeId: string;
  slug: string;
  intakeVersionId: string;
}

/**
 * Create a new initiative in `intake_draft` state with its first
 * `IntakeVersion` (draft, unsubmitted). No lifecycle transition fires here —
 * `intake_draft` is the initial state a fresh initiative is created in, not
 * a transition target — but the initiative row + v1 intake row are still
 * written atomically together (a row inserted without its intake, or vice
 * versa, would be an equally invalid partial state).
 */
export async function createDraft(db: Db, input: CreateDraftInput): Promise<CreateDraftResult> {
  const { payload, requesterActor, requesterName, workspaceId } = input;

  return db.transaction(async (tx) => {
    const initiativeId = `init-${randomUUID()}`;
    const slug = slugify(payload.basics.title || "untitled-initiative");
    const ts = new Date(nowTs());

    await tx.insert(initiatives).values({
      id: initiativeId,
      slug,
      title: payload.basics.title,
      requester: requesterName,
      state: "intake_draft",
      tier: null,
      accountableApprover: null,
      createdAt: ts,
      updatedAt: ts,
      workspaceId: workspaceId ?? null,
    });

    const completeness = evaluateCompleteness(payload);
    const intakeVersionId = `iv-${randomUUID()}`;
    await tx.insert(intakeVersions).values({
      id: intakeVersionId,
      initiativeId,
      version: 1,
      submitted: false,
      fields: payload as unknown as Record<string, string | boolean | null>,
      missing: completeness.gaps.map((g) => g.field),
      createdAt: ts,
    });

    await tx.insert(auditEvents).values({
      id: `evt-${randomUUID()}`,
      initiativeId,
      ts,
      actor: requesterActor.id,
      actorRole: requesterActor.role,
      action: "intake_draft_created",
      detail: `Created intake draft "${payload.basics.title}".`,
      before: null,
      after: "intake_draft",
      metadata: null,
    });

    return { initiativeId, slug, intakeVersionId };
  });
}

/* -------------------------------------------------------------------------
 * 2. submitIntake — BLOCKING completeness gates submission
 * ---------------------------------------------------------------------- */

export interface SubmitIntakeResult {
  submitted: true;
  completenessPct: number;
}

export interface SubmitIntakeBlockedResult {
  submitted: false;
  gaps: { ruleId: string; level: string; field: string; message: string }[];
}

/**
 * Runs `evaluateCompleteness` against the initiative's latest (unsubmitted)
 * intake version. BLOCKING gaps prevent submission entirely (returns a
 * `submitted: false` result, no lifecycle transition, no DB write) — this
 * is the "BLOCKING gates submission" requirement, enforced before
 * `transition()` is ever called so an illegal-but-blocked submit never
 * reaches the lifecycle layer.
 *
 * `sessionWorkspaceId` (external-review finding P2-4): workspace
 * authorization, enforced BEFORE any business-logic validation — same
 * pattern/error shape as `decide()`/`signReview()`/`returnReview()`. Default
 * `null` so pre-existing internal/seeded callers (which never had a session
 * workspace to pass) keep behaving exactly as before: `null` only ever
 * grants access to a `null`-workspace (seeded/shared) initiative.
 */
export async function submitIntake(
  db: Db,
  initiativeId: string,
  actor: Actor,
  sessionWorkspaceId: string | null = null,
): Promise<SubmitIntakeResult | SubmitIntakeBlockedResult> {
  return db.transaction(async (tx) => {
    const initiative = await loadInitiativeOrThrow(tx, initiativeId);
    assertWorkspaceAccess(initiative.workspaceId, sessionWorkspaceId, "initiative", initiativeId);
    requireRequesterOwnership(actor, initiative);
    const intake = await latestIntakeVersion(tx, initiativeId);
    if (!intake) {
      throw new ValidationError("initiative has no intake version to submit");
    }

    const payload = intake.fields as unknown as IntakePayload;
    const completeness = evaluateCompleteness(payload);

    if (!completeness.canSubmit) {
      return {
        submitted: false,
        gaps: completeness.gaps.map((g) => ({
          ruleId: g.ruleId,
          level: g.level,
          field: g.field,
          message: g.message,
        })),
      };
    }

    const result = transition(initiative.state as LifecycleState, "submit", actor, { ts: nowTs() });

    await tx
      .update(intakeVersions)
      .set({ submitted: true, missing: completeness.gaps.map((g) => g.field) })
      .where(eq(intakeVersions.id, intake.id));

    await updateInitiativeState(tx, initiativeId, initiative.state as LifecycleState, result.after);
    await insertAuditEvent(
      tx,
      initiativeId,
      result.auditEvent,
      `Submitted intake v${intake.version} (${completeness.completenessPct}% complete).`,
      { completenessPct: completeness.completenessPct },
    );

    return { submitted: true, completenessPct: completeness.completenessPct };
  });
}

/* -------------------------------------------------------------------------
 * 3. triage — deriveTier + requiredDomains + risk_assessments +
 *    review_cycle/review_decisions, with the fast-lane branch.
 * ---------------------------------------------------------------------- */

export interface TriageFastLaneResult {
  branch: "fast-lane";
  tier: Tier;
  requiredDomains: Domain[];
  riskAssessmentId: string;
  cycleId: string;
  policyId: string;
  accountableApprover: string;
}

export interface TriageReviewResult {
  branch: "review";
  tier: Tier;
  requiredDomains: Domain[];
  riskAssessmentId: string;
  cycleId: string;
}

/**
 * Deterministic triage (plan.md §2 step 2): derives tier + required domains
 * from the latest intake's overlay flags, writes a versioned
 * `risk_assessments` row, opens an initial `review_cycles` row with one
 * `pending` `review_decisions` row per required domain, and evaluates
 * fast-lane eligibility. When eligible, branches straight to
 * `fast_lane_approved` (system actor, named accountable approver, standing
 * policy FL-2026-01) instead of leaving the initiative in `triaged`/
 * `in_review`.
 *
 * `sessionWorkspaceId` (external-review finding P2-4): workspace
 * authorization, same pattern as `submitIntake()`/`decide()` — enforced
 * before any other read/write. Default `null` so pre-existing internal/
 * seeded callers (which never had a session workspace to pass, and — unlike
 * `sessionWorkspaceId` — sit BEFORE `actor` in this function's positional
 * parameter list, so both must default) keep behaving exactly as before.
 */
export async function triage(
  db: Db,
  initiativeId: string,
  actor: Actor = SYSTEM_ACTOR,
  sessionWorkspaceId: string | null = null,
): Promise<TriageFastLaneResult | TriageReviewResult> {
  return db.transaction(async (tx) => {
    const initiative = await loadInitiativeOrThrow(tx, initiativeId);
    assertWorkspaceAccess(initiative.workspaceId, sessionWorkspaceId, "initiative", initiativeId);
    const intake = await latestIntakeVersion(tx, initiativeId);
    if (!intake) {
      throw new ValidationError("initiative has no intake version to triage");
    }
    const payload = intake.fields as unknown as IntakePayload;
    const flags = overlayFromPayload(payload);
    const tier = deriveTier(flags);
    const domains = [...requiredDomains(tier, flags)].sort() as Domain[];
    const completeness = evaluateCompleteness(payload, tier);

    // 1. triage transition: submitted -> triaged
    const triageResult = transition(initiative.state as LifecycleState, "triage", actor, {
      ts: nowTs(),
    });
    await updateInitiativeState(tx, initiativeId, initiative.state as LifecycleState, triageResult.after, {
      tier,
    });
    await insertAuditEvent(
      tx,
      initiativeId,
      triageResult.auditEvent,
      `Deterministic triage classified tier=${tier} with ${domains.length} required domain(s): ${domains.join(", ")}.`,
      { flags, tier, requiredDomains: domains },
    );

    // 2. risk_assessments row (versioned)
    const existingRa = await tx
      .select()
      .from(riskAssessments)
      .where(eq(riskAssessments.initiativeId, initiativeId));
    const nextVersion = existingRa.length === 0 ? 1 : Math.max(...existingRa.map((r) => r.version)) + 1;
    const riskAssessmentId = `ra-${randomUUID()}`;
    await tx.insert(riskAssessments).values({
      id: riskAssessmentId,
      initiativeId,
      version: nextVersion,
      intakeVersionId: intake.id,
      tier,
      flags: flags as unknown as Record<string, boolean>,
      requiredDomains: domains,
      createdAt: new Date(nowTs()),
    });

    // 3. review_cycle + pending review_decisions per required domain
    const cycleId = `cycle-${randomUUID()}`;
    await tx.insert(reviewCycles).values({
      id: cycleId,
      initiativeId,
      kind: "initial",
      riskAssessmentId,
      openedAt: new Date(nowTs()),
      closedAt: null,
      incidentId: null,
    });
    for (const domain of domains) {
      await tx.insert(reviewDecisions).values({
        id: `rd-${randomUUID()}`,
        cycleId,
        domain,
        status: "pending",
        reviewer: null,
        draftMd: null,
        citations: [],
        signedAt: null,
        returnReason: null,
        createdAt: new Date(nowTs()),
      });
    }

    // 4. fast-lane branch
    const eligibility = fastLaneEligibility({
      tier,
      intakeComplete: completeness.canSubmit,
      flags,
      policy: FAST_LANE_POLICY,
    });

    if (eligibility.eligible) {
      const flResult = transition(triageResult.after, "fast_lane_approve", SYSTEM_ACTOR, {
        ts: nowTs(),
        policyId: FAST_LANE_POLICY.policyId,
        accountableApprover: FAST_LANE_POLICY.accountableApprover,
      });
      await updateInitiativeState(tx, initiativeId, triageResult.after, flResult.after, {
        accountableApprover: FAST_LANE_POLICY.accountableApprover,
      });
      await insertAuditEvent(
        tx,
        initiativeId,
        flResult.auditEvent,
        `Fast-lane approved under standing authority ${FAST_LANE_POLICY.policyId}; named accountable approver ${FAST_LANE_POLICY.accountableApprover}.`,
        { policyId: FAST_LANE_POLICY.policyId },
      );
      await tx.insert(initiativeDecisions).values({
        id: `decision-${randomUUID()}`,
        initiativeId,
        cycleId,
        type: "fast_lane_approved",
        approver: FAST_LANE_POLICY.accountableApprover,
        policyId: FAST_LANE_POLICY.policyId,
        citations: [],
        conditions: [],
        decidedAt: new Date(nowTs()),
      });

      // Live parity with seeded fast-lane initiatives (external-review
      // finding #4): seed-spec #2 (marketing-ab-tester) carries
      // effective_controls against a deployment row, so a LIVE fast-lane
      // approval generates them too — same inner call `decide()` uses for
      // approved/conditionally_approved, run inside this same transaction.
      // Not surfaced on `TriageFastLaneResult` (kept additive/minimal on
      // the client-facing type); callers that need it read the DB/UI, same
      // as every other side effect of triage().
      await generateEffectiveControlsInTx(tx, initiativeId);

      return {
        branch: "fast-lane",
        tier,
        requiredDomains: domains,
        riskAssessmentId,
        cycleId,
        policyId: FAST_LANE_POLICY.policyId,
        accountableApprover: FAST_LANE_POLICY.accountableApprover,
      };
    }

    // Non-fast-lane: open the review immediately (triaged -> in_review) so the
    // review cycle/decisions just created are actionable right away — matching
    // plan.md §2 step 2's "eve drafts 4 live" starting straight after triage,
    // with no separate human action needed to "start" the review.
    const startReviewResult = transition(triageResult.after, "start_review", SYSTEM_ACTOR, {
      ts: nowTs(),
    });
    await updateInitiativeState(tx, initiativeId, triageResult.after, startReviewResult.after);
    await insertAuditEvent(
      tx,
      initiativeId,
      startReviewResult.auditEvent,
      `Opened review cycle ${cycleId} for ${domains.length} required domain(s).`,
      { cycleId },
    );

    return { branch: "review", tier, requiredDomains: domains, riskAssessmentId, cycleId };
  });
}

/* -------------------------------------------------------------------------
 * 4. signReview / returnReview — reviewer-only, per (cycle, domain)
 * ---------------------------------------------------------------------- */

async function loadReviewDecisionOrThrow(
  tx: Tx,
  cycleId: string,
  domain: Domain,
): Promise<typeof reviewDecisions.$inferSelect> {
  const rows = await tx
    .select()
    .from(reviewDecisions)
    .where(and(eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, domain)));
  const row = rows[0];
  if (!row) throw new NotFoundError("reviewDecision", `${cycleId}/${domain}`);
  return row;
}

/** Reviewer-role guard shared by signReview/returnReview (role isn't enforced by `transition()` — ReviewDecision isn't a lifecycle state). */
function requireReviewerRole(actor: Actor): void {
  if (actor.role !== "reviewer") {
    throw new IllegalTransitionError(
      `only role 'reviewer' may sign or return a domain review; role '${actor.role}' is not permitted`,
      "in_review",
      "start_review",
      actor.role,
    );
  }
}

/**
 * Reviewer-domain-assignment guard shared by signReview/returnReview,
 * enforced AFTER `requireReviewerRole`. Each of the 4 named reviewer
 * personas owns exactly one governance domain (`reviewerDomainFor`,
 * mirroring the client's `REVIEWER_DOMAIN`); a reviewer may only sign/return
 * a review in THEIR domain. A reviewer with no standing assignment
 * (`reviewerDomainFor` returns `null`) can sign nothing. Reuses
 * `IllegalTransitionError` — the same type `requireReviewerRole` throws —
 * so route handlers map this to 403 without any additional catch clause.
 */
function requireReviewerDomainMatch(actor: Actor, domain: Domain): void {
  const assignedDomain = reviewerDomainFor(actor.id);
  if (assignedDomain !== domain) {
    throw new IllegalTransitionError(
      `reviewer '${actor.id}' is assigned to '${assignedDomain ?? "none"}', not '${domain}'`,
      "in_review",
      "start_review",
      actor.role,
    );
  }
}

export interface SignReviewResult {
  cycleId: string;
  domain: Domain;
  status: "signed";
}

/**
 * Reviewer signs off a domain's review, recording the edited draft
 * (`editedDraftMd`, defaulting to the existing draft when omitted) as the
 * signed content. Reviewer-only (SoD); does not by itself transition the
 * initiative lifecycle state — `decide()` closes out the initiative once
 * enough domains are signed, matching plan.md §5 (ReviewDecision is
 * per-domain, distinct from the initiative-level Decision).
 */
export async function signReview(
  db: Db,
  cycleId: string,
  domain: Domain,
  actor: Actor,
  sessionWorkspaceId: string | null,
  editedDraftMd?: string,
): Promise<SignReviewResult> {
  requireReviewerRole(actor);
  requireReviewerDomainMatch(actor, domain);
  return db.transaction(async (tx) => {
    const decision = await loadReviewDecisionOrThrow(tx, cycleId, domain);

    // Resolve the owning initiative's workspace up front (also needed below
    // for the audit event's initiativeId — one lookup, reused) and enforce
    // workspace authorization BEFORE any business-logic validation.
    const cycle = await tx.select().from(reviewCycles).where(eq(reviewCycles.id, cycleId));
    const initiativeId = cycle[0]?.initiativeId ?? null;
    if (initiativeId) {
      const [initiative] = await tx
        .select({ workspaceId: initiatives.workspaceId })
        .from(initiatives)
        .where(eq(initiatives.id, initiativeId));
      if (initiative) {
        assertWorkspaceAccess(
          initiative.workspaceId,
          sessionWorkspaceId,
          "reviewDecision",
          `${cycleId}/${domain}`,
        );
      }
    }

    if (decision.status === "signed") {
      throw new ValidationError(`review for ${domain} in cycle ${cycleId} is already signed`);
    }
    const draftMd = editedDraftMd ?? decision.draftMd;
    if (!draftMd) {
      throw new ValidationError(`cannot sign ${domain} in cycle ${cycleId}: no draft content`);
    }

    // Compare-and-set (external-review finding #3): only write if the row's
    // status is still what THIS transaction observed it to be.
    const updated = await tx
      .update(reviewDecisions)
      .set({ status: "signed", reviewer: actor.id, draftMd, signedAt: new Date(nowTs()) })
      .where(and(eq(reviewDecisions.id, decision.id), eq(reviewDecisions.status, decision.status)))
      .returning();
    if (updated.length === 0) {
      throw new ConflictError(
        `review ${domain} in cycle ${cycleId} changed concurrently (expected status '${decision.status}')`,
      );
    }

    await tx.insert(auditEvents).values({
      id: `evt-${randomUUID()}`,
      initiativeId,
      ts: new Date(nowTs()),
      actor: actor.id,
      actorRole: actor.role,
      action: "review_signed",
      detail: `Signed ${domain} review for cycle ${cycleId}.`,
      before: decision.status,
      after: "signed",
      metadata: { domain, cycleId },
    });

    return { cycleId, domain, status: "signed" };
  });
}

export interface ReturnReviewResult {
  cycleId: string;
  domain: Domain;
  status: "returned";
}

/** Reviewer returns a domain review with a required reason (routes back to the requester). */
export async function returnReview(
  db: Db,
  cycleId: string,
  domain: Domain,
  actor: Actor,
  sessionWorkspaceId: string | null,
  reason: string,
): Promise<ReturnReviewResult> {
  requireReviewerRole(actor);
  requireReviewerDomainMatch(actor, domain);
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError("returnReview requires a non-empty reason");
  }
  return db.transaction(async (tx) => {
    const decision = await loadReviewDecisionOrThrow(tx, cycleId, domain);

    const cycle = await tx.select().from(reviewCycles).where(eq(reviewCycles.id, cycleId));
    const initiativeId = cycle[0]?.initiativeId ?? null;
    if (initiativeId) {
      const [initiative] = await tx
        .select({ workspaceId: initiatives.workspaceId })
        .from(initiatives)
        .where(eq(initiatives.id, initiativeId));
      if (initiative) {
        assertWorkspaceAccess(
          initiative.workspaceId,
          sessionWorkspaceId,
          "reviewDecision",
          `${cycleId}/${domain}`,
        );
      }
    }

    const updated = await tx
      .update(reviewDecisions)
      .set({ status: "returned", reviewer: actor.id, returnReason: reason })
      .where(and(eq(reviewDecisions.id, decision.id), eq(reviewDecisions.status, decision.status)))
      .returning();
    if (updated.length === 0) {
      throw new ConflictError(
        `review ${domain} in cycle ${cycleId} changed concurrently (expected status '${decision.status}')`,
      );
    }

    await tx.insert(auditEvents).values({
      id: `evt-${randomUUID()}`,
      initiativeId,
      ts: new Date(nowTs()),
      actor: actor.id,
      actorRole: actor.role,
      action: "review_returned",
      detail: `Returned ${domain} review for cycle ${cycleId}: ${reason}`,
      before: decision.status,
      after: "returned",
      metadata: { domain, cycleId, reason },
    });

    return { cycleId, domain, status: "returned" };
  });
}

/* -------------------------------------------------------------------------
 * 4b. runReviewAgent — reviewer runs their domain's drafting agent on demand
 * ---------------------------------------------------------------------- */

export interface RunReviewAgentResult {
  cycleId: string;
  domain: Domain;
  status: "drafted" | "failed";
  /** Fresh draft markdown — present only when status === "drafted". */
  draftMd?: string;
  /** Human-readable failure reason — present only when status === "failed". */
  error?: string;
}

/**
 * A reviewer runs the drafting agent for THEIR domain on demand (M3 operate
 * loop — the "Run agent" button in the workbench). Same authz as
 * sign/return: reviewer-role only, and only for the domain that reviewer is
 * assigned to (`requireReviewerDomainMatch`) — so no reviewer can trigger
 * another domain's agent. Refuses to re-draft a review that is already
 * `signed` (a human decision; the reviewer must `return` it first). Delegates
 * the actual (re)draft to `runSingleDomainDraft` and records ONE
 * actor-attributed `review_agent_run` audit event — distinct from the
 * `system` `draft_run_completed` event the fan-out writes.
 *
 * NOT wrapped in a single `db.transaction`: the draft persist happens inside
 * `runSingleDomainDraft` immediately after the (slow, network) LLM call, and
 * holding a DB transaction open across that call would be wrong. The audit
 * row is appended right after; the only failure window (draft saved, audit
 * append failed) is benign for an append-only log and never corrupts
 * lifecycle state (a draft is not a lifecycle transition).
 */
export async function runReviewAgent(
  db: Db,
  cycleId: string,
  domain: Domain,
  actor: Actor,
  sessionWorkspaceId: string | null,
  /** Overridable for tests (inject a fake AgentPort); defaults to the real port inside runSingleDomainDraft. */
  port?: AgentPort,
): Promise<RunReviewAgentResult> {
  requireReviewerRole(actor);
  requireReviewerDomainMatch(actor, domain);

  // The (cycle, domain) review must exist and must not already be signed.
  const decisionRows = await db
    .select()
    .from(reviewDecisions)
    .where(and(eq(reviewDecisions.cycleId, cycleId), eq(reviewDecisions.domain, domain)));
  const decision = decisionRows[0];
  if (!decision) throw new NotFoundError("reviewDecision", `${cycleId}/${domain}`);

  // Not wrapped in a transaction (see file comment above) — best-effort
  // workspace check against the current committed state, same as every
  // other read/write in this function.
  const cycleRows = await db.select().from(reviewCycles).where(eq(reviewCycles.id, cycleId));
  const initiativeId = cycleRows[0]?.initiativeId ?? null;
  if (initiativeId) {
    const [initiative] = await db
      .select({ workspaceId: initiatives.workspaceId })
      .from(initiatives)
      .where(eq(initiatives.id, initiativeId));
    if (initiative) {
      assertWorkspaceAccess(
        initiative.workspaceId,
        sessionWorkspaceId,
        "reviewDecision",
        `${cycleId}/${domain}`,
      );
    }
  }

  if (decision.status === "signed") {
    throw new ValidationError(
      `review for ${domain} in cycle ${cycleId} is already signed; return it before re-drafting`,
    );
  }

  const outcome = await runSingleDomainDraft(db, cycleId, domain, port);
  await db.insert(auditEvents).values({
    id: `evt-${randomUUID()}`,
    initiativeId,
    ts: new Date(nowTs()),
    actor: actor.id,
    actorRole: actor.role,
    action: "review_agent_run",
    detail:
      outcome.status === "drafted"
        ? `Ran the ${domain} review agent on demand — fresh draft generated.`
        : `Ran the ${domain} review agent on demand — draft failed: ${outcome.error ?? "unknown error"}.`,
    before: decision.status,
    after: outcome.status === "drafted" ? "drafted" : decision.status,
    metadata: { domain, cycleId, status: outcome.status },
  });

  return outcome;
}

/* -------------------------------------------------------------------------
 * 5. decide — approver-only initiative-level decision (SoD via transition())
 * ---------------------------------------------------------------------- */

export type DecisionType = "approved" | "conditionally_approved" | "rejected";

export interface DecideInput {
  decision: DecisionType;
  conditions?: { text: string; controlId: string }[];
  citations?: string[];
}

export interface DecideResult {
  initiativeId: string;
  decisionId: string;
  type: DecisionType;
  after: LifecycleState;
  /**
   * Present only when `type` is `approved` or `conditionally_approved`
   * (external-review finding #4: "the live champion workflow stops before
   * control generation") — the effective-controls generation `decide()` now
   * runs itself, in the SAME transaction as the decision, right after the
   * decision row + closed cycle + audit event. Absent for `rejected`:
   * nothing to control.
   */
  controlsGenerated?: { deploymentId: string; created: number };
}

const DECISION_TO_ACTION = {
  approved: "approve",
  conditionally_approved: "conditionally_approve",
  rejected: "reject",
} as const;

/**
 * Approver-only initiative-level decision (plan.md §2 step 3). SoD is
 * enforced by `transition()` itself (`in_review`'s approve/conditionally_
 * approve/reject rules only permit role `approver`) — this function does
 * not duplicate that check, it just surfaces `IllegalTransitionError`
 * unchanged so a caller (route handler) can map it to 403.
 */
export async function decide(
  db: Db,
  initiativeId: string,
  actor: Actor,
  sessionWorkspaceId: string | null,
  input: DecideInput,
): Promise<DecideResult> {
  const { decision, conditions = [], citations = [] } = input;
  if (decision === "conditionally_approved" && conditions.length === 0) {
    throw new ValidationError("conditionally_approved requires at least one condition");
  }

  return db.transaction(async (tx) => {
    const initiative = await loadInitiativeOrThrow(tx, initiativeId);
    assertWorkspaceAccess(initiative.workspaceId, sessionWorkspaceId, "initiative", initiativeId);
    const cycle = await latestReviewCycle(tx, initiativeId);
    if (!cycle) {
      throw new ValidationError("initiative has no review cycle to decide on");
    }

    const action = DECISION_TO_ACTION[decision];
    // transition() enforces SoD/role FIRST (only an approver may decide) — so
    // a non-approver gets IllegalTransitionError before any completeness rule.
    const result = transition(initiative.state as LifecycleState, action, actor, { ts: nowTs() });

    // Required-review completeness gate (M2.5, hardened for external-review
    // finding P2-6 "vacuous completeness gate"): an approval cannot outrun
    // the domain reviews. The REQUIRED domain set is resolved from the
    // cycle's OWN risk assessment (`reviewCycles.riskAssessmentId` ->
    // `riskAssessments.requiredDomains`) — NOT from whichever
    // `review_decisions` rows happen to exist for the cycle. A reassessment
    // cycle opened by `runMonitor` (lib/services/monitor-service.ts) is
    // created with ZERO `review_decisions` rows by design (no per-domain
    // redraft happens automatically on a breach), and even an initial cycle
    // could in principle be short a row for one of its required domains;
    // deriving "required" from "rows that happen to exist" made either shape
    // pass vacuously — a post-breach re_review -> approved needed no signed
    // review at all. Falls back to the initiative's latest risk assessment
    // if the cycle's own `riskAssessmentId` doesn't resolve one; if NEITHER
    // resolves, an approval must never proceed with no required-domain set
    // at all, so this throws `ValidationError` rather than silently passing.
    //
    // A full `approved` requires a SIGNED row for EVERY required domain; a
    // `conditionally_approved` requires every required domain at least
    // DRAFTED (a missing, pending, returned, or failed review is blocking —
    // the conditions capture residual risk, not an absent review).
    // `rejected` has no completeness precondition. The fast-lane branch
    // (triage()'s `eligibility.eligible` path) never calls `decide()` at
    // all — it writes its own `initiative_decisions` row directly — so it
    // is not, and must not be, routed through this gate.
    if (decision === "approved" || decision === "conditionally_approved") {
      let cycleRequiredDomains: Domain[] | null = null;
      if (cycle.riskAssessmentId) {
        const [cycleRa] = await tx
          .select({ requiredDomains: riskAssessments.requiredDomains })
          .from(riskAssessments)
          .where(eq(riskAssessments.id, cycle.riskAssessmentId));
        if (cycleRa) cycleRequiredDomains = cycleRa.requiredDomains as Domain[];
      }
      if (!cycleRequiredDomains) {
        const fallbackRa = await latestRiskAssessment(tx, initiativeId);
        cycleRequiredDomains = fallbackRa ? (fallbackRa.requiredDomains as Domain[]) : null;
      }
      if (!cycleRequiredDomains || cycleRequiredDomains.length === 0) {
        throw new ValidationError(
          `cannot ${decision}: review cycle ${cycle.id} has no resolvable required-domain set (no risk assessment found for this cycle or the initiative)`,
        );
      }

      const decisions = await tx
        .select()
        .from(reviewDecisions)
        .where(eq(reviewDecisions.cycleId, cycle.id));
      const byDomain = new Map(decisions.map((d) => [d.domain as Domain, d]));

      const blockingDescriptions: string[] = [];
      for (const domain of cycleRequiredDomains) {
        const row = byDomain.get(domain);
        if (!row) {
          blockingDescriptions.push(`${domain}:missing`);
          continue;
        }
        const satisfied =
          decision === "approved"
            ? row.status === "signed"
            : row.status === "signed" || row.status === "drafted";
        if (!satisfied) blockingDescriptions.push(`${domain}:${row.status}`);
      }
      if (blockingDescriptions.length > 0) {
        const need = decision === "approved" ? "signed" : "drafted or signed";
        throw new ValidationError(
          `cannot ${decision}: ${blockingDescriptions.length} of ${cycleRequiredDomains.length} required domain review(s) not ${need} (${blockingDescriptions.join(", ")})`,
        );
      }
    }

    // Compare-and-set (external-review finding #3 — "governance transitions
    // race under concurrency"): only advance the initiative's state if it is
    // STILL the state this transaction read at the top (`initiative.state`).
    // Two concurrent decide() calls both reading 'in_review' would, without
    // this predicate, both pass transition()/completeness above and both
    // write — one silently clobbering the other's decision. Combined with
    // the `initiative_decisions_cycle_uq` unique index (migration 0006),
    // this makes a second concurrent decide() fail loudly instead.
    const updatedInitiative = await tx
      .update(initiatives)
      .set({
        state: result.after,
        accountableApprover: actor.id,
        updatedAt: new Date(nowTs()),
      })
      .where(and(eq(initiatives.id, initiativeId), eq(initiatives.state, initiative.state)))
      .returning();
    if (updatedInitiative.length === 0) {
      throw new ConflictError(
        `initiative ${initiativeId} changed concurrently (expected state '${initiative.state}')`,
      );
    }

    const decisionId = `decision-${randomUUID()}`;
    await tx.insert(initiativeDecisions).values({
      id: decisionId,
      initiativeId,
      cycleId: cycle.id,
      type: decision,
      approver: actor.id,
      policyId: null,
      citations,
      conditions,
      decidedAt: new Date(nowTs()),
    });

    const closedCycle = await tx
      .update(reviewCycles)
      .set({ closedAt: new Date(nowTs()) })
      .where(and(eq(reviewCycles.id, cycle.id), isNull(reviewCycles.closedAt)))
      .returning();
    if (closedCycle.length === 0) {
      throw new ConflictError(`review cycle ${cycle.id} was already closed concurrently`);
    }

    await insertAuditEvent(
      tx,
      initiativeId,
      result.auditEvent,
      `${decision} by ${actor.id}${conditions.length > 0 ? ` with ${conditions.length} condition(s)` : ""}.`,
      { conditions, citations },
    );

    // External-review finding #4 ("the live champion workflow stops before
    // control generation"): approved/conditionally_approved decisions
    // generate the deployment's effective controls right here, in the SAME
    // transaction as the decision — a decision recorded with no controls
    // (or vice versa) must never be observable. `rejected` has nothing to
    // control, so it's skipped. Runs through `generateEffectiveControlsInTx`
    // (section 6 below) rather than the standalone `generateEffectiveControls`
    // export, which opens its OWN transaction and would defeat the
    // atomicity this fixes.
    let controlsGenerated: DecideResult["controlsGenerated"];
    if (decision === "approved" || decision === "conditionally_approved") {
      const controlsResult = await generateEffectiveControlsInTx(tx, initiativeId);
      controlsGenerated = {
        deploymentId: controlsResult.deploymentId,
        created: controlsResult.created.length,
      };
    }

    return { initiativeId, decisionId, type: decision, after: result.after, controlsGenerated };
  });
}

/* -------------------------------------------------------------------------
 * 6. generateEffectiveControls — versioned rows from control_definitions
 *    applicable to tier + flags.
 * ---------------------------------------------------------------------- */

export interface GenerateEffectiveControlsResult {
  deploymentId: string;
  created: { controlId: string; version: number }[];
}

/**
 * Selects every `control_definitions` row (excluding the runtime-only Q-01,
 * which attaches at breach-monitor time, not review time) whose
 * `applicability` matches the initiative's tier + overlay flags, and writes
 * one versioned `effective_controls` row per match against the initiative's
 * most recent deployment. If no deployment exists yet, a placeholder
 * `awaiting_promotion_signoff`-status deployment row is created so the
 * champion storyline (controls generated straight after a conditional
 * approval, before any `deploy` transition) has somewhere to attach them —
 * matching seed-spec #8's shape (conditionally approved, no deployment
 * seeded yet).
 *
 * Takes a transaction-scoped `tx` rather than opening its own — callers that
 * need this as part of a larger atomic write (`decide()`'s post-decision
 * transition, `triage()`'s fast-lane branch — external-review finding #4)
 * call this directly inside their own `db.transaction()`. The standalone
 * `generateEffectiveControls` export below is a thin wrapper for callers
 * that are NOT already inside a transaction.
 */
async function generateEffectiveControlsInTx(
  tx: Tx,
  initiativeId: string,
): Promise<GenerateEffectiveControlsResult> {
  const initiative = await loadInitiativeOrThrow(tx, initiativeId);
  const ra = await latestRiskAssessment(tx, initiativeId);
  if (!ra) {
    throw new ValidationError("initiative has no risk assessment; run triage() first");
  }
  const tier = ra.tier as Tier;
  const flags = ra.flags as unknown as OverlayFlags;

  const defs = await tx.select().from(controlDefinitions);
  const applicable = defs.filter(
    (d) => d.domain !== "runtime" && applicabilityApplies(d.applicability, tier, flags),
  );

  const deploymentRows = await tx
    .select()
    .from(deploymentVersions)
    .where(eq(deploymentVersions.initiativeId, initiativeId));
  let deployment = deploymentRows.slice().sort((a, b) => b.deployedAt.getTime() - a.deployedAt.getTime())[0];
  if (!deployment) {
    const deploymentId = `dep-${randomUUID()}`;
    const ts = new Date(nowTs());
    await tx.insert(deploymentVersions).values({
      id: deploymentId,
      initiativeId,
      version: "v1.0",
      status: "awaiting_promotion_signoff",
      modelVersion: null,
      selfHosted: false,
      feedbackProvenanceSignedOff: false,
      deployedAt: ts,
      pausedAt: null,
      retiredAt: null,
    });
    deployment = {
      id: deploymentId,
      initiativeId,
      version: "v1.0",
      status: "awaiting_promotion_signoff",
      modelVersion: null,
      selfHosted: false,
      feedbackProvenanceSignedOff: false,
      deployedAt: ts,
      pausedAt: null,
      retiredAt: null,
    };
  }

  const existingEcs = await tx
    .select()
    .from(effectiveControls)
    .where(eq(effectiveControls.deploymentId, deployment.id));

  const created: { controlId: string; version: number }[] = [];
  for (const def of applicable) {
    const priorVersions = existingEcs.filter((ec) => ec.controlId === def.id).map((ec) => ec.version);
    const nextVersion = priorVersions.length === 0 ? 1 : Math.max(...priorVersions) + 1;
    await tx.insert(effectiveControls).values({
      id: `ec-${randomUUID()}`,
      deploymentId: deployment.id,
      controlId: def.id,
      version: nextVersion,
      status: "pending",
      thresholdOverride: null,
      evidence: null,
      evidenceAt: null,
      dueAt: null,
      remediationOwner: def.remediationOwner,
      createdAt: new Date(nowTs()),
    });
    created.push({ controlId: def.id, version: nextVersion });
  }

  await tx.insert(auditEvents).values({
    id: `evt-${randomUUID()}`,
    initiativeId,
    ts: new Date(nowTs()),
    actor: SYSTEM_ACTOR.id,
    actorRole: SYSTEM_ACTOR.role,
    action: "effective_controls_generated",
    detail: `Generated ${created.length} effective control(s) for deployment ${deployment.id} (tier=${initiative.tier}).`,
    before: null,
    after: null,
    metadata: { controlIds: created.map((c) => c.controlId) },
  });

  return { deploymentId: deployment.id, created };
}

/**
 * Standalone entry point — a thin wrapper around `generateEffectiveControlsInTx`
 * for callers that are NOT already inside a `db.transaction()` (pre-existing
 * direct callers/tests, and any future ad-hoc "regenerate controls" action).
 * `decide()` and `triage()`'s fast-lane branch call the inner function
 * directly instead, so control-generation shares their transaction rather
 * than opening a second one.
 */
export async function generateEffectiveControls(
  db: Db,
  initiativeId: string,
): Promise<GenerateEffectiveControlsResult> {
  return db.transaction((tx) => generateEffectiveControlsInTx(tx, initiativeId));
}
