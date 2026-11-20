// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { count } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createTestDb, closeTestDb, type TestDb } from "../lib/db/test-client";
import * as schema from "../lib/db/schema";
import { initiatives, installation, sessions } from "../lib/db/schema";
import { DemoOnlyError } from "../lib/config/demo-doors";
import { readInstallationStamp } from "../lib/db/installation";
import { seedDatabase } from "./seed";
import { resetDemo } from "./reset-demo";

/**
 * scripts/seed.ts and scripts/reset-demo.ts wipe and repopulate the demo.
 * They stamp the database 'demo' and refuse to touch one stamped
 * 'production', whatever ALLOW_SEED says: the stamp is a property of the
 * database, and an environment variable on the operator's shell is not.
 */
describe("scripts/seed.ts — installation stamp", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await closeTestDb(db);
  });

  async function initiativeCount(): Promise<number> {
    return (await db.select({ n: count() }).from(initiatives))[0].n;
  }

  it("stamps a fresh database 'demo'", async () => {
    expect(await readInstallationStamp(db)).toBeNull();
    await seedDatabase(db);
    expect((await readInstallationStamp(db))?.deployMode).toBe("demo");
  });

  it("keeps the stamp through a reseed: the wipe does not touch the installation row", async () => {
    await seedDatabase(db);
    const first = await readInstallationStamp(db);

    await seedDatabase(db);
    await seedDatabase(db);

    expect(await readInstallationStamp(db)).toEqual(first);
    expect((await db.select({ n: count() }).from(installation))[0].n).toBe(1);
  });

  it("refuses a production-stamped database and changes nothing", async () => {
    await db.insert(installation).values({ deployMode: "production", installId: "inst-prod" });
    const now = new Date();
    await db.insert(initiatives).values({
      id: "real-1",
      slug: "real-1",
      title: "A real initiative",
      requester: "A. Requester",
      state: "draft",
      createdAt: now,
      updatedAt: now,
      workspaceId: "org-acme",
    });

    await expect(seedDatabase(db)).rejects.toThrow(/stamped "production"/);

    expect(await initiativeCount()).toBe(1);
    expect(await readInstallationStamp(db)).toMatchObject({ deployMode: "production", installId: "inst-prod" });
  });

  it("refuses a production-stamped database even with ALLOW_SEED=1 and NODE_ENV=production", async () => {
    vi.stubEnv("ALLOW_SEED", "1");
    vi.stubEnv("NODE_ENV", "production");
    await db.insert(installation).values({ deployMode: "production", installId: "inst-prod" });

    await expect(seedDatabase(db)).rejects.toThrow(/stamped "production"/);
    expect(await initiativeCount()).toBe(0);
  });

  async function addLiveEvidence(): Promise<void> {
    await db.insert(initiatives).values({
      id: "live-1",
      slug: "live-1",
      title: "Live",
      requester: "Priya Raman",
      state: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(schema.evidenceDocuments).values({
      id: "doc-1",
      initiativeId: "live-1",
      requestId: "req-1",
      fileName: "a.pdf",
      mediaType: "application/pdf",
      byteSize: 1,
      sha256: "0".repeat(64),
      content: Buffer.from("x"),
      version: 1,
      uploadedBy: "priya-raman",
      createdAt: new Date(),
    });
  }

  it("refuses on the stamp before it reaches the evidence-history check, so the message names the real problem", async () => {
    await db.insert(installation).values({ deployMode: "production", installId: "inst-prod" });
    await addLiveEvidence();

    const err = await seedDatabase(db).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toMatch(/stamped "production"/);
    expect(err?.message).not.toMatch(/preserve evidence history/);
  });

  it("rolls the stamp back with the seed when the seed itself refuses", async () => {
    await addLiveEvidence();

    await expect(seedDatabase(db)).rejects.toThrow(/preserve evidence history/);

    expect(await readInstallationStamp(db)).toBeNull();
  });
});

describe("scripts/reset-demo.ts — installation stamp", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await closeTestDb(db);
  });

  async function addSession(): Promise<void> {
    await db.insert(sessions).values({
      token: "tok-1",
      personaKey: "priya-raman",
      workspaceId: "ws_visitor",
      expiresAt: Date.now() + 60_000,
    });
  }

  it("stamps 'demo', clears live sessions and keeps the stamp", async () => {
    await addSession();
    await resetDemo(db);

    expect((await db.select({ n: count() }).from(sessions))[0].n).toBe(0);
    expect(await readInstallationStamp(db)).toMatchObject({ deployMode: "demo" });
    expect((await db.select({ n: count() }).from(installation))[0].n).toBe(1);
  });

  it("keeps the same install across repeated resets", async () => {
    await resetDemo(db);
    const first = await readInstallationStamp(db);
    await resetDemo(db);
    expect(await readInstallationStamp(db)).toEqual(first);
  });

  it("refuses outside demo mode before it stamps, reseeds or clears anything", async () => {
    vi.stubEnv("JEEVES_MODE", "production");
    await addSession();

    await expect(resetDemo(db)).rejects.toBeInstanceOf(DemoOnlyError);

    expect(await readInstallationStamp(db)).toBeNull();
    expect((await db.select({ n: count() }).from(sessions))[0].n).toBe(1);
    expect((await db.select({ n: count() }).from(initiatives))[0].n).toBe(0);
    vi.unstubAllEnvs();
  });

  it("refuses a production-stamped database before it reseeds or clears anything", async () => {
    vi.stubEnv("ALLOW_SEED", "1");
    await db.insert(installation).values({ deployMode: "production", installId: "inst-prod" });
    await addSession();

    await expect(resetDemo(db)).rejects.toThrow(/stamped "production"/);

    expect((await db.select({ n: count() }).from(sessions))[0].n).toBe(1);
    expect((await db.select({ n: count() }).from(initiatives))[0].n).toBe(0);
    vi.unstubAllEnvs();
  });
});

