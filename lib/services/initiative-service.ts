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
 * IMPORTANT driver caveat (judgment call, documented per task brief): this
 * module always calls `db.transaction(fn)`. Under PGlite (all tests, and
 * local/dev when DATABASE_URL is unset) this is a REAL transaction with
 * rollback-on-throw. Under the Neon HTTP driver (production, when
 * DATABASE_URL is set) `drizzle-orm/neon-http`'s `transaction()` does not
 * wrap statements in BEGIN/COMMIT/ROLLBACK at all — see
 * node_modules/drizzle-orm/neon-http/session.d.ts, whose `transaction`
 * method takes an unused (`_transaction`) callback parameter. This is a
 * pre-existing limitation of the chosen Neon HTTP driver (plan.md §4), not
 * something introduced or fixable in this module; calling `db.transaction`
 * uniformly is still correct because (a) it is a real transaction in every
 * environment this task's tests exercise, and (b) it keeps the call sites
 * identical if/when the app moves to a pooled Neon driver that does support
 * HTTP-safe transactions. Flagged here and in the task's final report
 * rather than silently working around it.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
import { evaluateCompleteness } from "../intake/completeness";
import type { IntakePayload } from "../intake/types";
import { deriveTier } from "../triage/rules";
import { requiredDomains } from "../triage/routing";
import { fastLaneEligibility } from "../approval/eligibility";
import { applicabilityApplies } from "./applicability";
import { ACTOR_DIRECTORY, FAST_LANE_POLICY, SYSTEM_ACTOR, isPersonaKey, reviewerDomainFor } from "./actors";

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

async function updateInitiativeState(
  tx: Tx,
  initiativeId: string,
  state: LifecycleState,
  extra?: { tier?: Tier; accountableApprover?: string | null },
): Promise<void> {
  await tx
    .update(initiatives)
    .set({
      state,
      ...(extra?.tier !== undefined ? { tier: extra.tier } : {}),
      ...(extra?.accountableApprover !== undefined
        ? { accountableApprover: extra.accountableApprover }
        : {}),
      updatedAt: new Date(nowTs()),
    })
    .where(eq(initiatives.id, initiativeId));
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
  const { payload, requesterActor, requesterName } = input;

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
 */
export async function submitIntake(
  db: Db,
  initiativeId: string,
  actor: Actor,
): Promise<SubmitIntakeResult | SubmitIntakeBlockedResult> {
  return db.transaction(async (tx) => {
    const initiative = await loadInitiativeOrThrow(tx, initiativeId);
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

    await updateInitiativeState(tx, initiativeId, result.after);
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
 */
export async function triage(
  db: Db,
  initiativeId: string,
  actor: Actor = SYSTEM_ACTOR,
): Promise<TriageFastLaneResult | TriageReviewResult> {
  return db.transaction(async (tx) => {
    const initiative = await loadInitiativeOrThrow(tx, initiativeId);
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
    await updateInitiativeState(tx, initiativeId, triageResult.after, { tier });
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
      await updateInitiativeState(tx, initiativeId, flResult.after, {
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
    await updateInitiativeState(tx, initiativeId, startReviewResult.after);
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
  editedDraftMd?: string,
): Promise<SignReviewResult> {
  requireReviewerRole(actor);
  requireReviewerDomainMatch(actor, domain);
  return db.transaction(async (tx) => {
    const decision = await loadReviewDecisionOrThrow(tx, cycleId, domain);
    if (decision.status === "signed") {
      throw new ValidationError(`review for ${domain} in cycle ${cycleId} is already signed`);
    }
    const draftMd = editedDraftMd ?? decision.draftMd;
    if (!draftMd) {
      throw new ValidationError(`cannot sign ${domain} in cycle ${cycleId}: no draft content`);
    }

    await tx
      .update(reviewDecisions)
      .set({ status: "signed", reviewer: actor.id, draftMd, signedAt: new Date(nowTs()) })
      .where(eq(reviewDecisions.id, decision.id));

    const cycle = await tx.select().from(reviewCycles).where(eq(reviewCycles.id, cycleId));
    const initiativeId = cycle[0]?.initiativeId ?? null;

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
  reason: string,
): Promise<ReturnReviewResult> {
  requireReviewerRole(actor);
  requireReviewerDomainMatch(actor, domain);
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError("returnReview requires a non-empty reason");
  }
  return db.transaction(async (tx) => {
    const decision = await loadReviewDecisionOrThrow(tx, cycleId, domain);

    await tx
      .update(reviewDecisions)
      .set({ status: "returned", reviewer: actor.id, returnReason: reason })
      .where(eq(reviewDecisions.id, decision.id));

    const cycle = await tx.select().from(reviewCycles).where(eq(reviewCycles.id, cycleId));
    const initiativeId = cycle[0]?.initiativeId ?? null;

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
  input: DecideInput,
): Promise<DecideResult> {
  const { decision, conditions = [], citations = [] } = input;
  if (decision === "conditionally_approved" && conditions.length === 0) {
    throw new ValidationError("conditionally_approved requires at least one condition");
  }

  return db.transaction(async (tx) => {
    const initiative = await loadInitiativeOrThrow(tx, initiativeId);
    const cycle = await latestReviewCycle(tx, initiativeId);
    if (!cycle) {
      throw new ValidationError("initiative has no review cycle to decide on");
    }

    const action = DECISION_TO_ACTION[decision];
    const result = transition(initiative.state as LifecycleState, action, actor, { ts: nowTs() });

    await updateInitiativeState(tx, initiativeId, result.after, {
      accountableApprover: actor.id,
    });

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

    await tx.update(reviewCycles).set({ closedAt: new Date(nowTs()) }).where(eq(reviewCycles.id, cycle.id));

    await insertAuditEvent(
      tx,
      initiativeId,
      result.auditEvent,
      `${decision} by ${actor.id}${conditions.length > 0 ? ` with ${conditions.length} condition(s)` : ""}.`,
      { conditions, citations },
    );

    return { initiativeId, decisionId, type: decision, after: result.after };
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
 */
export async function generateEffectiveControls(
  db: Db,
  initiativeId: string,
): Promise<GenerateEffectiveControlsResult> {
  return db.transaction(async (tx) => {
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
  });
}
