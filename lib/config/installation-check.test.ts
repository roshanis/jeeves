// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { count, sql } from "drizzle-orm";
import { clearInstallationFixtures, createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { initiatives, installation, sessions } from "../db/schema";
import { readInstallationStamp } from "../db/installation";
import { InstallationCheckError, verifyInstallation } from "./installation-check";

const now = new Date("2026-07-01T00:00:00Z");

async function stamp(db: TestDb, deployMode: "demo" | "production"): Promise<void> {
  await db.insert(installation).values({ deployMode, installId: `inst-${deployMode}` });
}

async function addInitiative(db: TestDb, id: string, workspaceId: string | null): Promise<void> {
  await db.insert(initiatives).values({
    id,
    slug: id,
    title: id,
    requester: "A. Requester",
    state: "draft",
    createdAt: now,
    updatedAt: now,
    workspaceId,
  });
}

async function addSession(db: TestDb, token: string, personaKey: string, workspaceId: string): Promise<void> {
  await db.insert(sessions).values({ token, personaKey, workspaceId, expiresAt: now.getTime() + 60_000 });
}

/** The error a check threw, so a case can assert on its code and message. */
async function failure(promise: Promise<unknown>): Promise<InstallationCheckError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(InstallationCheckError);
  return err as InstallationCheckError;
}

// A case that boots its own database (the one that lags the code) pays for a
// PGlite boot and every migration inside the test, which the 5 s default does
// not cover on a loaded machine; hooks already get 30 s from vitest.config.ts.
const LAGGING_DB_TIMEOUT_MS = 30_000;

