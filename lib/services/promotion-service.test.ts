/**
 * Tests for lib/services/promotion-service.ts (RL/version-promotion story,
 * plan.md M3 + docs/seed-spec.md #5 pa-correspondence-model): listing
 * checkpoints awaiting feedback-provenance sign-off, and the approver-only
 * `promoteCheckpoint` action that flips a `deployment_versions` row from
 * `awaiting_promotion_signoff` -> `deployed`, retires the prior deployed
 * version, and writes two audit events transactionally. Mirrors
 * lib/services/admin-service.test.ts's direct-DB, no-HTTP test convention.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { seedDatabase } from "../../scripts/seed";
import { auditEvents, deploymentVersions, initiatives } from "../db/schema";
import {
  listPromotions,
  promoteCheckpoint,
  ForbiddenError,
  ValidationError,
  NotFoundError,
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
          { ...FULL_ATTESTATION, feedbackDataSource: "  " },
          "some reason",
        ),
      ).rejects.toThrow(ValidationError);
    });

    it("throws ValidationError when reason is empty", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const v21Id = await v21DeploymentId(db, initiativeId);

      await expect(promoteCheckpoint(db, v21Id, APPROVER, FULL_ATTESTATION, "")).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError for an unknown deployment version id", async () => {
      await expect(
        promoteCheckpoint(db, "dep-does-not-exist", APPROVER, FULL_ATTESTATION, "reason"),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("promoteCheckpoint — role guard (separation of duties)", () => {
    it("rejects an admin actor with ForbiddenError", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const v21Id = await v21DeploymentId(db, initiativeId);

      await expect(promoteCheckpoint(db, v21Id, ADMIN, FULL_ATTESTATION, "reason")).rejects.toThrow(ForbiddenError);
    });

    it("rejects a reviewer actor with ForbiddenError", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const v21Id = await v21DeploymentId(db, initiativeId);

      await expect(promoteCheckpoint(db, v21Id, REVIEWER, FULL_ATTESTATION, "reason")).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  describe("promoteCheckpoint — idempotent double-promote", () => {
    it("rejects a second promotion attempt on the same (already-promoted) deployment version id", async () => {
      const initiativeId = await paCorrespondenceModelId(db);
      const v21Id = await v21DeploymentId(db, initiativeId);

      await promoteCheckpoint(db, v21Id, APPROVER, FULL_ATTESTATION, "First promotion.");

      await expect(
        promoteCheckpoint(db, v21Id, APPROVER, FULL_ATTESTATION, "Second attempt should fail."),
      ).rejects.toThrow();

      // Must not silently no-op or throw a raw/opaque DB error — still deployed once.
      const rows = await db.select().from(deploymentVersions).where(eq(deploymentVersions.initiativeId, initiativeId));
      const v21 = rows.find((d) => d.version === "v2.1")!;
      expect(v21.status).toBe("deployed");
    });
  });
});
