// @vitest-environment node
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assertDisposableDatabaseUrl,
  bootRefusalCases,
  bootRefusalCasesFor,
  buildServerEnv,
  buildSmokeChecks,
  databaseSecrets,
  evaluateCheck,
  parsePort,
  portInUse,
  prepareSmokeDatabase,
  runToCompletion,
  redact,
  removeCanaries,
  runtimeEnvFor,
  seedCanary,
  withCanary,
  type Observed,
  type SmokeCheck,
} from "./smoke-production";
import { verifyInstallation } from "../lib/config/installation-check";
import {
  CONSOLE_HOME,
  CONSOLE_PATH_PREFIXES,
  MARKETING_PATH_PREFIXES,
  SIGN_IN_PATH,
} from "../lib/config/production-routes";
import { DbDataProvider } from "../lib/data/db-provider";
import { initiatives, installation } from "../lib/db/schema";
import { clearInstallationFixtures, closeTestDb, createTestDb, type TestDb } from "../lib/db/test-client";
import { SESSION_COOKIE_NAME } from "../lib/security/session-cookie-name";

afterEach(() => vi.unstubAllEnvs());

describe("assertDisposableDatabaseUrl", () => {
  it.each([
    "postgres://u:p@h:5432/jeeves_smoke_ci",
    "postgresql://u:p@h/jeeves_smoke_local?sslmode=disable",
  ])("accepts %s", (url) => {
    expect(assertDisposableDatabaseUrl(url)).toBe(url);
  });

  it.each([
    undefined,
    "",
    "not a url",
    "https://u:p@h/jeeves_smoke_ci",
    "postgres://u:p@h/jeeves",
    "postgres://u:p@h/jeeves_prod",
    "postgres://u:p@h/jeeves_smoke_",
    "postgres://u:p@h/Jeeves_Smoke_X",
    "postgres://u:p@h/jeeves_smoke_x/extra",
    "postgres://u:p@h/postgres",
  ])("rejects %s", (url) => {
    expect(() => assertDisposableDatabaseUrl(url)).toThrow(/jeeves_smoke_/);
  });

  it("never echoes the rejected URL, user, password or host", () => {
    let message = "";
    try {
      assertDisposableDatabaseUrl("postgres://sekretuser:hunter2pw@db.prod.internal:5432/jeeves_prod");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toBe("");
    for (const secret of ["sekretuser", "hunter2pw", "db.prod.internal", "jeeves_prod"]) {
      expect(message).not.toContain(secret);
    }
    expect(message).toMatch(/CREATE DATABASE/);
  });
});

describe("buildServerEnv", () => {
  it("builds the environment from scratch, ignoring the ambient one", () => {
    for (const name of [
      "JEEVES_MODE",
      "DATA_PROVIDER",
      "OPERATOR_TOKEN",
      "CRON_SECRET",
      "OPENAI_API_KEY",
      "POSTGRES_URL",
      "DEMO_PASSCODE",
      "SOMETHING_ELSE",
    ]) {
      vi.stubEnv(name, "ambient");
    }
    vi.stubEnv("PATH", "/usr/bin");
    vi.stubEnv("HOME", "/home/x");
    const env = buildServerEnv({ databaseUrl: "postgres://u:p@h/jeeves_smoke_a", port: 3217, cookieSecret: "ab".repeat(32) });
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/x",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: "3217",
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: "postgres://u:p@h/jeeves_smoke_a",
      JEEVES_COOKIE_SECRET: "ab".repeat(32),
      APP_BASE_URL: "https://jeeves.example.com",
      JEEVES_TENANT_ID: "smoke-tenant",
      JEEVES_TRUSTED_PROXY_HOPS: "0",
    });
  });

  it("omits HOME when the ambient environment has none", () => {
    vi.stubEnv("HOME", undefined as unknown as string);
    const env = buildServerEnv({ databaseUrl: "postgres://u:p@h/jeeves_smoke_a", port: 1, cookieSecret: "s" });
    expect("HOME" in env).toBe(false);
  });
});