describe("verifyInstallation", () => {
  let db: TestDb;

  // One migrated database for the file; each case starts from empty tables.
  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await clearInstallationFixtures(db);
  });

  /** A database that lags the code: migration 0015 never ran. */
  async function withoutInstallationTable<T>(run: (lagging: TestDb) => Promise<T>): Promise<T> {
    const lagging = await createTestDb();
    try {
      await lagging.execute(sql`DROP TABLE installation`);
      return await run(lagging);
    } finally {
      await closeTestDb(lagging);
    }
  }

  describe("demo mode", () => {
    it("stamps an unstamped database and passes", async () => {
      await expect(verifyInstallation(db, "demo")).resolves.toBeUndefined();
      expect((await readInstallationStamp(db))?.deployMode).toBe("demo");
    });

    it("passes on a demo-stamped database without changing it", async () => {
      await stamp(db, "demo");
      const before = await readInstallationStamp(db);
      await expect(verifyInstallation(db, "demo")).resolves.toBeUndefined();
      expect(await readInstallationStamp(db)).toEqual(before);
    });

    it("refuses a production-stamped database, and does not touch it", async () => {
      await stamp(db, "production");
      const err = await failure(verifyInstallation(db, "demo"));
      expect(err.code).toBe("mode_mismatch");
      expect(err.message).toMatch(/stamped "production"/);
      expect(err.message).toMatch(/demo mode/);
      expect((await readInstallationStamp(db))?.deployMode).toBe("production");
    });

    it("does not look at demo data: that is what a demo database holds", async () => {
      await stamp(db, "demo");
      await addInitiative(db, "seeded", null);
      await addInitiative(db, "persona", "ws_abc");
      await addInitiative(db, "public", "public-ws_abc");
      await addSession(db, "t1", "priya-raman", "ws_abc");
      await expect(verifyInstallation(db, "demo")).resolves.toBeUndefined();
    });

    it("reports a database without migration 0015 as not_migrated", async () => {
      await withoutInstallationTable(async (lagging) => {
        const err = await failure(verifyInstallation(lagging, "demo"));
        expect(err.code).toBe("not_migrated");
        expect(err.message).toMatch(/db:migrate/);
      });
    }, LAGGING_DB_TIMEOUT_MS);
  });

  describe("production mode", () => {
    it("refuses an unstamped database, naming the install script that arrives in P4", async () => {
      const err = await failure(verifyInstallation(db, "production"));
      expect(err.code).toBe("no_stamp");
      expect(err.message).toMatch(/no installation stamp/i);
      expect(err.message).toMatch(/install script/i);
      expect(err.message).toMatch(/P4/);
    });

    it("never stamps for itself", async () => {
      await failure(verifyInstallation(db, "production"));
      expect(await readInstallationStamp(db)).toBeNull();
    });

    it("refuses a demo-stamped database", async () => {
      await stamp(db, "demo");
      const err = await failure(verifyInstallation(db, "production"));
      expect(err.code).toBe("mode_mismatch");
      expect(err.message).toMatch(/stamped "demo"/);
      expect(err.message).toMatch(/production mode/);
    });

    it("passes on a production-stamped database with no demo data", async () => {
      await stamp(db, "production");
      await addInitiative(db, "real-1", "org-acme");
      await addInitiative(db, "real-2", "org-acme");
      await expect(verifyInstallation(db, "production")).resolves.toBeUndefined();
    });

    it("passes on a freshly stamped, empty production database", async () => {
      await stamp(db, "production");
      await expect(verifyInstallation(db, "production")).resolves.toBeUndefined();
    });

    it("reports a database without migration 0015 as not_migrated", async () => {
      await withoutInstallationTable(async (lagging) => {
        const err = await failure(verifyInstallation(lagging, "production"));
        expect(err.code).toBe("not_migrated");
        expect(err.message).toMatch(/P4/);
      });
    }, LAGGING_DB_TIMEOUT_MS);

    describe("refuses demo data in a production-stamped database", () => {
      beforeEach(async () => {
        await stamp(db, "production");
        await addInitiative(db, "real-1", "org-acme");
      });

      it.each([
        ["a seeded initiative (workspace_id NULL)", "seeded", null],
        ["a playground initiative (ws_ workspace)", "persona", "ws_3f9a2c"],
        ["a real-request initiative (public- workspace)", "public", "public-ws_3f9a2c"],
      ])("%s", async (_label, id, workspaceId) => {
        await addInitiative(db, id, workspaceId);
        const err = await failure(verifyInstallation(db, "production"));
        expect(err.code).toBe("demo_data");
        expect(err.message).toMatch(/demo data/i);
      });

      it.each([
        ["a persona session", "priya-raman", "ws_3f9a2c"],
        ["a public session", "public", "public-ws_3f9a2c"],
        ["a session in any workspace", "someone", "org-acme"],
      ])("%s", async (_label, personaKey, workspaceId) => {
        await addSession(db, "tok-1", personaKey, workspaceId);
        const err = await failure(verifyInstallation(db, "production"));
        expect(err.code).toBe("demo_data");
        expect(err.message).toMatch(/session/);
      });

      it("counts what it found, and names no workspace, token or initiative", async () => {
        await addInitiative(db, "seeded-a", null);
        await addInitiative(db, "seeded-b", null);
        await addInitiative(db, "persona-secret-id", "ws_topsecretworkspace");
        await addSession(db, "tok-secret", "priya-raman", "ws_topsecretworkspace");
        const err = await failure(verifyInstallation(db, "production"));
        expect(err.message).toMatch(/2 initiatives with no workspace/);
        expect(err.message).toMatch(/1 initiative in a playground workspace/);
        expect(err.message).toMatch(/1 session/);
        for (const secret of ["topsecretworkspace", "tok-secret", "persona-secret-id"]) {
          expect(err.message).not.toContain(secret);
        }
      });

      it("matches the prefixes literally: '_' is not a wildcard", async () => {
        await addInitiative(db, "lookalike-1", "wsXabc");
        await addInitiative(db, "lookalike-2", "xws_abc");
        await addInitiative(db, "lookalike-3", "public_abc");
        await addInitiative(db, "lookalike-4", "org-public-1");
        await expect(verifyInstallation(db, "production")).resolves.toBeUndefined();
      });

      it("writes nothing while it checks", async () => {
        await addInitiative(db, "seeded", null);
        await failure(verifyInstallation(db, "production"));
        const [n] = await db.select({ n: count() }).from(initiatives);
        expect(n.n).toBe(2);
        expect(await readInstallationStamp(db)).toMatchObject({ deployMode: "production" });
      });
    });
  });
});
