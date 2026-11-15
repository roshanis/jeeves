// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { bootFailure, resetBootStateForTests } from "./boot-state";
import { DEMO_CHECK_RETRY_DELAYS_MS, runBootChecks } from "./boot-checks";
import { clearInstallationFixtures, closeTestDb, createTestDb, type TestDb } from "../db/test-client";
import { initiatives, installation } from "../db/schema";
import { readInstallationStamp } from "../db/installation";

const SECRET = "0123456789abcdef0123456789abcdef";

const COMPLETE_PRODUCTION: Record<string, string> = {
  JEEVES_MODE: "production",
  DATABASE_URL: "postgres://jeeves_app:s3cr3t-db-pw@db.internal:5432/jeeves",
  JEEVES_COOKIE_SECRET: SECRET,
  APP_BASE_URL: "https://jeeves.example.com",
  JEEVES_TENANT_ID: "tenant-acme",
};

function deps(env: Record<string, string | undefined>) {
  return {
    env,
    exit: vi.fn(),
    log: vi.fn(),
    getDb: vi.fn<() => Promise<TestDb>>(),
    // Backoff waits are recorded, never slept: the suite must not take seconds per retry.
    sleep: vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined),
  };
}

// Booting PGlite and replaying the migrations costs more than the cases do, so
// two databases serve the file: one migrated and emptied for every request, and
// one that lags the code (migration 0015 never ran), which every case only reads.
// Both are built in beforeAll, whose 30 s hook timeout covers a loaded machine;
// built inside a case they would run under the 5 s test timeout.
let shared: TestDb;
let lagging: TestDb;

// Separate hooks, so each database gets its own 30 s.
beforeAll(async () => {
  shared = await createTestDb();
});

beforeAll(async () => {
  lagging = await createTestDb();
  await lagging.execute(sql`DROP TABLE installation`);
});

/** The migrated database, empty except for the stamp asked for. */
async function database(stamp?: "demo" | "production"): Promise<TestDb> {
  await clearInstallationFixtures(shared);
  if (stamp) await shared.insert(installation).values({ deployMode: stamp, installId: `inst-${stamp}` });
  return shared;
}

afterEach(() => {
  resetBootStateForTests();
});

afterAll(async () => {
  await Promise.all([shared, lagging].map((db) => closeTestDb(db)));
});

