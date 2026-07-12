// Shared read-model DTOs — the contract between the DB provider (lib/data/db-provider.ts)
// and the mock provider (lib/data/mock-provider.ts). UI imports ONLY from this file and
// provider.ts. Changing shapes here requires updating both providers in the same commit.
import type { Domain, LifecycleState, OverlayFlags, Tier } from "@/lib/domain/types";

export interface InitiativeSummary {
  slug: string;
  // DB initiative id (e.g. "init-004"). Present from real providers so admin
  // live actions (pause/resume, threshold override) can target seeded
  // initiatives by id; may be absent in a slug-only context.
  initiativeId?: string;
  title: string;
  tier: Tier;
  state: LifecycleState;
  flags: OverlayFlags;
  requester: string;
  accountableApprover: string | null;
  domainsRequired: number;
  domainsSigned: number;
  overdue: boolean;
  storyline: string; // short badge text, e.g. "fast-lane", "breach", "rejected"
}

export interface ReviewRow {
  domain: Domain;
  status: "pending" | "drafted" | "signed" | "returned";
  reviewer: string | null;
  /** When this review entered the queue (review_decision createdAt) — drives the workbench "Age" / queue-aging view. */
  createdAt: string; // ISO
  signedAt: string | null; // ISO
  draftMd: string | null;
  citations: string[]; // MP-§ anchors
}

export interface DecisionRow {
  type: "approved" | "conditionally_approved" | "rejected" | "fast_lane_approved";
  approver: string;
  at: string;
  conditions: { text: string; controlId: string }[];
  citations: string[];
}

export interface ControlRow {
  id: string; // e.g. "H-01", "Q-01"
  name: string;
  domain: Domain | "runtime";
  status: "met" | "pending" | "overdue" | "breached" | "exception_requested";
  policySource: string | null; // e.g. "MP-H v3 §MP-H-2"
  threshold: number | null; // Q-01 only
  evidence: string | null;
}

export interface TelemetrySeries {
  kind:
    | "cost_tokens_usd_day"
    | "eval_hallucination"
    | "eval_relevance"
    | "gpu_util_pct";
  points: { ts: string; value: number }[];
  threshold: number | null; // rendered as a line when present
}

export interface DeploymentRow {
  version: string;
  status: "deployed" | "paused" | "awaiting_promotion_signoff" | "retired";
  at: string;
}

export interface AuditEventRow {
  ts: string;
  actor: string;
  actorRole: string;
  action: string;
  detail: string;
}

export interface InitiativeDetail {
  summary: InitiativeSummary;
  intake: {
    version: number;
    submitted: boolean;
    fields: Record<string, string | boolean | null>;
    missing: string[]; // completeness gaps, e.g. ["data.retentionIntent"]
  } | null;
  reviews: ReviewRow[];
  decisions: DecisionRow[];
  controls: ControlRow[];
  telemetry: TelemetrySeries[];
  deployments: DeploymentRow[];
  events: AuditEventRow[];
}

export interface OutcomeMetrics {
  medianReviewCycleDays: number;
  firstPassCompletenessPct: number;
  reviewerHoursSaved: number;
  evidenceFresh: number;
  evidenceTotal: number;
  overdueControls: number;
}

export type CannedAuditQueryId =
  | "member-facing-phi"
  | "approved-by-torres"
  | "overdue-controls"
  | "q01-control-changes";

export interface AuditQueryRow {
  slug: string | null;
  title: string;
  tier: Tier | null;
  state: string;
  approver: string | null;
  detail: string;
  eventTs: string | null;
}
