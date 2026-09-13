/**
 * Shared domain value types for Jeeves.
 *
 * Pure types only — no runtime logic here. Keep this module free of
 * behavior so every other `lib/` module can depend on it without pulling
 * in framework, DB, or LLM concerns.
 */

/** Deterministic risk tier derived from overlay flags (seed-spec §2.1). */
export type Tier = "low" | "medium" | "high" | "critical";

/**
 * The 8 governance domains visible in Jeeves (plan §1 / seed-spec §2.1).
 * String values match the seed-spec's domain names in kebab-case so they
 * are stable identifiers across the codebase (routing sets, control
 * catalog, audit queries).
 */
export type Domain =
  | "legal"
  | "procurement"
  | "tech-architecture"
  | "responsible-ai"
  | "security"
  | "privacy-hipaa"
  | "clinical-safety"
  | "data-governance";

/**
 * The 6 overlay booleans captured at intake (seed-spec §2.1, in the
 * canonical order: PHI / member-facing / care-coverage influence /
 * vendor-hosted / human-in-the-loop / individual impact).
 */
export interface OverlayFlags {
  /** (1) Does it access PHI? */
  phi: boolean;
  /** (2) Do members interact with or receive its output directly? */
  memberFacing: boolean;
  /** (3) Does it influence care or coverage decisions? */
  careCoverageInfluence: boolean;
  /** (4) Is the model vendor-hosted? */
  vendorHosted: boolean;
  /** (5) Does a qualified human review each output before it takes effect? */
  humanInLoop: boolean;
  /** (6) Does it affect individuals' opportunities, rights, or services? */
  individualImpact: boolean;
}

/** Actor roles recognized by the lifecycle and approval layers. */
export type ActorRole =
  | "requester"
  | "reviewer"
  | "approver"
  | "admin"
  | "program"
  // An unauthenticated visitor submitting a request through the public
  // intake form. Deliberately NOT `requester`: that role already unlocks
  // POST /api/chat/intake and the 8-domain draft-run, both of which spend
  // the shared OpenAI budget, so a public session carrying it would let
  // anonymous callers spend money. Kept separate, `public` is denied by
  // every existing `role !== "requester"` gate by default and holds only
  // what is granted to it explicitly — see lib/lifecycle/public-submission
  // .test.ts for the lock on that.
  | "public"
  | "system";

/**
 * Lifecycle states for an initiative/deployment (plan §5, §8 test 4).
 * `retired` is reachable from any operating state.
 */
export type LifecycleState =
  | "intake_draft"
  | "submitted"
  // Quality-control gate between submission and the review fan-out. triage()
  // asks every required domain at once — eight for a Critical initiative —
  // so a half-complete intake could otherwise spend eight reviewers' time
  // before anyone looked at it. Nothing reaches `triaged` except through
  // here: `submitted --triage-->` was removed deliberately.
  | "in_qc"
  | "triaged"
  | "in_review"
  | "fast_lane_approved"
  | "approved"
  | "conditionally_approved"
  | "rejected"
  | "deployed"
  | "paused"
  | "re_review"
  | "retired";

/** Identifies an actor performing a lifecycle action (not full identity/auth — that's app-layer). */
export interface Actor {
  id: string;
  role: ActorRole;
}

/** A single telemetry observation point for a control's monitored metric. */
export interface Observation {
  /** Epoch milliseconds timestamp of the observation. */
  ts: number;
  /** Observed value (e.g. hallucination rate 0.0–1.0). */
  value: number;
}