describe("buildSmokeChecks", () => {
  const checks = buildSmokeChecks();
  const find = (method: string, path: string, name?: RegExp) =>
    checks.filter((c) => c.method === method && c.path === path && (!name || name.test(c.name)));

  it("has unique names", () => {
    const names = checks.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("redirects / to the console home and each console prefix to sign-in with a 307", () => {
    const home = find("GET", "/")[0];
    expect(home.expect).toMatchObject({ status: 307, location: CONSOLE_HOME, noStore: true });
    for (const prefix of CONSOLE_PATH_PREFIXES) {
      const check = find("GET", prefix).find((c) => c.expect.status === 307 && !c.headers);
      expect(check, prefix).toBeDefined();
      expect(check?.expect.location).toBe(SIGN_IN_PATH);
    }
  });

  it("answers 404 with no body for every marketing prefix", () => {
    for (const prefix of MARKETING_PATH_PREFIXES) {
      const check = find("GET", prefix)[0];
      expect(check, prefix).toBeDefined();
      expect(check.expect).toMatchObject({ status: 404, noStore: true, emptyBody: true });
    }
  });

  it("closes every demo door for both GET and POST", () => {
    for (const door of ["/api/session", "/api/public-session", "/api/public-intake", "/api/cron/monitor", "/api/monitor/run"]) {
      for (const method of ["GET", "POST"]) {
        const check = find(method, door)[0];
        expect(check, `${method} ${door}`).toBeDefined();
        expect(check.expect.status).toBe(404);
      }
    }
  });

  it("covers the foreign Host header and the garbage cookie", () => {
    expect(checks.some((c) => c.headers?.Host === "attacker.example" && c.expect.location === SIGN_IN_PATH)).toBe(true);
    const garbage = checks.find((c) => /garbage cookie leaks no data/.test(c.name));
    // The real cookie name, so the request reaches the page the way a stale session would.
    expect(garbage?.headers?.cookie).toBe(`${SESSION_COOKIE_NAME}=garbage`);
    // Present-but-invalid credentials currently render a streamed redirect inside a 200: pin it, so a 5xx or a rendered console fails.
    expect(garbage?.expect.status).toBe(200);
    expect(evaluateCheck(garbage!, { status: 500, headers: {}, body: "" }).length).toBeGreaterThan(0);
    expect(evaluateCheck(garbage!, { status: 200, headers: {}, body: "<html>" }).length).toBeGreaterThan(0);
    expect(evaluateCheck(garbage!, { status: 200, headers: {}, body: "x NEXT_REDIRECT;replace;/sign-in;307 x" })).toEqual([]);
    // The seeded canary must never appear.
    const garbageWithCanary = buildSmokeChecks("smoke-canary-abc").find((c) => /garbage cookie leaks no data/.test(c.name))!;
    expect(evaluateCheck(garbageWithCanary, { status: 200, headers: {}, body: "NEXT_REDIRECT;replace;/sign-in smoke-canary-abc" }).join(" ")).toMatch(/smoke-canary-abc/);
  });
});

// Booting PGlite and replaying the migrations costs more than the cases below do, so one database
// serves both blocks. It is built in beforeAll, whose 30 s hook timeout covers a loaded machine.
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});

