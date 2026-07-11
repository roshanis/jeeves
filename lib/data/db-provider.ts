// DB-backed DataProvider — Drizzle queries over the real schema
// (lib/db/schema.ts), implementing the contract in lib/data/provider.ts.
// The mock provider (lib/data/mock-provider.ts) must stay shape-identical;
// UI code imports only dto.ts + provider.ts.
//
// The demo dataset is small (12 initiatives, a few hundred rows), so each
// method loads the tables it needs in full and assembles the read model in
// memory — simpler and more auditable than a lattice of joins, and well
// within budget for a Neon/PGlite demo database.
import { asc, eq } from "drizzle-orm";
import type { Domain, LifecycleState, OverlayFlags, Tier } from "@/lib/domain/types";
import { resolveThreshold } from "@/lib/controls/evaluate";
import { getDb, type Db } from "@/lib/db/client";
import {
  auditEvents,
  controlDefinitions,
  deploymentVersions,
  effectiveControls,
  initiativeDecisions,
  initiatives,
  intakeVersions,
  observations,
  reviewCycles,
  reviewDecisions,
  riskAssessments,
} from "@/lib/db/schema";
import type {
  AuditEventRow,
  AuditQueryRow,
  CannedAuditQueryId,
  ControlRow,
  DecisionRow,
  DeploymentRow,
  InitiativeDetail,
  InitiativeSummary,
  OutcomeMetrics,
  ReviewRow,
  TelemetrySeries,
} from "./dto";
import type { DataProvider } from "./provider";

const DAY_MS = 24 * 60 * 60 * 1000;

/** GPU quota line rendered on gpu_util_pct panels (seed-spec §4). */
const GPU_QUOTA_PCT = 80;

type InitiativeRecord = typeof initiatives.$inferSelect;
type RiskAssessmentRecord = typeof riskAssessments.$inferSelect;
type ReviewCycleRecord = typeof reviewCycles.$inferSelect;
type ReviewDecisionRecord = typeof reviewDecisions.$inferSelect;
type InitiativeDecisionRecord = typeof initiativeDecisions.$inferSelect;
type DeploymentRecord = typeof deploymentVersions.$inferSelect;
type EffectiveControlRecord = typeof effectiveControls.$inferSelect;
type ControlDefinitionRecord = typeof controlDefinitions.$inferSelect;
type IntakeVersionRecord = typeof intakeVersions.$inferSelect;
type ObservationRecord = typeof observations.$inferSelect;

interface PortfolioSnapshot {
  initiatives: InitiativeRecord[];
  riskAssessments: RiskAssessmentRecord[];
  cycles: ReviewCycleRecord[];
  reviewDecisions: ReviewDecisionRecord[];
  decisions: InitiativeDecisionRecord[];
  deployments: DeploymentRecord[];
  effectiveControls: EffectiveControlRecord[];
  controlDefs: ControlDefinitionRecord[];
  intakes: IntakeVersionRecord[];
  evalObservations: ObservationRecord[];
}

function toIso(d: Date): string {
  return d.toISOString();
}

function flagsFromRecord(record: Record<string, boolean>): OverlayFlags {
  return {
    phi: !!record.phi,
    memberFacing: !!record.memberFacing,
    careCoverageInfluence: !!record.careCoverageInfluence,
    vendorHosted: !!record.vendorHosted,
    humanInLoop: !!record.humanInLoop,
    individualImpact: !!record.individualImpact,
  };
}

/** Fallback for pre-triage initiatives (#1): overlay flags live in intake fields. */
function flagsFromIntakeFields(fields: Record<string, string | boolean | null>): OverlayFlags {
  return {
    phi: fields["overlay.phi"] === true,
    memberFacing: fields["overlay.memberFacing"] === true,
    careCoverageInfluence: fields["overlay.careCoverageInfluence"] === true,
    vendorHosted: fields["overlay.vendorHosted"] === true,
    humanInLoop: fields["overlay.humanInLoop"] === true,
    individualImpact: fields["overlay.individualImpact"] === true,
  };
}

export class DbDataProvider implements DataProvider {
  private readonly db: Db;

  constructor(db?: Db) {
    this.db = db ?? getDb();
  }

  /* ---------------------------------------------------------------- */

