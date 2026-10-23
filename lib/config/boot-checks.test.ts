// @vitest-environment node
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { bootFailure, resetBootStateForTests } from "./boot-state";
import { runBootChecks } from "./boot-checks";
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
  return { env, exit: vi.fn(), log: vi.fn(), getDb: vi.fn<() => Promise<TestDb>>() };
}

// Booting PGlite and replaying the migrations costs more than the cases do, so
// one migrated database serves the file and is emptied for every request.
let shared: TestDb | null = null;

/** A migrated in-memory database, empty except for the stamp asked for. */
async function database(stamp?: "demo" | "production"): Promise<TestDb> {
  shared ??= await createTestDb();
  await clearInstallationFixtures(shared);
  if (stamp) await shared.insert(installation).values({ deployMode: stamp, installId: `inst-${stamp}` });
  return shared;
}

/** A database that lags the code: migration 0015 never ran. Closed by afterAll. */
const laggingDbs: TestDb[] = [];
async function databaseWithoutInstallationTable(): Promise<TestDb> {
  const db = await createTestDb();
  laggingDbs.push(db);
  await db.execute(sql`DROP TABLE installation`);
  return db;
}

afterEach(() => {
  resetBootStateForTests();
});

afterAll(async () => {
  await Promise.all([shared, ...laggingDbs].map((db) => (db ? closeTestDb(db) : undefined)));
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

      it("fails closed on a database that has not run migration 0015", async () => {
        const d = deps(COMPLETE_PRODUCTION);
        d.getDb.mockResolvedValue(await databaseWithoutInstallationTable());
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

    it("does not open a database when the data provider is the mock fixture", async () => {
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

    it("fails closed when the database cannot be reached", async () => {
      const d = deps(DEMO_DB);
      d.getDb.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
      await runBootChecks(d);
      expect(d.exit).toHaveBeenCalledWith(1);
      expect(bootFailure()).toMatch(/ECONNREFUSED/);
    });

    // A demo database that has not been migrated to 0015 yet cannot be a
    // production install (production stamping runs after migrating), so there
    // is nothing for the stamp to protect. The demo keeps serving exactly as it
    // did before the stamp existed, and says so, instead of going down because
    // a deploy outran its migration.
    it("warns and keeps booting when migration 0015 has not been applied", async () => {
      const d = deps(DEMO_DB);
      d.getDb.mockResolvedValue(await databaseWithoutInstallationTable());
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