describe("the canary row", () => {
  /** The migrated database as the smoke test leaves it before the server starts: stamped, no rows. */
  async function stampedProduction(): Promise<TestDb> {
    await clearInstallationFixtures(db);
    await db.insert(installation).values({ deployMode: "production", installId: "inst-smoke" });
    return db;
  }

  const indexWithoutViewer = (database: TestDb) => new DbDataProvider(database).listInitiativeIndex({ viewerWorkspaceId: null });

  it("is what a read with no viewer returns, so a leak past the gate would show it", async () => {
    const database = await stampedProduction();
    await seedCanary(database.$client, "smoke-canary-abc");

    expect(await indexWithoutViewer(database)).toEqual([{ slug: "smoke-canary-abc", title: "smoke-canary-abc" }]);
  });

  it("is refused by the production boot check, and removing it lets the next server start", async () => {
    const database = await stampedProduction();
    await expect(verifyInstallation(database, "production")).resolves.toBeUndefined();

    // Why the row is written only once the server is up.
    await seedCanary(database.$client, "smoke-canary-abc");
    await expect(verifyInstallation(database, "production")).rejects.toThrow(/demo data/);

    // Why it is removed afterwards: CI runs the smoke test twice against one database.
    await removeCanaries(database.$client);
    await expect(verifyInstallation(database, "production")).resolves.toBeUndefined();
  });

  it("removes every canary an interrupted run left behind, and no other row", async () => {
    const database = await stampedProduction();
    await seedCanary(database.$client, "smoke-canary-one");
    await seedCanary(database.$client, "smoke-canary-two");
    const now = new Date();
    await database.insert(initiatives).values([
      { id: "kept-1", slug: "kept-1", title: "smoke-canary-one", requester: "smoke", state: "intake_draft", workspaceId: "tenant-acme", createdAt: now, updatedAt: now },
      { id: "x-smoke-canary-1", slug: "kept-2", title: "Kept", requester: "smoke", state: "intake_draft", workspaceId: "tenant-acme", createdAt: now, updatedAt: now },
    ]);

    await removeCanaries(database.$client);

    const left = await database.select({ id: initiatives.id }).from(initiatives);
    expect(left.map((row) => row.id).sort()).toEqual(["kept-1", "x-smoke-canary-1"]);
  });

  it("is in the database while the checks run and gone afterwards", async () => {
    const database = await stampedProduction();
    let during: Array<{ slug: string; title: string }> = [];

    await withCanary(database.$client, "smoke-canary-abc", async () => {
      during = await indexWithoutViewer(database);
    });

    expect(during).toEqual([{ slug: "smoke-canary-abc", title: "smoke-canary-abc" }]);
    expect(await indexWithoutViewer(database)).toEqual([]);
    await expect(verifyInstallation(database, "production")).resolves.toBeUndefined();
  });

  it("is removed when the checks throw, and the error is passed on", async () => {
    const database = await stampedProduction();

    await expect(
      withCanary(database.$client, "smoke-canary-abc", async () => {
        throw new Error("a check blew up");
      }),
    ).rejects.toThrow("a check blew up");

    expect(await indexWithoutViewer(database)).toEqual([]);
  });
});

describe("prepareSmokeDatabase", () => {
  it("stamps a migrated, empty database production, so a production server starts on it", async () => {
    await clearInstallationFixtures(db);

    await prepareSmokeDatabase(db.$client, "smoke-1");

    expect(await db.select({ deployMode: installation.deployMode, installId: installation.installId }).from(installation)).toEqual([
      { deployMode: "production", installId: "smoke-1" },
    ]);
    await expect(verifyInstallation(db, "production")).resolves.toBeUndefined();
  });

  it("keeps the stamp of an earlier run and clears the canary that an interrupted run left behind", async () => {
    await clearInstallationFixtures(db);
    await prepareSmokeDatabase(db.$client, "smoke-1");
    await seedCanary(db.$client, "smoke-canary-left");
    await expect(verifyInstallation(db, "production")).rejects.toThrow(/demo data/);

    await prepareSmokeDatabase(db.$client, "smoke-2");

    expect(await db.select({ installId: installation.installId }).from(installation)).toEqual([{ installId: "smoke-1" }]);
    await expect(verifyInstallation(db, "production")).resolves.toBeUndefined();
  });

  it("refuses a database stamped demo and leaves its rows as they were", async () => {
    await clearInstallationFixtures(db);
    await db.insert(installation).values({ deployMode: "demo", installId: "inst-demo" });
    await seedCanary(db.$client, "smoke-canary-not-ours");

    await expect(prepareSmokeDatabase(db.$client, "smoke-1")).rejects.toThrow(/stamped demo/);

    expect(await db.select({ id: initiatives.id }).from(initiatives)).toEqual([{ id: "smoke-canary-not-ours" }]);
    expect(await db.select({ deployMode: installation.deployMode }).from(installation)).toEqual([{ deployMode: "demo" }]);
  });
});