  private async loadSnapshot(): Promise<PortfolioSnapshot> {
    const [
      initiativeRows,
      raRows,
      cycleRows,
      rdRows,
      decisionRows,
      deploymentRows,
      ecRows,
      defRows,
      intakeRows,
      evalObsRows,
    ] = await Promise.all([
      this.db.select().from(initiatives).orderBy(asc(initiatives.slug)),
      this.db.select().from(riskAssessments),
      this.db.select().from(reviewCycles),
      this.db.select().from(reviewDecisions),
      this.db.select().from(initiativeDecisions),
      this.db.select().from(deploymentVersions),
      this.db.select().from(effectiveControls),
      this.db.select().from(controlDefinitions),
      this.db.select().from(intakeVersions),
      // Only the eval series is needed portfolio-wide (breach badge);
      // full telemetry is loaded per-initiative in getInitiativeDetail.
      this.db.select().from(observations).where(eq(observations.kind, "eval_hallucination")),
    ]);

    return {
      initiatives: initiativeRows,
      riskAssessments: raRows,
      cycles: cycleRows,
      reviewDecisions: rdRows,
      decisions: decisionRows,
      deployments: deploymentRows,
      effectiveControls: ecRows,
      controlDefs: defRows,
      intakes: intakeRows,
      evalObservations: evalObsRows,
    };
  }

  private latestRiskAssessment(
    snap: PortfolioSnapshot,
    initiativeId: string,
  ): RiskAssessmentRecord | null {
    const rows = snap.riskAssessments
      .filter((r) => r.initiativeId === initiativeId)
      .sort((a, b) => b.version - a.version);
    return rows[0] ?? null;
  }

  private latestCycle(snap: PortfolioSnapshot, initiativeId: string): ReviewCycleRecord | null {
    const rows = snap.cycles
      .filter((c) => c.initiativeId === initiativeId)
      .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
    return rows[0] ?? null;
  }

  private deploymentsOf(snap: PortfolioSnapshot, initiativeId: string): DeploymentRecord[] {
    return snap.deployments
      .filter((d) => d.initiativeId === initiativeId)
      .sort((a, b) => a.deployedAt.getTime() - b.deployedAt.getTime());
  }

  /**
   * The operational deployment: latest 'deployed'/'paused' version (controls
   * and telemetry attach here), falling back to the latest of any status.
   */
  private operationalDeployment(
    snap: PortfolioSnapshot,
    initiativeId: string,
  ): DeploymentRecord | null {
    const all = this.deploymentsOf(snap, initiativeId);
    const operational = all.filter((d) => d.status === "deployed" || d.status === "paused");
    return operational[operational.length - 1] ?? all[all.length - 1] ?? null;
  }

  private controlsOf(snap: PortfolioSnapshot, initiativeId: string): EffectiveControlRecord[] {
    const depIds = new Set(this.deploymentsOf(snap, initiativeId).map((d) => d.id));
    return snap.effectiveControls.filter((ec) => depIds.has(ec.deploymentId));
  }

  private resolvedQ01Threshold(
    snap: PortfolioSnapshot,
    tier: Tier,
    override: number | null,
  ): number | null {
    const q01 = snap.controlDefs.find((d) => d.id === "Q-01");
    if (!q01?.tierDefaultThresholds) return override ?? null;
    return resolveThreshold(
      { tierDefaults: q01.tierDefaultThresholds as Record<Tier, number> },
      tier,
      override,
    );
  }

  /**
   * Short storyline badge (dto.ts) — derived from data, never hardcoded by
   * slug. Precedence handles initiatives matching several rules.
   */
  private storylineOf(snap: PortfolioSnapshot, init: InitiativeRecord): string {
    const state = init.state as LifecycleState;
    if (state === "intake_draft") return "champion";
    if (state === "rejected") return "rejected";

    const decisionTypes = new Set(
      snap.decisions.filter((d) => d.initiativeId === init.id).map((d) => d.type),
    );
    if (decisionTypes.has("fast_lane_approved")) return "fast-lane";

    // Breach candidate: a Q-01 effective control whose monitored series'
    // latest point already exceeds the resolved threshold.
    const ecs = this.controlsOf(snap, init.id);
    const q01 = ecs.find((ec) => ec.controlId === "Q-01");
    if (q01 && init.tier) {
      const threshold = this.resolvedQ01Threshold(
        snap,
        init.tier as Tier,
        q01.thresholdOverride ?? null,
      );
      const series = snap.evalObservations
        .filter((o) => o.deploymentId === q01.deploymentId)
        .sort((a, b) => a.ts.getTime() - b.ts.getTime());
      const latest = series[series.length - 1];
      if (threshold !== null && latest && latest.value > threshold) return "breach";
    }

    const deployments = this.deploymentsOf(snap, init.id);
    if (deployments.some((d) => d.status === "awaiting_promotion_signoff")) return "promotion";
    if (ecs.some((ec) => ec.status === "overdue")) return "overdue";
    if (ecs.some((ec) => ec.status === "exception_requested")) return "exception";

    const cycle = this.latestCycle(snap, init.id);
    const cycleDecisions = cycle
      ? snap.reviewDecisions.filter((rd) => rd.cycleId === cycle.id)
      : [];
    if (cycleDecisions.some((rd) => rd.status === "returned")) return "returned";
    if (state === "conditionally_approved") return "conditional";
    if (deployments.some((d) => d.selfHosted)) return "self-hosted";
    if (state === "in_review") return "in-review";
    return "healthy";
  }