describe("runBootChecks", () => {
  describe("in production mode", () => {
    it("lets a complete configuration boot on a production-stamped database", async () => {
      const d = deps(COMPLETE_PRODUCTION);
      d.getDb.mockResolvedValue(await database("production"));
      await runBootChecks(d);
      expect(d.exit).not.toHaveBeenCalled();
      expect(d.log).not.toHaveBeenCalled();
      expect(bootFailure()).toBeNull();
    });

    it("logs, marks the boot failed and exits 1 when the configuration is invalid", async () => {
      const d = deps({ JEEVES_MODE: "production" });
      await runBootChecks(d);

      expect(d.exit).toHaveBeenCalledTimes(1);
      expect(d.exit).toHaveBeenCalledWith(1);
      expect(bootFailure()).toMatch(/DATABASE_URL/);

      const logged = d.log.mock.calls.flat().join(" ");
      for (const name of ["DATABASE_URL", "JEEVES_COOKIE_SECRET", "APP_BASE_URL", "JEEVES_TENANT_ID"]) {
        expect(logged).toContain(name);
      }
    });

    it("marks the boot failed before exiting, so a mocked or delayed exit still fails closed", async () => {
      const d = deps({});
      let failureAtExit: string | null = null;
      d.exit.mockImplementation(() => {
        failureAtExit = bootFailure();
      });
      await runBootChecks(d);
      expect(failureAtExit).not.toBeNull();
    });

    // JEEVES_MODE unset is production: the first deployment that forgets the
    // flag is checked, not waved through.
    it("treats an unset JEEVES_MODE as production", async () => {
      const d = deps({});
      await runBootChecks(d);
      expect(d.exit).toHaveBeenCalledWith(1);
    });

    it("refuses mock data even when everything else is configured", async () => {
      const d = deps({ ...COMPLETE_PRODUCTION, DATA_PROVIDER: "mock" });
      await runBootChecks(d);
      expect(d.exit).toHaveBeenCalledWith(1);
      expect(bootFailure()).toMatch(/DATA_PROVIDER/);
    });

    it("applies the production checks when the build constant has disabled demo", async () => {
      const d = deps({ JEEVES_MODE: "demo", JEEVES_DEMO_ENABLED: "0" });
      await runBootChecks(d);
      expect(d.exit).toHaveBeenCalledWith(1);
    });

    it("never logs a configured secret value", async () => {
      const d = deps({
        ...COMPLETE_PRODUCTION,
        JEEVES_COOKIE_SECRET: "short-but-secret",
        APP_BASE_URL: "http://user:hunter2@jeeves.example.com",
      });
      await runBootChecks(d);
      const logged = [...d.log.mock.calls.flat(), bootFailure()].join(" ");
      expect(d.exit).toHaveBeenCalledWith(1);
      for (const secret of ["short-but-secret", "hunter2", "s3cr3t-db-pw"]) {
        expect(logged).not.toContain(secret);
      }
    });
    it("never opens the database when the configuration is already invalid", async () => {
      const d = deps({ JEEVES_MODE: "production" });
      await runBootChecks(d);
      expect(d.exit).toHaveBeenCalledWith(1);
      // An unconfigured production would otherwise fall back to a local PGlite store.
      expect(d.getDb).not.toHaveBeenCalled();
    });

    describe("installation stamp", () => {
      it("fails closed on an unstamped database: no stamp is created, the flag is set, the process exits", async () => {
        const d = deps(COMPLETE_PRODUCTION);
        const db = await database();
        d.getDb.mockResolvedValue(db);
        let failureAtExit: string | null = null;
        d.exit.mockImplementation(() => {
          failureAtExit = bootFailure();
        });

        await runBootChecks(d);

        expect(d.exit).toHaveBeenCalledTimes(1);
        expect(d.exit).toHaveBeenCalledWith(1);
        expect(failureAtExit).toMatch(/no installation stamp/i);
        expect(bootFailure()).toMatch(/install script/i);
        expect(d.log.mock.calls.flat().join(" ")).toMatch(/no installation stamp/i);
        expect(await readInstallationStamp(db)).toBeNull();
      });

      it("fails closed when the database is stamped demo", async () => {
        const d = deps(COMPLETE_PRODUCTION);
        d.getDb.mockResolvedValue(await database("demo"));
        await runBootChecks(d);
        expect(d.exit).toHaveBeenCalledWith(1);
        expect(bootFailure()).toMatch(/stamped "demo"/);
      });

      it("fails closed when the production database holds demo data", async () => {
        const d = deps(COMPLETE_PRODUCTION);
        const db = await database("production");
        await db.insert(initiatives).values({
          id: "seeded",
          slug: "seeded",
          title: "Seeded",
          requester: "Priya Raman",
          state: "draft",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        d.getDb.mockResolvedValue(db);
        await runBootChecks(d);
        expect(d.exit).toHaveBeenCalledWith(1);
        expect(bootFailure()).toMatch(/demo data/i);
      });

      it("fails closed when the database cannot be reached, without logging the connection string", async () => {
        const d = deps(COMPLETE_PRODUCTION);
        d.getDb.mockRejectedValue(
          new Error(`connect ECONNREFUSED while opening ${COMPLETE_PRODUCTION.DATABASE_URL}`),
        );
        await runBootChecks(d);

        expect(d.exit).toHaveBeenCalledWith(1);
        expect(bootFailure()).toMatch(/ECONNREFUSED/);
        const logged = [...d.log.mock.calls.flat(), bootFailure()].join(" ");
        expect(logged).not.toContain("s3cr3t-db-pw");
      });

      it("does not retry in production: an unreachable database fails closed at once", async () => {
        const d = deps(COMPLETE_PRODUCTION);
        d.getDb.mockRejectedValue(new Error("connect ECONNREFUSED"));
        await runBootChecks(d);

        expect(d.getDb).toHaveBeenCalledTimes(1);
        expect(d.sleep).not.toHaveBeenCalled();
        expect(d.exit).toHaveBeenCalledTimes(1);
        expect(d.exit).toHaveBeenCalledWith(1);
      });

      it("fails closed on a database that has not run migration 0015", async () => {
        const d = deps(COMPLETE_PRODUCTION);
        d.getDb.mockResolvedValue(lagging);
        await runBootChecks(d);
        expect(d.exit).toHaveBeenCalledWith(1);
        expect(bootFailure()).toMatch(/installation table/i);
      });
    });
  });

  describe("in demo mode", () => {
    const DEMO_DB = { JEEVES_MODE: "demo", DATA_PROVIDER: "db" };

    it("does nothing, even with none of the production variables set", async () => {
      const d = deps({ JEEVES_MODE: "demo", DATA_PROVIDER: "mock" });
      await runBootChecks(d);
      expect(d.exit).not.toHaveBeenCalled();
      expect(d.log).not.toHaveBeenCalled();
      expect(bootFailure()).toBeNull();
    });

    it("does not open a database when none is in play: the mock fixture and no database URL", async () => {
      for (const env of [
        { JEEVES_MODE: "demo", DATA_PROVIDER: "mock" },
        { JEEVES_MODE: "demo" }, // no provider and no database URL resolves to mock
      ]) {
        const d = deps(env);
        await runBootChecks(d);
        expect(d.getDb).not.toHaveBeenCalled();
        expect(d.exit).not.toHaveBeenCalled();
      }
    });

    // Routes such as /api/exceptions, /api/monitor/incidents and /api/health call
    // getDb() whatever DATA_PROVIDER says, so a configured database is in play
    // even when the page read-model is the mock fixture.
    describe("mock data with a database URL configured", () => {
      const MOCK_WITH_URL = [
        { JEEVES_MODE: "demo", DATA_PROVIDER: "mock", DATABASE_URL: "postgres://u:p@db.internal:5432/jeeves" },
        { JEEVES_MODE: "demo", DATA_PROVIDER: "mock", POSTGRES_URL: "postgres://u:p@db.internal:5432/jeeves" },
      ];

      it.each(MOCK_WITH_URL)("still verifies the installation stamp (%o)", async (env) => {
        const d = deps(env);
        const db = await database();
        d.getDb.mockResolvedValue(db);
        await runBootChecks(d);

        expect(d.getDb).toHaveBeenCalledTimes(1);
        expect(d.exit).not.toHaveBeenCalled();
        expect((await readInstallationStamp(db))?.deployMode).toBe("demo");
      });

      it.each(MOCK_WITH_URL)("refuses a production-stamped database (%o)", async (env) => {
        const d = deps(env);
        const db = await database("production");
        d.getDb.mockResolvedValue(db);
        await runBootChecks(d);

        expect(d.exit).toHaveBeenCalledWith(1);
        expect(bootFailure()).toMatch(/stamped "production"/);
        expect((await readInstallationStamp(db))?.deployMode).toBe("production");
      });
    });

    it("verifies the stamp when the db provider is selected without a database URL", async () => {
      const d = deps({ JEEVES_MODE: "demo", DATA_PROVIDER: "db" });
      d.getDb.mockResolvedValue(await database("production"));
      await runBootChecks(d);
      expect(d.exit).toHaveBeenCalledWith(1);
    });

    it("stamps an unstamped database and boots quietly", async () => {
      const d = deps(DEMO_DB);
      const db = await database();
      d.getDb.mockResolvedValue(db);
      await runBootChecks(d);

      expect(d.exit).not.toHaveBeenCalled();
      expect(d.log).not.toHaveBeenCalled();
      expect(bootFailure()).toBeNull();
      expect((await readInstallationStamp(db))?.deployMode).toBe("demo");
    });

    it("runs the check when a database URL selects the db provider", async () => {
      const d = deps({ JEEVES_MODE: "demo", DATABASE_URL: "postgres://u:p@db.internal:5432/jeeves" });
      const db = await database();
      d.getDb.mockResolvedValue(db);
      await runBootChecks(d);
      expect(d.getDb).toHaveBeenCalledTimes(1);
      expect((await readInstallationStamp(db))?.deployMode).toBe("demo");
    });

    it("boots on a demo-stamped database without changing the stamp", async () => {
      const d = deps(DEMO_DB);
      const db = await database("demo");
      const before = await readInstallationStamp(db);
      d.getDb.mockResolvedValue(db);
      await runBootChecks(d);
      expect(d.exit).not.toHaveBeenCalled();
      expect(await readInstallationStamp(db)).toEqual(before);
    });

    it("keeps booting on a populated demo database: demo rows are what a demo holds", async () => {
      const d = deps(DEMO_DB);
      const db = await database("demo");
      await db.insert(initiatives).values({
        id: "seeded",
        slug: "seeded",
        title: "Seeded",
        requester: "Priya Raman",
        state: "draft",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      d.getDb.mockResolvedValue(db);
      await runBootChecks(d);
      expect(d.exit).not.toHaveBeenCalled();
    });

    it("fails closed on a production-stamped database: demo doors never open on it", async () => {
      const d = deps(DEMO_DB);
      const db = await database("production");
      d.getDb.mockResolvedValue(db);
      await runBootChecks(d);

      expect(d.exit).toHaveBeenCalledWith(1);
      expect(bootFailure()).toMatch(/stamped "production"/);
      expect((await readInstallationStamp(db))?.deployMode).toBe("production");
    });

    it("fails closed when the database stays unreachable, after the bounded retries", async () => {
      const d = deps(DEMO_DB);
      d.getDb.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
      await runBootChecks(d);

      expect(d.getDb).toHaveBeenCalledTimes(DEMO_CHECK_RETRY_DELAYS_MS.length + 1);
      expect(d.exit).toHaveBeenCalledTimes(1);
      expect(d.exit).toHaveBeenCalledWith(1);
      expect(bootFailure()).toMatch(/ECONNREFUSED/);
    });

    // On Vercel every cold start does a database round trip before serving, so a
    // brief Neon error must not take the instance down.
    describe("transient database errors", () => {
      it("survives one failure followed by a success, and still stamps the database", async () => {
        const d = deps(DEMO_DB);
        const db = await database();
        d.getDb.mockRejectedValueOnce(new Error("Connection terminated unexpectedly")).mockResolvedValue(db);
        await runBootChecks(d);

        expect(d.getDb).toHaveBeenCalledTimes(2);
        expect(d.exit).not.toHaveBeenCalled();
        expect(bootFailure()).toBeNull();
        expect((await readInstallationStamp(db))?.deployMode).toBe("demo");
        expect(d.sleep).toHaveBeenCalledTimes(1);
        expect(d.sleep).toHaveBeenCalledWith(DEMO_CHECK_RETRY_DELAYS_MS[0]);
        expect(d.log.mock.calls.flat().join(" ")).toMatch(/retrying/i);
      });

      it("survives a failure inside the check itself, not only while opening the database", async () => {
        const d = deps(DEMO_DB);
        const db = await database();
        // The handle opens fine; the first query fails (a Neon compute waking up).
        const flaky = {
          ...db,
          execute: vi.fn().mockRejectedValueOnce(new Error("timeout exceeded when trying to connect")),
        };
        d.getDb.mockResolvedValueOnce(flaky as unknown as TestDb).mockResolvedValue(db);
        await runBootChecks(d);

        expect(d.getDb).toHaveBeenCalledTimes(2);
        expect(d.exit).not.toHaveBeenCalled();
        expect((await readInstallationStamp(db))?.deployMode).toBe("demo");
      });

      it("waits between attempts, within a few seconds in total", async () => {
        const d = deps(DEMO_DB);
        d.getDb.mockRejectedValue(new Error("connect ECONNREFUSED"));
        await runBootChecks(d);

        expect(d.sleep.mock.calls.map(([ms]) => ms)).toEqual([...DEMO_CHECK_RETRY_DELAYS_MS]);
        const total = DEMO_CHECK_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
        expect(total).toBeGreaterThan(0);
        expect(total).toBeLessThanOrEqual(5_000);
      });

      it("never logs the connection string while retrying", async () => {
        const url = "postgres://u:hunter2@db.internal:5432/jeeves";
        const d = deps({ ...DEMO_DB, DATABASE_URL: url });
        d.getDb.mockRejectedValue(new Error(`connect ECONNREFUSED while opening ${url}`));
        await runBootChecks(d);
        expect([...d.log.mock.calls.flat(), bootFailure()].join(" ")).not.toContain("hunter2");
      });

      it("does not retry a stamp mismatch: that answer will not change", async () => {
        const d = deps(DEMO_DB);
        d.getDb.mockResolvedValue(await database("production"));
        await runBootChecks(d);

        expect(d.getDb).toHaveBeenCalledTimes(1);
        expect(d.sleep).not.toHaveBeenCalled();
        expect(d.exit).toHaveBeenCalledWith(1);
      });

      it("does not retry a database that has not been migrated", async () => {
        const d = deps(DEMO_DB);
        d.getDb.mockResolvedValue(lagging);
        await runBootChecks(d);

        expect(d.getDb).toHaveBeenCalledTimes(1);
        expect(d.sleep).not.toHaveBeenCalled();
        expect(d.exit).not.toHaveBeenCalled();
      });
    });

    // A demo database that has not been migrated to 0015 yet cannot be a
    // production install (production stamping runs after migrating), so there
    // is nothing for the stamp to protect. The demo keeps serving exactly as it
    // did before the stamp existed, and says so, instead of going down because
    // a deploy outran its migration.
    it("warns and keeps booting when migration 0015 has not been applied", async () => {
      const d = deps(DEMO_DB);
      d.getDb.mockResolvedValue(lagging);
      await runBootChecks(d);

      expect(d.exit).not.toHaveBeenCalled();
      expect(bootFailure()).toBeNull();
      expect(d.log.mock.calls.flat().join(" ")).toMatch(/db:migrate/);
    });
  });

  it("defaults to process.exit and console.error", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await runBootChecks({ env: {} });
      expect(exit).toHaveBeenCalledWith(1);
      expect(error).toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });
});