describe("evaluateCheck", () => {
  const redirect: SmokeCheck = {
    name: "r",
    method: "GET",
    path: "/",
    expect: { status: 307, location: "/inbox", noStore: true },
  };
  const good: Observed = { status: 307, headers: { location: "/inbox", "cache-control": "no-store" }, body: "" };

  it("passes on a matching response", () => {
    expect(evaluateCheck(redirect, good)).toEqual([]);
  });
  it("reports a wrong status (a 500 where a redirect is expected)", () => {
    const problems = evaluateCheck(redirect, { status: 500, headers: { "cache-control": "no-store" }, body: "" });
    expect(problems.join(" ")).toMatch(/status 500/);
  });
  it("reports a missing Location", () => {
    expect(evaluateCheck(redirect, { ...good, headers: { "cache-control": "no-store" } }).join(" ")).toMatch(/location/i);
  });
  it("reports an absolute Location where a relative one is expected", () => {
    const problems = evaluateCheck(redirect, { ...good, headers: { ...good.headers, location: "http://127.0.0.1:3217/inbox" } });
    expect(problems.join(" ")).toMatch(/location/i);
  });
  it("reports a missing no-store", () => {
    expect(evaluateCheck(redirect, { ...good, headers: { location: "/inbox" } }).join(" ")).toMatch(/no-store/);
  });
  it("reports a body where none is expected", () => {
    const check: SmokeCheck = { name: "e", method: "GET", path: "/x", expect: { status: 404, emptyBody: true } };
    expect(evaluateCheck(check, { status: 404, headers: {}, body: "<html>" }).join(" ")).toMatch(/empty/);
  });
  it("reports a forbidden body string and a missing required one", () => {
    const check: SmokeCheck = {
      name: "b",
      method: "GET",
      path: "/x",
      expect: { status: 200, bodyIncludes: ["needed"], bodyExcludes: ["Meridian"] },
    };
    const problems = evaluateCheck(check, { status: 200, headers: {}, body: "Meridian" }).join(" ");
    expect(problems).toMatch(/Meridian/);
    expect(problems).toMatch(/needed/);
  });
  it("matches expected headers case-insensitively, by string or pattern", () => {
    const check: SmokeCheck = {
      name: "h",
      method: "GET",
      path: "/x",
      expect: { status: 200, headers: { "X-Frame-Options": "DENY", "Strict-Transport-Security": /max-age=\d+/ } },
    };
    expect(evaluateCheck(check, { status: 200, headers: { "x-frame-options": "DENY", "strict-transport-security": "max-age=1" }, body: "" })).toEqual([]);
    expect(evaluateCheck(check, { status: 200, headers: { "x-frame-options": "SAMEORIGIN" }, body: "" })).toHaveLength(2);
  });
  it("leaves the status unasserted when the check names none", () => {
    const check: SmokeCheck = { name: "s", method: "GET", path: "/x", expect: { bodyExcludes: ["Meridian"] } };
    expect(evaluateCheck(check, { status: 200, headers: {}, body: "ok" })).toEqual([]);
    expect(evaluateCheck(check, { status: 500, headers: {}, body: "ok" })).toEqual([]);
    expect(evaluateCheck(check, { status: 200, headers: {}, body: "Meridian" })).toHaveLength(1);
  });
  it("reports an X-Powered-By header", () => {
    const problems = evaluateCheck(redirect, { ...good, headers: { ...good.headers, "X-Powered-By": "Next.js" } });
    expect(problems.join(" ")).toMatch(/x-powered-by/i);
  });
});

describe("bootRefusalCases", () => {
  it("lists four cases with a modification and expected text", () => {
    expect(bootRefusalCases).toHaveLength(4);
    const base = { PATH: "/p", JEEVES_COOKIE_SECRET: "s", APP_BASE_URL: "https://jeeves.example.com" };
    for (const c of bootRefusalCases) {
      expect(c.name).toBeTruthy();
      expect(c.expectText).toBeTruthy();
      expect(c.modify({ ...base })).not.toEqual(base);
    }
    expect(new Set(bootRefusalCases.map((c) => c.name)).size).toBe(4);
  });
});