  private summaryOf(snap: PortfolioSnapshot, init: InitiativeRecord): InitiativeSummary {
    const ra = this.latestRiskAssessment(snap, init.id);
    const intake = snap.intakes
      .filter((iv) => iv.initiativeId === init.id)
      .sort((a, b) => b.version - a.version)[0];

    const flags: OverlayFlags = ra
      ? flagsFromRecord(ra.flags)
      : intake
        ? flagsFromIntakeFields(intake.fields)
        : {
            phi: false,
            memberFacing: false,
            careCoverageInfluence: false,
            vendorHosted: false,
            humanInLoop: false,
            individualImpact: false,
          };

    const cycle = this.latestCycle(snap, init.id);
    const cycleDecisions = cycle
      ? snap.reviewDecisions.filter((rd) => rd.cycleId === cycle.id)
      : [];

    const ecs = this.controlsOf(snap, init.id);

    return {
      slug: init.slug,
      title: init.title,
      tier: (init.tier ?? "low") as Tier,
      state: init.state as LifecycleState,
      flags,
      requester: init.requester,
      accountableApprover: init.accountableApprover,
      domainsRequired: ra ? ra.requiredDomains.length : 0,
      domainsSigned: cycleDecisions.filter((rd) => rd.status === "signed").length,
      overdue: ecs.some((ec) => ec.status === "overdue"),
      storyline: this.storylineOf(snap, init),
    };
  }

  /* ---------------------------------------------------------------- */

  async listInitiatives(): Promise<InitiativeSummary[]> {
    const snap = await this.loadSnapshot();
    return snap.initiatives.map((init) => this.summaryOf(snap, init));
  }

  async getInitiativeDetail(slug: string): Promise<InitiativeDetail | null> {
    const snap = await this.loadSnapshot();
    const init = snap.initiatives.find((i) => i.slug === slug);
    if (!init) return null;

    const summary = this.summaryOf(snap, init);

    const intakeRow = snap.intakes
      .filter((iv) => iv.initiativeId === init.id)
      .sort((a, b) => b.version - a.version)[0];
    const intake = intakeRow
      ? {
          version: intakeRow.version,
          submitted: intakeRow.submitted,
          fields: intakeRow.fields,
          missing: intakeRow.missing,
        }
      : null;

    const cycle = this.latestCycle(snap, init.id);
    const reviews: ReviewRow[] = (
      cycle ? snap.reviewDecisions.filter((rd) => rd.cycleId === cycle.id) : []
    )
      .sort((a, b) => a.domain.localeCompare(b.domain))
      .map((rd) => ({
        domain: rd.domain as Domain,
        status: rd.status as ReviewRow["status"],
        reviewer: rd.reviewer,
        signedAt: rd.signedAt ? toIso(rd.signedAt) : null,
        draftMd: rd.draftMd,
        citations: rd.citations,
      }));

    const decisions: DecisionRow[] = snap.decisions
      .filter((d) => d.initiativeId === init.id)
      .sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime())
      .map((d) => ({
        type: d.type as DecisionRow["type"],
        approver: d.approver,
        at: toIso(d.decidedAt),
        conditions: d.conditions,
        citations: d.citations,
      }));