/**
 * The CLI itself, run for real against an on-disk PGlite store that is
 * stamped 'production'. `ALLOW_SEED=1 NODE_ENV=production` is the operator
 * explicitly confirming a reseed, which used to be enough; it must not be.
 */
describe("npm run db:seed / reset:demo — CLI against a production-stamped store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "jeeves-seed-cli-"));
    const client = new PGlite(dir);
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await db.insert(installation).values({ deployMode: "production", installId: "inst-prod" });
    await client.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function storeState() {
    const client = new PGlite(dir);
    const db = drizzle({ client, schema });
    try {
      return {
        stamp: await readInstallationStamp(db),
        initiatives: (await db.select({ n: count() }).from(initiatives))[0].n,
      };
    } finally {
      await client.close();
    }
  }

  function runScript(script: string) {
    return spawnSync(join(process.cwd(), "node_modules/.bin/tsx"), [script], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120_000,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        JEEVES_MODE: "demo",
        DATA_PROVIDER: "db",
        JEEVES_PGLITE_DIR: dir,
        DATABASE_URL: "",
        POSTGRES_URL: "",
        DATABASE_MIGRATION_URL: "",
        VERCEL: "",
        NODE_ENV: "production",
        ALLOW_SEED: "1",
      },
    });
  }

  it.each(["scripts/seed.ts", "scripts/reset-demo.ts"])(
    "%s exits non-zero with ALLOW_SEED=1 and leaves the store untouched",
    async (script) => {
      const result = runScript(script);

      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toMatch(/stamped "production"/);
      expect(await storeState()).toMatchObject({
        stamp: { deployMode: "production", installId: "inst-prod" },
        initiatives: 0,
      });
    },
    150_000,
  );
});

/**
 * The seed and reset CLIs are demo-only tools. The mode defaults to production,
 * and production mode only refuses the PGlite fallback, so with a database URL
 * set and JEEVES_MODE unset they used to seed a fresh database with demo rows
 * and an immutable 'demo' stamp that could never serve production afterwards.
 * They now refuse first, before opening any database.
 */
describe("npm run db:seed / reset:demo — CLI outside demo mode", () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "jeeves-seed-cli-prod-"));
    const client = new PGlite(dir);
    await migrate(drizzle({ client, schema }), { migrationsFolder: "./drizzle" });
    await client.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function runScript(script: string, env: Record<string, string>) {
    return spawnSync(join(process.cwd(), "node_modules/.bin/tsx"), [script], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120_000,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        DATA_PROVIDER: "",
        DATABASE_MIGRATION_URL: "",
        POSTGRES_URL: "",
        VERCEL: "",
        // Not "production": that would trip the ALLOW_SEED guard, which runs
        // before the mode check these cases are about.
        NODE_ENV: "development",
        ...env,
      },
    });
  }

  async function storeState() {
    const client = new PGlite(dir);
    const db = drizzle({ client, schema });
    try {
      return {
        stamp: await readInstallationStamp(db),
        initiatives: (await db.select({ n: count() }).from(initiatives))[0].n,
      };
    } finally {
      await client.close();
    }
  }

  // Port 1 refuses connections at once: a script that ignored the mode would
  // fail with a connection error, not with the demo-only refusal asserted here.
  const UNREACHABLE_DATABASE = "postgres://jeeves:pw@127.0.0.1:1/jeeves";

  it.each(["scripts/seed.ts", "scripts/reset-demo.ts"])(
    "%s exits 1 with JEEVES_MODE unset and a database URL set, before it connects",
    (script) => {
      const result = runScript(script, { DATABASE_URL: UNREACHABLE_DATABASE });
      const output = `${result.stdout}${result.stderr}`;

      expect(result.status).toBe(1);
      expect(output).toMatch(/demo-only/);
      expect(output).toMatch(/JEEVES_MODE=demo/);
      expect(output).not.toMatch(/ECONNREFUSED|ENOTFOUND|EAI_AGAIN/);
    },
    150_000,
  );

  it.each(["scripts/seed.ts", "scripts/reset-demo.ts"])(
    "%s exits 1 for a mode that is not exactly 'demo' and leaves an unstamped store with no stamp and no rows",
    async (script) => {
      const result = runScript(script, { JEEVES_MODE: "Demo", JEEVES_PGLITE_DIR: dir, DATABASE_URL: "" });

      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toMatch(/demo-only/);
      expect(await storeState()).toEqual({ stamp: null, initiatives: 0 });
    },
    150_000,
  );
});