describe("a demo-locked build (JEEVES_DEMO_ENABLED=0)", () => {
  const good = { PATH: "/p", JEEVES_COOKIE_SECRET: "s", APP_BASE_URL: "https://jeeves.example.com" };

  it("a demo-capable build keeps every refusal and runs without JEEVES_MODE", () => {
    expect(bootRefusalCasesFor(false)).toEqual(bootRefusalCases);
    expect(runtimeEnvFor(good, false)).toEqual(good);
  });

  it("a locked build cannot refuse demo mode, because it never enters it", () => {
    const cases = bootRefusalCasesFor(true);
    expect(cases).toHaveLength(3);
    expect(cases.some((c) => c.modify({ ...good }).JEEVES_MODE === "demo")).toBe(false);
  });

  it("a locked build is started WITH JEEVES_MODE=demo, so every production check doubles as proof the flag is ignored", () => {
    expect(runtimeEnvFor(good, true)).toEqual({ ...good, JEEVES_MODE: "demo" });
    // The caller's environment is not mutated.
    expect("JEEVES_MODE" in good).toBe(false);
  });
});

describe("redact", () => {
  it("replaces the URL and its password everywhere", () => {
    const url = "postgres://jeeves:pw-1234@127.0.0.1:54329/jeeves_smoke_x";
    const out = redact(`connect ${url} failed; password pw-1234 rejected; ${url}`, [url]);
    expect(out).not.toContain("pw-1234");
    expect(out).not.toContain(url);
    expect(out).toContain("[redacted]");
  });
  it("leaves text alone when there is nothing to hide", () => {
    expect(redact("hello", ["not a url"])).toBe("hello");
  });
});

describe("databaseSecrets", () => {
  it("lists the URL and the password in both its written and decoded forms", () => {
    expect(databaseSecrets("postgres://u:p%40ss@h/jeeves_smoke_a")).toEqual(["postgres://u:p%40ss@h/jeeves_smoke_a", "p%40ss", "p@ss"]);
  });
  it("lists only the URL when it carries no password", () => {
    expect(databaseSecrets("postgres://u@h/jeeves_smoke_a")).toEqual(["postgres://u@h/jeeves_smoke_a"]);
  });
});

describe("parsePort", () => {
  it("defaults to 3217 and accepts a valid port", () => {
    expect(parsePort(undefined)).toBe(3217);
    expect(parsePort("3218")).toBe(3218);
  });
  it.each(["", "abc", "0", "70000", "3217.5", "-1"])("rejects %j", (value) => {
    expect(() => parsePort(value)).toThrow(/SMOKE_PORT/);
  });
});

describe("the /operator is-closed check", () => {
  it("excludes only markers the operator page actually renders", () => {
    const check = buildSmokeChecks().find((c) => c.path === "/operator")!;
    const source = ["app/operator/page.tsx", "components/jeeves/public-intake-queue.tsx"]
      .map((f) => readFileSync(path.join(__dirname, "..", f), "utf8"))
      .join("\n");
    expect(check.expect.bodyExcludes?.length).toBeGreaterThan(0);
    for (const marker of check.expect.bodyExcludes ?? []) expect(source, marker).toContain(marker);
  });
});

describe("portInUse", () => {
  it("is true while something listens on the port and false once it stops", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    expect(await portInUse(port)).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await portInUse(port)).toBe(false);
  });
});

describe("runToCompletion", () => {
  it("returns the exit code and the output of a run that finishes", async () => {
    const run = await runToCompletion(["-e", "console.log('migrated'); process.exit(3)"], { PATH: process.env.PATH ?? "" }, 10_000);
    expect(run).toEqual({ code: 3, output: "migrated\n", timedOut: false });
  });

  it("stops a run that outlives its limit and says so, so a hung migration cannot hold the job", async () => {
    const started = Date.now();
    const run = await runToCompletion(["-e", "console.log('started'); setInterval(() => {}, 1000)"], { PATH: process.env.PATH ?? "" }, 500);
    expect(run.timedOut).toBe(true);
    expect(run.code).not.toBe(0);
    expect(run.output).toContain("started");
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