    const operationalDep = this.operationalDeployment(snap, init.id);
    const defById = new Map(snap.controlDefs.map((d) => [d.id, d]));
    const controls: ControlRow[] = (
      operationalDep
        ? snap.effectiveControls.filter((ec) => ec.deploymentId === operationalDep.id)
        : []
    )
      .sort((a, b) => a.controlId.localeCompare(b.controlId))
      .map((ec) => {
        const def = defById.get(ec.controlId);
        const isQ01 = ec.controlId === "Q-01";
        return {
          id: ec.controlId,
          name: def?.name ?? ec.controlId,
          domain: (def?.domain ?? "runtime") as ControlRow["domain"],
          status: ec.status as ControlRow["status"],
          policySource: def?.policySource ?? null,
          threshold: isQ01
            ? this.resolvedQ01Threshold(
                snap,
                (init.tier ?? "low") as Tier,
                ec.thresholdOverride ?? null,
              )
            : null,
          evidence: ec.evidence,
        };
      });

    // Full telemetry for the operational deployment (all kinds).
    let telemetry: TelemetrySeries[] = [];
    if (operationalDep) {
      const obsRows = await this.db
        .select()
        .from(observations)
        .where(eq(observations.deploymentId, operationalDep.id))
        .orderBy(asc(observations.ts));
      const byKind = new Map<string, ObservationRecord[]>();
      for (const o of obsRows) {
        const list = byKind.get(o.kind) ?? [];
        list.push(o);
        byKind.set(o.kind, list);
      }
      telemetry = [...byKind.entries()].map(([kind, rows]) => {
        let threshold: number | null = null;
        if (kind === "eval_hallucination") {
          const q01ec = controls.find((c) => c.id === "Q-01");
          threshold =
            q01ec?.threshold ??
            this.resolvedQ01Threshold(snap, (init.tier ?? "low") as Tier, null);
        } else if (kind === "gpu_util_pct") {
          threshold = GPU_QUOTA_PCT; // quota line (seed-spec §4)
        }
        return {
          kind: kind as TelemetrySeries["kind"],
          points: rows.map((o) => ({ ts: toIso(o.ts), value: o.value })),
          threshold,
        };
      });
    }

    const deployments: DeploymentRow[] = this.deploymentsOf(snap, init.id).map((d) => ({
      version: d.version,
      status: d.status as DeploymentRow["status"],
      at: toIso(d.deployedAt),
    }));

