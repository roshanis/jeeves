import type { Actor, ActorRole, LifecycleState } from "../domain/types";

/**
 * Lifecycle state machine (plan §5, §8 test 4).
 *
 * Graph:
 *   intake_draft -> submitted -> triaged -> (in_review | fast_lane_approved)
 *   in_review -> (approved | conditionally_approved | rejected)
 *   (approved | conditionally_approved | fast_lane_approved) -> deployed
 *   deployed <-> paused ; paused -> re_review
 *   re_review -> (approved | deployed via resume | retired)
 *   retired reachable from every operating state (deployed, paused, re_review)
 *
 * Authority rules (encoded declaratively below, enforced in `transition`):
 *   - Only 'approver' may approve / conditionally-approve / reject.
 *     Admin explicitly CANNOT (separation of duties — plan §2 step 8).
 *   - pause / resume: only 'admin' or 'system' (breach automation), and
 *     both REQUIRE a non-empty reason in context (plan §2 step 8).
 *   - fast_lane_approved: only via 'system', and the context must carry the
 *     pre-approved policyId and the named accountableApprover — agents/
 *     automation never hold approval authority without a named human
 *     accountable (plan §1 autonomy reframe).
 */

export type LifecycleAction =
  | "submit"
  | "triage"
  | "start_review"
  | "fast_lane_approve"
  | "approve"
  | "conditionally_approve"
  | "reject"
  | "deploy"
  | "pause"
  | "resume"
  | "open_reassessment"
  | "retire";

/** Caller-supplied context. `ts` is always required — no wall-clock reads here. */
export interface TransitionContext {
  /** Epoch ms timestamp of the action (caller supplies; never Date.now() internally). */
  ts: number;
  /** Human-readable justification. REQUIRED (non-empty) for pause/resume. */
  reason?: string;
  /** Pre-approved fast-lane policy id. REQUIRED for fast_lane_approve. */
  policyId?: string;
  /** Named accountable human approver. REQUIRED for fast_lane_approve. */
  accountableApprover?: string;
}

/** The audit-event payload the caller MUST persist alongside the state change. */
export interface AuditEventPayload {
  actor: Actor;
  action: LifecycleAction;
  before: LifecycleState;
  after: LifecycleState;
  reason: string | null;
  ts: number;
}

export interface TransitionResult {
  before: LifecycleState;
  after: LifecycleState;
  auditEvent: AuditEventPayload;
}

/** Typed error for any rejected transition; `violation` names exactly what rule was broken. */
export class IllegalTransitionError extends Error {
  readonly violation: string;
  readonly state: LifecycleState;
  readonly action: LifecycleAction;
  readonly actorRole: ActorRole;

  constructor(
    violation: string,
    state: LifecycleState,
    action: LifecycleAction,
    actorRole: ActorRole,
  ) {
    super(`Illegal transition: ${violation}`);
    this.name = "IllegalTransitionError";
    this.violation = violation;
    this.state = state;
    this.action = action;
    this.actorRole = actorRole;
  }
}

interface TransitionRule {
  to: LifecycleState;
  /** Roles permitted to perform this action from this state. */
  allowedRoles: readonly ActorRole[];
  /** When true, context.reason must be present and non-empty (after trim). */
  requiresReason?: boolean;
  /** When true, context.policyId and context.accountableApprover must be non-empty. */
  requiresFastLanePolicy?: boolean;
}

type TransitionTable = Partial<
  Record<LifecycleState, Partial<Record<LifecycleAction, TransitionRule>>>
>;

/**
 * Declarative transition table — single source of truth for the lifecycle
 * graph. States absent from the table (rejected, retired) are terminal.
 */
const TRANSITIONS: TransitionTable = {
  intake_draft: {
    submit: { to: "submitted", allowedRoles: ["requester"] },
  },
  submitted: {
    triage: { to: "triaged", allowedRoles: ["system"] },
  },
  triaged: {
    start_review: { to: "in_review", allowedRoles: ["reviewer", "system"] },
    fast_lane_approve: {
      to: "fast_lane_approved",
      allowedRoles: ["system"],
      requiresFastLanePolicy: true,
    },
  },
  in_review: {
    approve: { to: "approved", allowedRoles: ["approver"] },
    conditionally_approve: {
      to: "conditionally_approved",
      allowedRoles: ["approver"],
    },
    reject: { to: "rejected", allowedRoles: ["approver"] },
  },
  approved: {
    deploy: { to: "deployed", allowedRoles: ["admin", "system"] },
  },
  conditionally_approved: {
    deploy: { to: "deployed", allowedRoles: ["admin", "system"] },
  },
  fast_lane_approved: {
    deploy: { to: "deployed", allowedRoles: ["admin", "system"] },
  },
  deployed: {
    pause: {
      to: "paused",
      allowedRoles: ["admin", "system"],
      requiresReason: true,
    },
    retire: { to: "retired", allowedRoles: ["admin"] },
  },
  paused: {
    resume: {
      to: "deployed",
      allowedRoles: ["admin", "system"],
      requiresReason: true,
    },
    open_reassessment: {
      to: "re_review",
      allowedRoles: ["admin", "system"],
    },
    retire: { to: "retired", allowedRoles: ["admin"] },
  },
  re_review: {
    approve: { to: "approved", allowedRoles: ["approver"] },
    resume: {
      to: "deployed",
      allowedRoles: ["admin", "system"],
      requiresReason: true,
    },
    retire: { to: "retired", allowedRoles: ["admin"] },
  },
};

function hasNonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Attempt a lifecycle transition. Pure: validates against the declarative
 * table and returns the new state plus the AuditEvent payload the caller
 * must persist. Throws `IllegalTransitionError` naming the exact violation
 * when the transition is not permitted.
 */
export function transition(
  state: LifecycleState,
  action: LifecycleAction,
  actor: Actor,
  context: TransitionContext,
): TransitionResult {
  const rule = TRANSITIONS[state]?.[action];

  if (!rule) {
    throw new IllegalTransitionError(
      `no transition for action '${action}' from state '${state}'`,
      state,
      action,
      actor.role,
    );
  }

  if (!rule.allowedRoles.includes(actor.role)) {
    throw new IllegalTransitionError(
      `action '${action}' from state '${state}' is restricted to roles [${rule.allowedRoles.join(
        ", ",
      )}]; role '${actor.role}' is not permitted`,
      state,
      action,
      actor.role,
    );
  }

  if (rule.requiresReason && !hasNonEmpty(context.reason)) {
    throw new IllegalTransitionError(
      `action '${action}' from state '${state}' requires a non-empty reason in context`,
      state,
      action,
      actor.role,
    );
  }

  if (rule.requiresFastLanePolicy) {
    if (!hasNonEmpty(context.policyId)) {
      throw new IllegalTransitionError(
        `action '${action}' requires a non-empty policyId in context (pre-approved fast-lane policy)`,
        state,
        action,
        actor.role,
      );
    }
    if (!hasNonEmpty(context.accountableApprover)) {
      throw new IllegalTransitionError(
        `action '${action}' requires a non-empty accountableApprover in context (named accountable approver)`,
        state,
        action,
        actor.role,
      );
    }
  }

  const after = rule.to;
  const reason =
    context.reason !== undefined && context.reason.trim().length > 0
      ? context.reason
      : null;

  return {
    before: state,
    after,
    auditEvent: {
      actor,
      action,
      before: state,
      after,
      reason,
      ts: context.ts,
    },
  };
}
