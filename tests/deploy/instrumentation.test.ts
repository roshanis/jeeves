// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { bootFailure, resetBootStateForTests } from "@/lib/config/boot-state";
import { clearInstallationFixtures, closeTestDb, createTestDb, type TestDb } from "@/lib/db/test-client";
import { installation } from "@/lib/db/schema";
import { register } from "@/instrumentation";

/**
 * Next.js calls register() once per server start, on every runtime and also
 * while `next build` collects page data. It must only enforce the production
 * configuration where a server is actually starting:
 *
 *  - not during `next build`: the Containerfile, Vercel and the e2e build all
 *    run with DATA_PROVIDER=mock and no database, so a config check there
 *    would break every build (and the builder has no JEEVES_MODE at all);
 *  - not on the edge runtime, which has no Node APIs to check with.
 *
 * Each skip case uses a configuration that WOULD fail in production, so a
 * pass means the check was skipped, not that it was satisfied.
 */
function stubProductionBootEnv(): void {
  vi.stubEnv("JEEVES_MODE", "production");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("POSTGRES_URL", "");
  vi.stubEnv("JEEVES_COOKIE_SECRET", "");
  vi.stubEnv("APP_BASE_URL", "");
  vi.stubEnv("JEEVES_TENANT_ID", "");
  vi.stubEnv("DATA_PROVIDER", "mock");
}

let exit: Mock<(code: number) => void>;
let log: Mock<(...args: unknown[]) => void>;
let getDb: Mock<() => Promise<TestDb>>;

// One migrated in-memory database serves the file and is emptied for every case.
// Built in beforeAll, whose 30 s hook timeout covers a loaded machine; built
// inside a case it would run under the 5 s test timeout.
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await closeTestDb(db);
});

/** The database the boot hook is handed instead of a real one, empty except for the stamp asked for. */
async function stampedDatabase(deployMode?: "demo" | "production"): Promise<void> {
  await clearInstallationFixtures(db);
  if (deployMode) await db.insert(installation).values({ deployMode, installId: `inst-${deployMode}` });
  getDb.mockResolvedValue(db);
}

beforeEach(() => {
  exit = vi.fn<(code: number) => void>();
  log = vi.fn<(...args: unknown[]) => void>();
  getDb = vi.fn<() => Promise<TestDb>>();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-server");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  resetBootStateForTests();
});

describe("instrumentation register()", () => {
  it("marks the boot failed and exits when the production configuration is invalid", async () => {
    stubProductionBootEnv();
    await register({ exit, log, getDb });

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(bootFailure()).toMatch(/DATABASE_URL/);
    expect(log).toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("lets a valid production configuration start on a production-stamped database", async () => {
    stubProductionBootEnv();
    vi.stubEnv("DATABASE_URL", "postgres://jeeves_app:pw@db.internal:5432/jeeves");
    vi.stubEnv("JEEVES_COOKIE_SECRET", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("APP_BASE_URL", "https://jeeves.example.com");
    vi.stubEnv("JEEVES_TENANT_ID", "tenant-acme");
    vi.stubEnv("DATA_PROVIDER", "db");
    await stampedDatabase("production");
    await register({ exit, log, getDb });

    expect(exit).not.toHaveBeenCalled();
    expect(bootFailure()).toBeNull();
  });

  it("marks the boot failed and exits when a valid production configuration meets an unstamped database", async () => {
    stubProductionBootEnv();
    vi.stubEnv("DATABASE_URL", "postgres://jeeves_app:pw@db.internal:5432/jeeves");
    vi.stubEnv("JEEVES_COOKIE_SECRET", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("APP_BASE_URL", "https://jeeves.example.com");
    vi.stubEnv("JEEVES_TENANT_ID", "tenant-acme");
    vi.stubEnv("DATA_PROVIDER", "db");
    await stampedDatabase();
    await register({ exit, log, getDb });

    expect(exit).toHaveBeenCalledWith(1);
    expect(bootFailure()).toMatch(/installation stamp/i);
  });

  it("does nothing during `next build`", async () => {
    stubProductionBootEnv();
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await register({ exit, log, getDb });

    expect(exit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
    expect(bootFailure()).toBeNull();
  });

  it("does nothing outside the Node.js runtime", async () => {
    stubProductionBootEnv();
    for (const runtime of ["edge", ""]) {
      vi.stubEnv("NEXT_RUNTIME", runtime);
      await register({ exit, log, getDb });
    }

    expect(exit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
    expect(bootFailure()).toBeNull();
  });

  it("is a no-op in demo mode on mock data: there is no database to stamp", async () => {
    stubProductionBootEnv();
    vi.stubEnv("JEEVES_MODE", "demo");
    await register({ exit, log, getDb });

    expect(exit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
    expect(bootFailure()).toBeNull();
  });

  it("still verifies the stamp in demo on mock data when a database URL is configured", async () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    vi.stubEnv("DATA_PROVIDER", "mock");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@db.internal:5432/jeeves");
    await stampedDatabase("production");
    await register({ exit, log, getDb });

    expect(getDb).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(bootFailure()).toMatch(/stamped "production"/);
  });

  it("stamps the demo database at boot", async () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    vi.stubEnv("DATA_PROVIDER", "db");
    await stampedDatabase();
    await register({ exit, log, getDb });

    expect(exit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    const rows = await db.select().from(installation);
    expect(rows).toHaveLength(1);
    expect(rows[0].deployMode).toBe("demo");
  });

  it("refuses to boot the demo on a production-stamped database", async () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    vi.stubEnv("DATA_PROVIDER", "db");
    await stampedDatabase("production");
    await register({ exit, log, getDb });

    expect(exit).toHaveBeenCalledWith(1);
    expect(bootFailure()).toMatch(/stamped "production"/);
  });

  it("can be called the way Next.js calls it, with no arguments", async () => {
    // Mock data and no database URL, so the real database handle is never opened by the test.
    vi.stubEnv("JEEVES_MODE", "demo");
    vi.stubEnv("DATA_PROVIDER", "mock");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("POSTGRES_URL", "");
    await expect(register()).resolves.toBeUndefined();
  });
});
