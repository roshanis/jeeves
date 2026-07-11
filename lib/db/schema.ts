// Real Drizzle Postgres schema — plan.md §5 domain model.
//
// Entities: Initiative, IntakeVersion, RiskAssessment (versioned), ReviewCycle
// (initial | reassessment), ReviewDecision (per domain), DeploymentVersion,
// ControlDefinition, EffectiveControl (versioned, per deployment),
// Observation (synthetic telemetry), Incident, AuditEvent (append-only at
// the DB level — see drizzle/0002_audit_events_append_only.sql), RunBudget,
// Session.
//
// Uniqueness/linkage constraints (plan §5):
//   - one ReviewDecision per (cycle, domain)
//   - breach/incident identity unique per (deployment, control, windowStart)
//   - one RunBudget row per day
//
// The "registry" (plan §5: "Registry = a SQL view over authoritative
// records") is defined as a Postgres view in
// drizzle/0001_initiative_registry_view.sql — a read-only projection over
// initiatives + latest risk assessment + latest deployment, not a table.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------
 * Initiative + Intake
 * ---------------------------------------------------------------------- */

export const initiatives = pgTable("initiatives", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  requester: text("requester").notNull(),
  state: text("state").notNull(), // LifecycleState
  tier: text("tier"), // Tier | null until triaged
  accountableApprover: text("accountable_approver"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const intakeVersions = pgTable(
  "intake_versions",
  {
    id: text("id").primaryKey(),
    initiativeId: text("initiative_id")
      .notNull()
      .references(() => initiatives.id),
    version: integer("version").notNull(),
    submitted: boolean("submitted").notNull().default(false),
    // Overlay flags captured at this intake version (seed-spec §2.1). Nullable
    // fields are permitted (e.g. champion #1's data.retentionIntent is
    // intentionally missing pre-submission).
    fields: jsonb("fields").$type<Record<string, string | boolean | null>>().notNull(),
    missing: jsonb("missing").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("intake_versions_initiative_version_uq").on(t.initiativeId, t.version)],
);

/* -------------------------------------------------------------------------
 * Risk assessment (versioned) + review cycle / decision
 * ---------------------------------------------------------------------- */

export const riskAssessments = pgTable(
  "risk_assessments",
  {
    id: text("id").primaryKey(),
    initiativeId: text("initiative_id")
      .notNull()
      .references(() => initiatives.id),
    version: integer("version").notNull(),
    intakeVersionId: text("intake_version_id")
      .notNull()
      .references(() => intakeVersions.id),
    tier: text("tier").notNull(),
    flags: jsonb("flags").$type<Record<string, boolean>>().notNull(),
    requiredDomains: jsonb("required_domains").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("risk_assessments_initiative_version_uq").on(t.initiativeId, t.version)],
);

export const reviewCycles = pgTable("review_cycles", {
  id: text("id").primaryKey(),
  initiativeId: text("initiative_id")
    .notNull()
    .references(() => initiatives.id),
  kind: text("kind").notNull(), // 'initial' | 'reassessment'
  riskAssessmentId: text("risk_assessment_id")
    .notNull()
    .references(() => riskAssessments.id),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  // Nullable: only reassessment cycles opened from a breach/incident carry this.
  incidentId: text("incident_id"),
});

export const reviewDecisions = pgTable(
  "review_decisions",
  {
    id: text("id").primaryKey(),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => reviewCycles.id),
    domain: text("domain").notNull(),
    status: text("status").notNull(), // 'pending' | 'drafted' | 'signed' | 'returned'
    reviewer: text("reviewer"),
    draftMd: text("draft_md"),
    citations: jsonb("citations").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    returnReason: text("return_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    // plan §5: one ReviewDecision per (cycle, domain).
    uniqueIndex("review_decisions_cycle_domain_uq").on(t.cycleId, t.domain),
  ],
);

/* -------------------------------------------------------------------------
 * Decisions at the initiative level (approve / conditionally approve /
 * reject / fast-lane approve) — distinct from per-domain ReviewDecision
 * rows above. Modeled as its own table so DecisionRow (lib/data/dto.ts) has
 * a direct source with approver + conditions + citations.
 * ---------------------------------------------------------------------- */

export const initiativeDecisions = pgTable("initiative_decisions", {
  id: text("id").primaryKey(),
  initiativeId: text("initiative_id")
    .notNull()
    .references(() => initiatives.id),
  cycleId: text("cycle_id")
    .notNull()
    .references(() => reviewCycles.id),
  type: text("type").notNull(), // 'approved' | 'conditionally_approved' | 'rejected' | 'fast_lane_approved'
  approver: text("approver").notNull(),
  policyId: text("policy_id"), // set for fast_lane_approved
  citations: jsonb("citations").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  conditions: jsonb("conditions")
    .$type<{ text: string; controlId: string }[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
});

/* -------------------------------------------------------------------------
 * Deployment versions
 * ---------------------------------------------------------------------- */

export const deploymentVersions = pgTable("deployment_versions", {
  id: text("id").primaryKey(),
  initiativeId: text("initiative_id")
    .notNull()
    .references(() => initiatives.id),
  version: text("version").notNull(), // e.g. "v1.2", "v2.0", "v2.1"
  status: text("status").notNull(), // 'deployed' | 'paused' | 'awaiting_promotion_signoff' | 'retired'
  modelVersion: text("model_version"),
  selfHosted: boolean("self_hosted").notNull().default(false),
  feedbackProvenanceSignedOff: boolean("feedback_provenance_signed_off").notNull().default(false),
  deployedAt: timestamp("deployed_at", { withTimezone: true }).notNull(),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
});

/* -------------------------------------------------------------------------
 * Control catalog + effective (versioned, per-deployment) controls
 * ---------------------------------------------------------------------- */

export const controlDefinitions = pgTable("control_definitions", {
  id: text("id").primaryKey(), // e.g. "H-01", "Q-01"
  domain: text("domain").notNull(), // Domain | 'runtime' (Q-01)
  name: text("name").notNull(),
  applicability: text("applicability").notNull(),
  policySource: text("policy_source"), // e.g. "MP-H v3 §MP-H-2"; null for Q-01
  owner: text("owner").notNull(),
  requiredEvidence: text("required_evidence").notNull(),
  cadence: text("cadence").notNull(),
  enforcementMode: text("enforcement_mode").notNull(), // 'monitor' | 'gate' | 'block'
  exceptionProcess: text("exception_process"),
  remediationOwner: text("remediation_owner"),
  // Q-01 only: observation kind + tier-default thresholds + sustained window.
  observationKind: text("observation_kind"),
  tierDefaultThresholds: jsonb("tier_default_thresholds").$type<Record<string, number>>(),
  sustainedWindow: integer("sustained_window"),
});

export const effectiveControls = pgTable(
  "effective_controls",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deploymentVersions.id),
    controlId: text("control_id")
      .notNull()
      .references(() => controlDefinitions.id),
    version: integer("version").notNull(),
    status: text("status").notNull(), // 'met' | 'pending' | 'overdue' | 'breached' | 'exception_requested'
    thresholdOverride: doublePrecision("threshold_override"),
    evidence: text("evidence"),
    evidenceAt: timestamp("evidence_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    remediationOwner: text("remediation_owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("effective_controls_deployment_control_version_uq").on(
      t.deploymentId,
      t.controlId,
      t.version,
    ),
  ],
);

/* -------------------------------------------------------------------------
 * Observations (synthetic telemetry)
 * ---------------------------------------------------------------------- */

export const observations = pgTable("observations", {
  id: text("id").primaryKey(),
  deploymentId: text("deployment_id")
    .notNull()
    .references(() => deploymentVersions.id),
  kind: text("kind").notNull(), // 'cost_tokens_usd_day' | 'eval_hallucination' | 'eval_relevance' | 'gpu_util_pct'
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  value: doublePrecision("value").notNull(),
});

/* -------------------------------------------------------------------------
 * Incidents (breach -> paused -> reassessment linkage)
 * ---------------------------------------------------------------------- */

export const incidents = pgTable(
  "incidents",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deploymentVersions.id),
    controlId: text("control_id")
      .notNull()
      .references(() => controlDefinitions.id),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    // Deterministic identity key `${deploymentId}:${controlId}:${windowStartTsMs}`
    // mirroring lib/controls/evaluate.ts's ControlEvaluationResult.identityKey —
    // stored explicitly so re-running the monitor can upsert-on-conflict.
    identityKey: text("identity_key").notNull().unique(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    reviewCycleId: text("review_cycle_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    // plan §5: breach/incident identity unique per (deployment, control, windowStart).
    uniqueIndex("incidents_deployment_control_window_uq").on(
      t.deploymentId,
      t.controlId,
      t.windowStart,
    ),
  ],
);

/* -------------------------------------------------------------------------
 * Audit events — append-only AT THE DB LEVEL. See
 * drizzle/0002_audit_events_append_only.sql for the trigger that rejects
 * UPDATE/DELETE regardless of application role.
 * ---------------------------------------------------------------------- */

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  initiativeId: text("initiative_id").references(() => initiatives.id),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  actor: text("actor").notNull(),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  before: text("before"),
  after: text("after"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});

/* -------------------------------------------------------------------------
 * Run budget — atomic per-day token budget check (plan §3, §8 test 7).
 * ---------------------------------------------------------------------- */

export const runBudget = pgTable(
  "run_budget",
  {
    id: text("id").primaryKey(),
    day: text("day").notNull().unique(), // 'YYYY-MM-DD', one row per day (plan §5)
    tokensUsed: integer("tokens_used").notNull().default(0),
    tokensCap: integer("tokens_cap").notNull(),
  },
  (t) => [uniqueIndex("run_budget_day_uq").on(t.day)],
);

/* -------------------------------------------------------------------------
 * Demo sessions — DB-backed (M2.5 inc.1) so a passcode-issued session and
 * its bound persona survive a process restart / span multiple serverless
 * instances, instead of living in a module-scoped Map. One row per issued
 * session token; expiry enforced in app code (`expiresAt` is an epoch-ms
 * cutoff, checked against `Date.now()` by the route guard).
 * ---------------------------------------------------------------------- */

export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),
  personaKey: text("persona_key").notNull(),
  workspaceId: text("workspace_id").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------
 * Composite PK helper re-export (not used above but kept available for
 * migration authors / future join tables without re-importing drizzle-orm).
 * ---------------------------------------------------------------------- */
export { primaryKey };
