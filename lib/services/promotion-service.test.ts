/**
 * Tests for lib/services/promotion-service.ts (RL/version-promotion story,
 * plan.md M3 + docs/seed-spec.md #5 pa-correspondence-model): listing
 * checkpoints awaiting feedback-provenance sign-off, and the approver-only
 * `promoteCheckpoint` action that flips a `deployment_versions` row from
 * `awaiting_promotion_signoff` -> `deployed`, retires the prior deployed
 * version, and writes two audit events transactionally. Mirrors
 * lib/services/admin-service.test.ts's direct-DB, no-HTTP test convention.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { seedDatabase } from "../../scripts/seed";
import { auditEvents, deploymentVersions, initiatives } from "../db/schema";
import { createDraft } from "./initiative-service";
import { CHAMPION_PREFILL_PAYLOAD } from "../intake/champion-prefill";
import {
  listPromotions,
  promoteCheckpoint,
  deploymentHistory,
  rollbackDeployment,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  ConflictError,
  type ProvenanceAttestation,
} from "./promotion-service";

const APPROVER = { id: "angela-torres", role: "approver" as const };
const ADMIN = { id: "ray-chen", role: "admin" as const };
const REVIEWER = { id: "elena-vasquez", role: "reviewer" as const };

const FULL_ATTESTATION: ProvenanceAttestation = {
  feedbackDataSource: "Member correspondence feedback pipeline, Q2 2026 batch.",
  consentBasis: "Covered under standing member-services consent (seed-spec §... correspondence archive).",
  reviewedBy: "Angela Torres",
};

async function paCorrespondenceModelId(db: TestDb): Promise<string> {
  const [init] = await db.select().from(initiatives).where(eq(initiatives.slug, "pa-correspondence-model"));
  return init!.id;
}

async function v21DeploymentId(db: TestDb, initiativeId: string): Promise<string> {
  const rows = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
  const v21 = rows.find((d) => d.version === "v2.1");
  return v21!.id;
}

describe("lib/services/promotion-service", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
    await seedDatabase(db);
  });

  afterEach(async () => {
    await closeTestDb(db);
  });

  describe("listPromotions", () => {
    it("returns the seeded pa-correspondence-model v2.1 checkpoint with initiative context and the superseded version", async () => {
      const list = await listPromotions(db);
      const entry = list.find((p) => p.version === "v2.1");
      expect(entry).toBeTruthy();
      expect(entry!.initiativeSlug).toBe("pa-correspondence-model");
      expect(entry!.initiativeTitle).toBe("Prior-Auth Correspondence Drafting Model");
      expect(entry!.modelVersion).toBe("meridian-correspondence-2.1-checkpoint");
      expect(entry!.feedbackProvenanceSignedOff).toBe(false);
      expect(entry!.supersedesVersion).toBe("v2.0");
      expect(typeof entry!.deployedAt).toBe("string");
    });

    it("does not include the already-deployed v2.0 row (only awaiting_promotion_signoff rows are listed)", async () => {
      const list = await listPromotions(db);
      expect(list.find((p) => p.version === "v2.0")).toBeUndefined();
    });
  });

  describe("promoteCheckpoint — happy path", () => {
    it("promotes v2.1 to deployed, retires v2.0, and writes both audit events", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const v21Id = await v21DeploymentId(db, initiativeId);

      const result = await promoteCheckpoint(
        db,
        v21Id,
        APPROVER,
        null,
        FULL_ATTESTATION,
        "Feedback-provenance reviewed and consent basis confirmed for Q2 2026 batch.",
      );

      expect(result.initiativeId).toBe(initiativeId);
      expect(result.promotedDeploymentVersionId).toBe(v21Id);
      expect(result.promotedVersion).toBe("v2.1");
      expect(result.supersededVersion).toBe("v2.0");
      expect(result.status).toBe("deployed");

      const rows = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      const v21 = rows.find((d) => d.version === "v2.1")!;
      const v20 = rows.find((d) => d.version === "v2.0")!;
      expect(v21.status).toBe("deployed");
      expect(v21.feedbackProvenanceSignedOff).toBe(true);
      expect(v20.status).toBe("retired");
      expect(v20.retiredAt).not.toBeNull();

      const events = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId));
      const promotedEvent = events.find((e) => e.after === "deployed" && e.detail.toLowerCase().includes("promot"));
      const retiredEvent = events.find((e) => e.after === "retired");
      expect(promotedEvent).toBeTruthy();
      expect(promotedEvent!.before).toBe("awaiting_promotion_signoff");
      expect(retiredEvent).toBeTruthy();
      expect(retiredEvent!.before).toBe("deployed");
    });
  });

  describe("promoteCheckpoint — validation", () => {
    it("throws ValidationError when an attestation field is empty", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const v21Id = await v21DeploymentId(db, initiativeId);

      await expect(
        promoteCheckpoint(
          db,
          v21Id,
          APPROVER,
          null,
          { ...FULL_ATTESTATION, feedbackDataSource: "  " },
          "some reason",
        ),
      ).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError when reason is empty", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const v21Id = await v21DeploymentId(db, initiativeId);

      await expect(promoteCheckpoint(db, v21Id, APPROVER, null, FULL_ATTESTATION, "")).rejects.toThrow(
        ValidationError,
      );
    });

    it("throws NotFoundError for an unknown deployment version id", async () => {
      await expect(
        promoteCheckpoint(db, "dep-does-not-exist", APPROVER, null, FULL_ATTESTATION, "reason"),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("promoteCheckpoint — role guard (separation of duties)", () => {
    it("rejects an admin actor with ForbiddenError", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const v21Id = await v21DeploymentId(db, initiativeId);

      await expect(promoteCheckpoint(db, v21Id, ADMIN, null, FULL_ATTESTATION, "reason")).rejects.toThrow(
        ForbiddenError,
      );
    });

    it("rejects a reviewer actor with ForbiddenError", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const v21Id = await v21DeploymentId(db, initiativeId);

      await expect(promoteCheckpoint(db, v21Id, REVIEWER, null, FULL_ATTESTATION, "reason")).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  describe("promoteCheckpoint — idempotent double-promote", () => {
    it("rejects a second promotion attempt on the same (already-promoted) deployment version id", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const v21Id = await v21DeploymentId(db, initiativeId);

      await promoteCheckpoint(db, v21Id, APPROVER, null, FULL_ATTESTATION, "First promotion.");

      await expect(
        promoteCheckpoint(db, v21Id, APPROVER, null, FULL_ATTESTATION, "Second attempt should fail."),
      ).rejects.toThrow();

      // Must not silently no-op or throw a raw/opaque DB error — still deployed once.
      const rows = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      const v21 = rows.find((d) => d.version === "v2.1")!;
      expect(v21.status).toBe("deployed");
    });
  });

  /* -----------------------------------------------------------------------
   * P1 fix — external-review finding: promoteCheckpoint never received the
   * session workspace, so any authenticated session that learned a
   * checkpoint id could promote another workspace's checkpoint. Mirrors
   * rollbackDeployment's "workspace authorization" test block below
   * (same helper shape, same NotFoundError-on-mismatch semantics).
   * -------------------------------------------------------------------- */
  describe("promoteCheckpoint — workspace authorization", () => {
    /** A fresh initiative + two deployment_versions rows (one deployed, one
     * awaiting_promotion_signoff), tagged with `workspaceId`. */
    async function initiativeWithPromotableCheckpointInWorkspace(
      workspaceId: string | null,
    ): Promise<{ initiativeId: string; deployedId: string; awaitingId: string }> {
      const draft = await createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: { id: "priya-raman", role: "requester" },
        requesterName: "Priya Raman",
        workspaceId,
      });
      const deployedId = `dep-current-${randomUUID()}`;
      const awaitingId = `dep-awaiting-${randomUUID()}`;
      await db.insert(deploymentVersions).values({
        id: deployedId,
        initiativeId: draft.initiativeId,
        version: "v1.0",
        status: "deployed",
        modelVersion: null,
        selfHosted: false,
        feedbackProvenanceSignedOff: false,
        deployedAt: new Date(Date.now() - 100_000),
        pausedAt: null,
        retiredAt: null,
      });
      await db.insert(deploymentVersions).values({
        id: awaitingId,
        initiativeId: draft.initiativeId,
        version: "v1.1",
        status: "awaiting_promotion_signoff",
        modelVersion: null,
        selfHosted: false,
        feedbackProvenanceSignedOff: false,
        deployedAt: new Date(),
        pausedAt: null,
        retiredAt: null,
      });
      return { initiativeId: draft.initiativeId, deployedId, awaitingId };
    }

    it("a mismatched workspace session gets NotFoundError (same shape as unknown checkpoint id)", async () => {
      const { awaitingId } = await initiativeWithPromotableCheckpointInWorkspace("ws-A");
      await expect(
        promoteCheckpoint(db, awaitingId, APPROVER, "ws-B", FULL_ATTESTATION, "reason"),
      ).rejects.toThrow(NotFoundError);
      await expect(
        promoteCheckpoint(db, awaitingId, APPROVER, "ws-B", FULL_ATTESTATION, "reason"),
      ).rejects.toThrow(`deploymentVersion not found: ${awaitingId}`);
    });

    it("the owning workspace session succeeds", async () => {
      const { awaitingId } = await initiativeWithPromotableCheckpointInWorkspace("ws-A");
      const result = await promoteCheckpoint(db, awaitingId, APPROVER, "ws-A", FULL_ATTESTATION, "reason");
      expect(result.status).toBe("deployed");
    });

    it("a null-workspace session cannot promote a workspace-tagged initiative's checkpoint", async () => {
      const { awaitingId } = await initiativeWithPromotableCheckpointInWorkspace("ws-A");
      await expect(
        promoteCheckpoint(db, awaitingId, APPROVER, null, FULL_ATTESTATION, "reason"),
      ).rejects.toThrow(NotFoundError);
    });

    it("a seeded (null-workspace) initiative's checkpoint is promotable from ANY session workspace", async () => {
      const { awaitingId } = await initiativeWithPromotableCheckpointInWorkspace(null);
      const result = await promoteCheckpoint(db, awaitingId, APPROVER, "ws-anything", FULL_ATTESTATION, "reason");
      expect(result.status).toBe("deployed");
    });

    it("no partial write happens on a workspace-mismatch rejection", async () => {
      const { initiativeId, deployedId, awaitingId } = await initiativeWithPromotableCheckpointInWorkspace("ws-A");
      await expect(
        promoteCheckpoint(db, awaitingId, APPROVER, "ws-B", FULL_ATTESTATION, "reason"),
      ).rejects.toThrow(NotFoundError);
      const rows = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      expect(rows.find((d) => d.id === deployedId)!.status).toBe("deployed"); // unchanged
      expect(rows.find((d) => d.id === awaitingId)!.status).toBe("awaiting_promotion_signoff"); // unchanged
    });
  });

  /* -----------------------------------------------------------------------
   * P1 fix — external-review finding: the retire update and the promote
   * update carried no status predicate/rowcount assert, so two concurrent
   * promotes of different checkpoints of one initiative could both retire
   * the same row and leave TWO 'deployed' rows. Both updates are now
   * compare-and-set (CAS). True overlapping transactions aren't
   * reproducible against PGlite (see lib/services/initiative-service.test.ts's
   * identical rationale comment), so these tests simulate the race
   * deterministically by injecting a same-transaction write (via `tx`)
   * between promoteCheckpoint's own read and its CAS update — this
   * reproduces the exact DB-visible effect a genuinely concurrent committed
   * write would have (the predicate no longer matches).
   * -------------------------------------------------------------------- */
  describe("promoteCheckpoint — concurrency (compare-and-set)", () => {
    it("retire CAS: a concurrent write that changes the current-deployed row's status before the retire update throws ConflictError, and the whole transaction rolls back", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const v21Id = await v21DeploymentId(db, initiativeId);
      const rows = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      const v20Id = rows.find((d) => d.version === "v2.0")!.id;

      // Test-only same-transaction write injection — `any`-typed by design
      // (the mock surface is a live Drizzle transaction-scoped query builder
      // chain, not meaningfully typeable).
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const dbAny = db as any;
      const realTransaction = dbAny.transaction.bind(dbAny);
      const spy = vi.spyOn(dbAny, "transaction").mockImplementationOnce((cb: any) =>
        realTransaction(async (tx: any) => {
          const realUpdate = tx.update.bind(tx);
          vi.spyOn(tx, "update").mockImplementation((table: any) => {
            const builder = realUpdate(table);
            if (table === deploymentVersions) {
              const realSet = builder.set.bind(builder);
              builder.set = (values: Record<string, unknown>) => {
                const base = realSet(values);
                if (values.status === "retired") {
                  const realWhere = base.where.bind(base);
                  base.where = (cond: unknown) => {
                    const afterWhere = realWhere(cond);
                    const realReturning = afterWhere.returning.bind(afterWhere);
                    afterWhere.returning = async (...args: unknown[]) => {
                      // Simulated concurrent writer: flips the current-deployed
                      // row's status directly, inside the SAME transaction,
                      // between promoteCheckpoint's own read (captured as
                      // `currentDeployed.status`) and its CAS update below.
                      await realUpdate(deploymentVersions)
                        .set({ status: "paused" })
                        .where(eq(deploymentVersions.id, v20Id));
                      return realReturning(...args);
                    };
                    return afterWhere;
                  };
                }
                return base;
              };
            }
            return builder;
          });
          return cb(tx);
        }),
      );
      /* eslint-enable @typescript-eslint/no-explicit-any */

      let caught: unknown;
      try {
        await promoteCheckpoint(db, v21Id, APPROVER, null, FULL_ATTESTATION, "reason");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConflictError);

      spy.mockRestore();

      // Whole transaction rolled back — including the injected write.
      const after = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      expect(after.find((d) => d.id === v20Id)!.status).toBe("deployed");
      expect(after.find((d) => d.id === v21Id)!.status).toBe("awaiting_promotion_signoff");
      // No second 'deployed' row.
      expect(after.filter((d) => d.status === "deployed")).toHaveLength(1);
    });

    it("promote CAS: a concurrent write that changes the target checkpoint's status before the promote update throws ConflictError, and the whole transaction rolls back", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const v21Id = await v21DeploymentId(db, initiativeId);

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const dbAny = db as any;
      const realTransaction = dbAny.transaction.bind(dbAny);
      const spy = vi.spyOn(dbAny, "transaction").mockImplementationOnce((cb: any) =>
        realTransaction(async (tx: any) => {
          const realUpdate = tx.update.bind(tx);
          vi.spyOn(tx, "update").mockImplementation((table: any) => {
            const builder = realUpdate(table);
            if (table === deploymentVersions) {
              const realSet = builder.set.bind(builder);
              builder.set = (values: Record<string, unknown>) => {
                const base = realSet(values);
                if (values.status === "deployed") {
                  const realWhere = base.where.bind(base);
                  base.where = (cond: unknown) => {
                    const afterWhere = realWhere(cond);
                    const realReturning = afterWhere.returning.bind(afterWhere);
                    afterWhere.returning = async (...args: unknown[]) => {
                      // Simulated concurrent writer: flips the target
                      // checkpoint's status directly, inside the SAME
                      // transaction, between promoteCheckpoint's own read
                      // (captured as `target.status`) and its CAS update below.
                      await realUpdate(deploymentVersions)
                        .set({ status: "retired" })
                        .where(eq(deploymentVersions.id, v21Id));
                      return realReturning(...args);
                    };
                    return afterWhere;
                  };
                }
                return base;
              };
            }
            return builder;
          });
          return cb(tx);
        }),
      );
      /* eslint-enable @typescript-eslint/no-explicit-any */

      let caught: unknown;
      try {
        await promoteCheckpoint(db, v21Id, APPROVER, null, FULL_ATTESTATION, "reason");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConflictError);

      spy.mockRestore();

      // Whole transaction rolled back — including the injected write and the
      // retire update that would otherwise have preceded it.
      const after = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      expect(after.find((d) => d.version === "v2.0")!.status).toBe("deployed");
      expect(after.find((d) => d.version === "v2.1")!.status).toBe("awaiting_promotion_signoff");
      expect(after.filter((d) => d.status === "deployed")).toHaveLength(1);
    });
  });

  describe("deploymentHistory", () => {
    it("returns pa-correspondence-model's versions newest-first, with isCurrent set only on the deployed row", async () => {
      const initiativeId = await paCorrespondenceModelId(db);

      const history = await deploymentHistory(db, initiativeId);
      // Seeded: v1.9 (retired), v2.0 (deployed), v2.1 (awaiting sign-off).
      expect(history.length).toBe(3);
      // Newest-first by deployedAt: v2.1 (most recent) then v2.0 then v1.9 (oldest).
      expect(history[0]!.version).toBe("v2.1");
      expect(history[1]!.version).toBe("v2.0");
      expect(history[2]!.version).toBe("v1.9");

      const v20 = history.find((h) => h.version === "v2.0")!;
      const v21 = history.find((h) => h.version === "v2.1")!;
      const v19 = history.find((h) => h.version === "v1.9")!;
      expect(v20.status).toBe("deployed");
      expect(v20.isCurrent).toBe(true);
      expect(v21.status).toBe("awaiting_promotion_signoff");
      expect(v21.isCurrent).toBe(false);
      expect(v19.status).toBe("retired");
      expect(v19.isCurrent).toBe(false);
      expect(typeof v20.deployedAt).toBe("string");
    });

    it("returns an empty array for an initiative with no deployment_versions rows", async () => {
      const [init] = await db.select().from(initiatives).where(eq(initiatives.slug, "provider-dedup-agent"));
      const history = await deploymentHistory(db, init!.id);
      expect(history).toEqual([]);
    });
  });

  describe("rollbackDeployment", () => {
    /**
     * pa-correspondence-model is now seeded with a genuine prior retired
     * version (v1.9) as a rollback target, so these tests use it directly.
     */
    async function seedPriorRetiredVersion(initiativeId: string): Promise<string> {
      const rows = await db
        .select()
        .from(deploymentVersions)
        .where(eq(deploymentVersions.initiativeId, initiativeId));
      const v19 = rows.find((d) => d.version === "v1.9" && d.status === "retired")!;
      return v19.id;
    }

    it("rolls back to the prior retired version, retires the current one, and writes an audit event", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const priorId = await seedPriorRetiredVersion(initiativeId);

      const result = await rollbackDeployment(
        db,
        initiativeId,
        APPROVER,
        null,
        priorId,
        "Rolling back due to regression in v2.0 correspondence quality.",
      );

      expect(result.initiativeId).toBe(initiativeId);
      expect(result.fromVersion).toBe("v2.0");
      expect(result.toVersion).toBe("v1.9");
      expect(result.toDeploymentVersionId).toBe(priorId);
      expect(result.status).toBe("deployed");

      const rows = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      const v20 = rows.find((d) => d.version === "v2.0")!;
      const v19 = rows.find((d) => d.version === "v1.9")!;
      expect(v20.status).toBe("retired");
      expect(v20.retiredAt).not.toBeNull();
      expect(v19.status).toBe("deployed");
      expect(v19.retiredAt).toBeNull();

      const events = await db.select().from(auditEvents).where(eq(auditEvents.initiativeId, initiativeId));
      const rollbackEvent = events.find((e) => e.action === "deployment_rolled_back");
      expect(rollbackEvent).toBeTruthy();
      expect(rollbackEvent!.before).toBe("v2.0");
      expect(rollbackEvent!.after).toBe("v1.9");
      expect((rollbackEvent!.metadata as { fromVersion: string; toVersion: string }).fromVersion).toBe("v2.0");
      expect((rollbackEvent!.metadata as { fromVersion: string; toVersion: string }).toVersion).toBe("v1.9");
    });

    it("also accepts an admin actor (SoD allows approver OR admin for rollback)", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const priorId = await seedPriorRetiredVersion(initiativeId);

      const result = await rollbackDeployment(db, initiativeId, ADMIN, null, priorId, "Admin-initiated rollback.");
      expect(result.status).toBe("deployed");
    });

    it("rejects a reviewer actor with ForbiddenError (SoD)", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const priorId = await seedPriorRetiredVersion(initiativeId);

      await expect(
        rollbackDeployment(db, initiativeId, REVIEWER, null, priorId, "reason"),
      ).rejects.toThrow(ForbiddenError);
    });

    it("throws ValidationError when reason is empty", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const priorId = await seedPriorRetiredVersion(initiativeId);

      await expect(rollbackDeployment(db, initiativeId, APPROVER, null, priorId, "  ")).rejects.toThrow(
        ValidationError,
      );
    });

    it("throws NotFoundError for an unknown initiative id", async () => {
      await expect(
        rollbackDeployment(db, "init-does-not-exist", APPROVER, null, "dep-does-not-exist", "reason"),
      ).rejects.toThrow(NotFoundError);
    });

    it("throws ValidationError when the initiative has no prior (retired/paused) version to roll back to", async () => {
      // member-chat-copilot is seeded with exactly one deployment_versions row
      // (v1.2, deployed) — no prior version exists.
      const [init] = await db.select().from(initiatives).where(eq(initiatives.slug, "member-chat-copilot"));
      const rows = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, init!.id));
      expect(rows.length).toBe(1);

      await expect(
        rollbackDeployment(db, init!.id, APPROVER, null, "dep-does-not-exist", "reason"),
      ).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError when the target deployment version is not retired/paused (e.g. already the current deployed row)", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const rows = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      const v20 = rows.find((d) => d.version === "v2.0")!;

      await expect(
        rollbackDeployment(db, initiativeId, APPROVER, null, v20.id, "reason"),
      ).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError when the target deployment version id does not exist", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      await seedPriorRetiredVersion(initiativeId);

      await expect(
        rollbackDeployment(db, initiativeId, APPROVER, null, "dep-does-not-exist", "reason"),
      ).rejects.toThrow(NotFoundError);
    });
  });

  /* -----------------------------------------------------------------------
   * Security-hardening pass — external-review finding #1: workspace
   * isolation is not an authorization boundary on mutations.
   * -------------------------------------------------------------------- */
  describe("rollbackDeployment — workspace authorization", () => {
    /** A fresh initiative + two deployment_versions rows (deployed + retired), tagged with `workspaceId`. */
    async function initiativeWithDeploymentsInWorkspace(
      workspaceId: string | null,
    ): Promise<{ initiativeId: string; currentId: string; priorId: string }> {
      const draft = await createDraft(db, {
        payload: CHAMPION_PREFILL_PAYLOAD,
        requesterActor: { id: "priya-raman", role: "requester" },
        requesterName: "Priya Raman",
        workspaceId,
      });
      const priorId = `dep-prior-${randomUUID()}`;
      const currentId = `dep-current-${randomUUID()}`;
      await db.insert(deploymentVersions).values({
        id: priorId,
        initiativeId: draft.initiativeId,
        version: "v1.0",
        status: "retired",
        modelVersion: null,
        selfHosted: false,
        feedbackProvenanceSignedOff: false,
        deployedAt: new Date(Date.now() - 100_000),
        pausedAt: null,
        retiredAt: new Date(),
      });
      await db.insert(deploymentVersions).values({
        id: currentId,
        initiativeId: draft.initiativeId,
        version: "v2.0",
        status: "deployed",
        modelVersion: null,
        selfHosted: false,
        feedbackProvenanceSignedOff: false,
        deployedAt: new Date(),
        pausedAt: null,
        retiredAt: null,
      });
      return { initiativeId: draft.initiativeId, currentId, priorId };
    }

    it("a mismatched workspace session gets NotFoundError (same shape as unknown id)", async () => {
      const { initiativeId, priorId } = await initiativeWithDeploymentsInWorkspace("ws-A");
      await expect(
        rollbackDeployment(db, initiativeId, APPROVER, "ws-B", priorId, "reason"),
      ).rejects.toThrow(NotFoundError);
      await expect(
        rollbackDeployment(db, initiativeId, APPROVER, "ws-B", priorId, "reason"),
      ).rejects.toThrow(`initiative not found: ${initiativeId}`);
    });

    it("the owning workspace session succeeds", async () => {
      const { initiativeId, priorId } = await initiativeWithDeploymentsInWorkspace("ws-A");
      const result = await rollbackDeployment(db, initiativeId, APPROVER, "ws-A", priorId, "reason");
      expect(result.status).toBe("deployed");
    });

    it("a null-workspace session cannot roll back a workspace-tagged initiative", async () => {
      const { initiativeId, priorId } = await initiativeWithDeploymentsInWorkspace("ws-A");
      await expect(
        rollbackDeployment(db, initiativeId, APPROVER, null, priorId, "reason"),
      ).rejects.toThrow(NotFoundError);
    });

    it("a seeded (null-workspace) initiative is rollback-able from ANY session workspace", async () => {
      const { initiativeId, priorId } = await initiativeWithDeploymentsInWorkspace(null);
      const result = await rollbackDeployment(db, initiativeId, APPROVER, "ws-anything", priorId, "reason");
      expect(result.status).toBe("deployed");
    });

    it("no partial write happens on a workspace-mismatch rejection", async () => {
      const { initiativeId, currentId, priorId } = await initiativeWithDeploymentsInWorkspace("ws-A");
      await expect(
        rollbackDeployment(db, initiativeId, APPROVER, "ws-B", priorId, "reason"),
      ).rejects.toThrow(NotFoundError);
      const rows = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      expect(rows.find((d) => d.id === currentId)!.status).toBe("deployed"); // unchanged
      expect(rows.find((d) => d.id === priorId)!.status).toBe("retired"); // unchanged
    });
  });
});