    const eventRows = await this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.initiativeId, init.id))
      .orderBy(asc(auditEvents.ts), asc(auditEvents.id));
    const events: AuditEventRow[] = eventRows.map((e) => ({
      ts: toIso(e.ts),
      actor: e.actor,
      actorRole: e.actorRole,
      action: e.action,
      detail: e.detail,
    }));

    return { summary, intake, reviews, decisions, controls, telemetry, deployments, events };
  }

  async outcomeMetrics(): Promise<OutcomeMetrics> {
    const snap = await this.loadSnapshot();

    // Median review cycle time over CLOSED cycles, in whole days.
    const durations = snap.cycles
      .filter((c) => c.closedAt !== null)
      .map((c) => (c.closedAt!.getTime() - c.openedAt.getTime()) / DAY_MS)
      .sort((a, b) => a - b);
    let medianReviewCycleDays = 0;
    if (durations.length > 0) {
      const mid = Math.floor(durations.length / 2);
      medianReviewCycleDays =
        durations.length % 2 === 1 ? durations[mid]! : (durations[mid - 1]! + durations[mid]!) / 2;
    }

    // First-pass completeness: share of v1 intakes submitted (or drafted)
    // with no missing fields.
    const v1Intakes = snap.intakes.filter((iv) => iv.version === 1);
    const completeFirstPass = v1Intakes.filter((iv) => iv.missing.length === 0).length;
    const firstPassCompletenessPct =
      v1Intakes.length === 0
        ? 0
        : Math.round((completeFirstPass / v1Intakes.length) * 1000) / 10;

    // Reviewer hours saved: drafted-vs-scratch estimate, ~4h per drafted
    // review (seed-spec §6) — a review counts once a draft exists.
    const draftedReviews = snap.reviewDecisions.filter((rd) => rd.draftMd !== null).length;
    const reviewerHoursSaved = draftedReviews * 4;

    // Evidence freshness per initiative: stale when any effective control
    // is overdue or has a pending exception (seed-spec §6: #10, #11 stale).
    const staleInitiatives = new Set<string>();
    const depById = new Map(snap.deployments.map((d) => [d.id, d]));
    for (const ec of snap.effectiveControls) {
      if (ec.status === "overdue" || ec.status === "exception_requested") {
        const dep = depById.get(ec.deploymentId);
        if (dep) staleInitiatives.add(dep.initiativeId);
      }
    }
    const evidenceTotal = snap.initiatives.length;
    const evidenceFresh = evidenceTotal - staleInitiatives.size;

    // Overdue controls (seed-spec §6 definition — 3 seeded):
    //   1. effective controls past their cadence (status 'overdue')      -> #10
    //   2. effective controls with a pending exception on their cadence  -> #11
    //   3. gate controls blocked on missing evidence via a returned
    //      domain review                                                 -> #9
    const overdueEcs = snap.effectiveControls.filter((ec) => ec.status === "overdue").length;
    const exceptionEcs = snap.effectiveControls.filter(
      (ec) => ec.status === "exception_requested",
    ).length;
    const initiativesWithReturnedReview = new Set(
      snap.reviewDecisions
        .filter((rd) => rd.status === "returned")
        .map((rd) => snap.cycles.find((c) => c.id === rd.cycleId)?.initiativeId)
        .filter((id): id is string => !!id),
    ).size;
    const overdueControls = overdueEcs + exceptionEcs + initiativesWithReturnedReview;

    return {
      medianReviewCycleDays,
      firstPassCompletenessPct,
      reviewerHoursSaved,
      evidenceFresh,
      evidenceTotal,
      overdueControls,
    };
  }

  async controlCatalog(): Promise<ControlRow[]> {
    const snap = await this.loadSnapshot();

    // Aggregate a catalog-level status per definition from its effective
    // instances, worst-first. Definitions with no instances yet render as
    // 'met' (nothing attached is in violation — honest for a catalog view;
    // per-deployment status lives on the initiative detail).
    const severity: ControlRow["status"][] = [
      "breached",
      "exception_requested",
      "overdue",
      "pending",
      "met",
    ];
    const statusByControl = new Map<string, ControlRow["status"]>();
    for (const ec of snap.effectiveControls) {
      const current = statusByControl.get(ec.controlId);
      const incoming = ec.status as ControlRow["status"];
      if (!current || severity.indexOf(incoming) < severity.indexOf(current)) {
        statusByControl.set(ec.controlId, incoming);
      }
    }

    return snap.controlDefs
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((def) => ({
        id: def.id,
        name: def.name,
        domain: def.domain as ControlRow["domain"],
        status: statusByControl.get(def.id) ?? "met",
        policySource: def.policySource,
        threshold:
          def.id === "Q-01" && def.tierDefaultThresholds
            ? ((def.tierDefaultThresholds as Record<Tier, number>).high ?? null)
            : null,
        evidence: def.requiredEvidence,
      }));
  }

  async auditQuery(id: CannedAuditQueryId): Promise<AuditQueryRow[]> {
    const snap = await this.loadSnapshot();

    switch (id) {
      case "member-facing-phi": {
        // Seed-spec §7.1: member-facing initiatives touching PHI, with
        // approver + current control status -> #1, #3, #4, #9.
        return snap.initiatives
          .filter((init) => {
            const ra = this.latestRiskAssessment(snap, init.id);
            const intake = snap.intakes
              .filter((iv) => iv.initiativeId === init.id)
              .sort((a, b) => b.version - a.version)[0];
            const flags = ra
              ? flagsFromRecord(ra.flags)
              : intake
                ? flagsFromIntakeFields(intake.fields)
                : null;
            return !!flags && flags.phi && flags.memberFacing;
          })
          .map((init) => {
            const ecs = this.controlsOf(snap, init.id);
            const controlSummary =
              ecs.length === 0
                ? "no effective controls (not deployed)"
                : `controls: ${ecs.length} attached (${
                    ecs.filter((ec) => ec.status === "met").length
                  } met)`;
            return {
              slug: init.slug,
              title: init.title,
              tier: (init.tier ?? null) as Tier | null,
              state: init.state,
              approver: init.accountableApprover,
              detail: controlSummary,
              eventTs: null,
            };
          });
      }

      case "approved-by-torres": {
        // Seed-spec §7.2: everything APPROVED by Angela Torres (any
        // approval type incl. fast-lane/conditional; rejections excluded).
        const initById = new Map(snap.initiatives.map((i) => [i.id, i]));
        return snap.decisions
          .filter((d) => d.approver === "Angela Torres" && d.type !== "rejected")
          .sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime())
          .map((d) => {
            const init = initById.get(d.initiativeId);
            const extras: string[] = [d.type];
            if (d.policyId) extras.push(`policy ${d.policyId}`);
            if (d.conditions.length > 0) extras.push(`${d.conditions.length} open conditions`);
            if (d.citations.length > 0) extras.push(`cites ${d.citations.join(", ")}`);
            return {
              slug: init?.slug ?? null,
              title: init?.title ?? "(unknown initiative)",
              tier: (init?.tier ?? null) as Tier | null,
              state: init?.state ?? "unknown",
              approver: d.approver,
              detail: extras.join(" — "),
              eventTs: toIso(d.decidedAt),
            };
          });
      }

      case "overdue-controls": {
        // Seed-spec §7.3: the 3 overdue controls from §6, each with its
        // remediation owner -> #10 (D-02 overdue), #11 (R-01 exception
        // pending), #9 (R-01 evidence missing via returned review).
        const rows: AuditQueryRow[] = [];
        const depById = new Map(snap.deployments.map((d) => [d.id, d]));
        const initById = new Map(snap.initiatives.map((i) => [i.id, i]));
        const defById = new Map(snap.controlDefs.map((d) => [d.id, d]));

        for (const ec of snap.effectiveControls) {
          if (ec.status !== "overdue" && ec.status !== "exception_requested") continue;
          const dep = depById.get(ec.deploymentId);
          const init = dep ? initById.get(dep.initiativeId) : undefined;
          const def = defById.get(ec.controlId);
          const owner = ec.remediationOwner ?? def?.remediationOwner ?? "unassigned";
          rows.push({
            slug: init?.slug ?? null,
            title: init?.title ?? "(unknown initiative)",
            tier: (init?.tier ?? null) as Tier | null,
            state: ec.status,
            approver: null,
            detail: `${ec.controlId} ${def?.name ?? ""} — remediation owner: ${owner}`.trim(),
            eventTs: ec.dueAt ? toIso(ec.dueAt) : toIso(ec.createdAt),
          });
        }

        // Returned reviews block a gate control's evidence (#9: R-01 bias
        // testing) — surfaced as an overdue control with the definition's
        // remediation owner.
        for (const rd of snap.reviewDecisions) {
          if (rd.status !== "returned") continue;
          const cycle = snap.cycles.find((c) => c.id === rd.cycleId);
          const init = cycle ? initById.get(cycle.initiativeId) : undefined;
          const def = snap.controlDefs.find(
            (d) => d.domain === rd.domain && d.enforcementMode === "gate",
          );
          rows.push({
            slug: init?.slug ?? null,
            title: init?.title ?? "(unknown initiative)",
            tier: (init?.tier ?? null) as Tier | null,
            state: "evidence_missing",
            approver: null,
            detail: `${def?.id ?? rd.domain} ${def?.name ?? ""} — evidence missing (returned review) — remediation owner: ${
              def?.remediationOwner ?? rd.reviewer ?? "unassigned"
            }`.trim(),
            eventTs: rd.signedAt ? toIso(rd.signedAt) : toIso(rd.createdAt),
          });
        }

        return rows.sort((a, b) => (a.slug ?? "").localeCompare(b.slug ?? ""));
      }

      case "q01-control-changes": {
        // Seed-spec §7.4: what changed on Q-01 and who changed it -> the
        // base-30d admin event (Ray Chen, 0.10 -> 0.08).
        const events = await this.db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.action, "control_threshold_changed"))
          .orderBy(asc(auditEvents.ts));
        return events
          .filter((e) => (e.metadata as { controlId?: string } | null)?.controlId === "Q-01")
          .map((e) => {
            const reason = (e.metadata as { reason?: string } | null)?.reason;
            return {
              slug: null,
              title: "Q-01 Eval quality floor",
              tier: null,
              state: "threshold_changed",
              approver: null,
              detail: `${e.actor} (${e.actorRole}): ${e.detail}${
                e.before && e.after ? ` [${e.before} -> ${e.after}]` : ""
              }${reason ? ` — reason: ${reason}` : ""}`,
              eventTs: toIso(e.ts),
            };
          });
      }
    }
  }
}

/** Factory — pass a Db for tests; defaults to the process-wide handle. */
export function createDbProvider(db?: Db): DataProvider {
  return new DbDataProvider(db);
}
