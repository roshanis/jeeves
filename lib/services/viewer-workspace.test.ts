import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, createTestDb, type TestDb } from "../db/test-client";
import { deploymentVersions, initiatives, sessions } from "../db/schema";
import { issueDemoSession, resetGuardStateForTests } from "./route-guard";
import { signWorkspaceId } from "../security/workspace-cookie";
import {
  deploymentWorkspaceMap,
  initiativeWorkspaceMap,
  isDeploymentVisible,
  isInitiativeVisible,
  resolveViewerWorkspaceId,
} from "./viewer-workspace";

const PASSCODE = "correct-horse-battery-staple";
const COOKIE_SECRET = "test-cookie-secret";
let testDb: TestDb;

vi.mock("@/lib/db/client", () => ({
  getDb: () => testDb,
}));

describe("lib/services/viewer-workspace", () => {
  beforeEach(async () => {
    testDb = await createTestDb();
    resetGuardStateForTests();
    process.env.JEEVES_COOKIE_SECRET = COOKIE_SECRET;
  });

  afterEach(async () => {
    await closeTestDb(testDb);
    delete process.env.JEEVES_COOKIE_SECRET;
  });

  describe("resolveViewerWorkspaceId", () => {
    it("returns null when there is no session token and no workspace cookie", async () => {
      const req = new Request("http://localhost/api/x");
      expect(await resolveViewerWorkspaceId(req)).toBeNull();
    });

    it("returns null for a garbage/expired session token with no workspace cookie", async () => {
      const req = new Request("http://localhost/api/x", {
        headers: { authorization: "Bearer not-a-real-token" },
      });
      expect(await resolveViewerWorkspaceId(req)).toBeNull();
    });

    it("returns the session's workspaceId for a valid bearer token", async () => {
      const session = (await issueDemoSession(PASSCODE, PASSCODE, "priya-raman"))!;
      const req = new Request("http://localhost/api/x", {
        headers: { authorization: `Bearer ${session.token}` },
      });
      expect(await resolveViewerWorkspaceId(req)).toBe(session.workspaceId);
    });

    it("returns the session's workspaceId for a valid jeeves_session cookie", async () => {
      const session = (await issueDemoSession(PASSCODE, PASSCODE, "priya-raman"))!;
      const req = new Request("http://localhost/api/x", {
        headers: { cookie: `jeeves_session=${session.token}` },
      });
      expect(await resolveViewerWorkspaceId(req)).toBe(session.workspaceId);
    });

    it("falls back to a verified jeeves_workspace cookie when no session token is present", async () => {
      const signed = signWorkspaceId("ws_cookie_only_1234567890", COOKIE_SECRET);
      const req = new Request("http://localhost/api/x", {
        headers: { cookie: `jeeves_workspace=${signed}` },
      });
      expect(await resolveViewerWorkspaceId(req)).toBe("ws_cookie_only_1234567890");
    });

    it("ignores a tampered/unsigned jeeves_workspace cookie -> null", async () => {
      const req = new Request("http://localhost/api/x", {
        headers: { cookie: "jeeves_workspace=ws_attacker_supplied" },
      });
      expect(await resolveViewerWorkspaceId(req)).toBeNull();
    });

    it("prefers a valid session's workspaceId over a DIFFERENT workspace cookie", async () => {
      const session = (await issueDemoSession(PASSCODE, PASSCODE, "priya-raman"))!;
      const otherSigned = signWorkspaceId("ws_someone_elses_workspace", COOKIE_SECRET);
      const req = new Request("http://localhost/api/x", {
        headers: {
          authorization: `Bearer ${session.token}`,
          cookie: `jeeves_workspace=${otherSigned}`,
        },
      });
      expect(await resolveViewerWorkspaceId(req)).toBe(session.workspaceId);
      expect(await resolveViewerWorkspaceId(req)).not.toBe("ws_someone_elses_workspace");
    });

    it("falls back to the workspace cookie when the session token is present but invalid", async () => {
      const signed = signWorkspaceId("ws_fallback_target_1234567", COOKIE_SECRET);
      const req = new Request("http://localhost/api/x", {
        headers: {
          authorization: "Bearer not-a-real-token",
          cookie: `jeeves_workspace=${signed}`,
        },
      });
      expect(await resolveViewerWorkspaceId(req)).toBe("ws_fallback_target_1234567");
    });

    it("deletes an expired session and falls back to the workspace cookie", async () => {
      const session = (await issueDemoSession(PASSCODE, PASSCODE, "priya-raman"))!;
      await testDb.update(sessions).set({ expiresAt: Date.now() }).where(eq(sessions.token, session.token));
      const signed = signWorkspaceId("ws_after_expiry_1234567890", COOKIE_SECRET);
      const req = new Request("http://localhost/api/x", {
        headers: {
          authorization: `Bearer ${session.token}`,
          cookie: `jeeves_workspace=${signed}`,
        },
      });
      expect(await resolveViewerWorkspaceId(req)).toBe("ws_after_expiry_1234567890");
    });
  });

  describe("deploymentWorkspaceMap / isDeploymentVisible", () => {
    const now = new Date("2026-07-10T00:00:00.000Z");

    beforeEach(async () => {
      await testDb.insert(initiatives).values([
        {
          id: "init-seeded",
          slug: "seeded-initiative",
          title: "Seeded",
          requester: "Dan Kowalski",
          state: "deployed",
          tier: "low",
          accountableApprover: null,
          createdAt: now,
          updatedAt: now,
          workspaceId: null,
        },
        {
          id: "init-ws-a",
          slug: "ws-a-initiative",
          title: "Workspace A",
          requester: "Priya Raman",
          state: "deployed",
          tier: "low",
          accountableApprover: null,
          createdAt: now,
          updatedAt: now,
          workspaceId: "ws_A",
        },
      ]);
      await testDb.insert(deploymentVersions).values([
        { id: "dep-seeded", initiativeId: "init-seeded", version: "v1.0", status: "deployed", deployedAt: now },
        { id: "dep-ws-a", initiativeId: "init-ws-a", version: "v1.0", status: "deployed", deployedAt: now },
      ]);
    });

    it("a seeded (null-workspace) deployment is visible to anonymous, a foreign workspace, and its own workspace alike", async () => {
      const map = await deploymentWorkspaceMap(testDb);
      expect(isDeploymentVisible(map, "dep-seeded", null)).toBe(true);
      expect(isDeploymentVisible(map, "dep-seeded", "ws_B")).toBe(true);
      expect(isDeploymentVisible(map, "dep-seeded", "ws_A")).toBe(true);
    });

    it("a workspace-owned deployment is visible only to its own workspace, not anonymous or a foreign workspace", async () => {
      const map = await deploymentWorkspaceMap(testDb);
      expect(isDeploymentVisible(map, "dep-ws-a", null)).toBe(false);
      expect(isDeploymentVisible(map, "dep-ws-a", "ws_B")).toBe(false);
      expect(isDeploymentVisible(map, "dep-ws-a", "ws_A")).toBe(true);
    });

    it("an unknown deploymentId is never visible", async () => {
      const map = await deploymentWorkspaceMap(testDb);
      expect(isDeploymentVisible(map, "does-not-exist", "ws_A")).toBe(false);
      expect(isDeploymentVisible(map, "does-not-exist", null)).toBe(false);
    });
  });

  describe("initiativeWorkspaceMap / isInitiativeVisible", () => {
    const now = new Date("2026-07-10T00:00:00.000Z");

    beforeEach(async () => {
      await testDb.insert(initiatives).values([
        {
          id: "init-seeded-2",
          slug: "seeded-initiative-2",
          title: "Seeded 2",
          requester: "Dan Kowalski",
          state: "deployed",
          tier: "low",
          accountableApprover: null,
          createdAt: now,
          updatedAt: now,
          workspaceId: null,
        },
        {
          id: "init-ws-a-2",
          slug: "ws-a-initiative-2",
          title: "Workspace A 2",
          requester: "Priya Raman",
          state: "deployed",
          tier: "low",
          accountableApprover: null,
          createdAt: now,
          updatedAt: now,
          workspaceId: "ws_A",
        },
      ]);
    });

    it("mirrors deploymentWorkspaceMap's visibility semantics for initiative-keyed rows", async () => {
      const map = await initiativeWorkspaceMap(testDb);
      expect(isInitiativeVisible(map, "init-seeded-2", null)).toBe(true);
      expect(isInitiativeVisible(map, "init-seeded-2", "ws_B")).toBe(true);
      expect(isInitiativeVisible(map, "init-ws-a-2", null)).toBe(false);
      expect(isInitiativeVisible(map, "init-ws-a-2", "ws_B")).toBe(false);
      expect(isInitiativeVisible(map, "init-ws-a-2", "ws_A")).toBe(true);
      expect(isInitiativeVisible(map, "does-not-exist", "ws_A")).toBe(false);
    });
  });
});
