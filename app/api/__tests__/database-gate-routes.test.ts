// @vitest-environment node
/**
 * The installation gate at the HTTP surface. In demo, while the database has
 * not been verified in this process (it was unreachable at boot), every
 * handler that can reach the database answers 503 with Retry-After BEFORE it
 * touches anything, and the database handle is never opened. /api/health
 * answers 503 degraded too. The walk is over the route files, so a handler
 * added later without the gate fails here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeInstallationGate, resetBootStateForTests } from "@/lib/config/boot-state";

const dbCalls: string[] = [];
vi.mock("@/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/client")>()),
  getDb: () => {
    dbCalls.push("getDb");
    throw new Error("the database must not be touched while the gate is closed");
  },
}));

const REPO = join(__dirname, "..", "..", "..");

function walk(dir: string, accept: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, accept) : accept(name) ? [full] : [];
  });
}

const routeFiles = walk(join(REPO, "app"), (n) => n === "route.ts");
const HANDLER = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
const handlers = routeFiles.flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(HANDLER)].map((m) => ({ file, method: m[1]! })),
);

const modules = import.meta.glob("/app/**/route.ts");
const moduleFor = (file: string) => modules[file.slice(REPO.length)];

beforeEach(() => {
  dbCalls.length = 0;
  vi.stubEnv("JEEVES_MODE", "demo");
  vi.stubEnv("DATABASE_URL", "postgres://u:p@db.internal:5432/jeeves");
  vi.stubEnv("OPERATOR_TOKEN", "operator-token-for-the-gate-test-0123456789");
  vi.stubEnv("CRON_SECRET", "cron-secret-for-the-gate-test");
  vi.stubEnv("JEEVES_COOKIE_SECRET", "cookie-secret-for-the-gate-test-0123456789");
  closeInstallationGate();
});

afterEach(() => {
  resetBootStateForTests();
  vi.unstubAllEnvs();
});

describe("database gate on every route handler", () => {
  it("finds the handlers (guards the walker itself)", () => {
    expect(handlers.length).toBe(42);
    for (const needle of ["session/route", "public-session/route", "public-intake/route", "cron/monitor/route", "detail-data/route"]) {
      expect(handlers.some((h) => h.file.includes(needle))).toBe(true);
    }
  });

  it.each(handlers.filter((h) => !h.file.endsWith("/api/health/route.ts") && !h.file.endsWith("/api/health/live/route.ts")).map((h) => [h.file.slice(REPO.length), h.method, h]))(
    "%s %s answers 503 with Retry-After and never opens the database",
    async (_path, method, h) => {
      const handler = h as { file: string; method: string };
      const mod = (await moduleFor(handler.file)!()) as Record<string, (req: Request, ctx: unknown) => Promise<Response>>;
      const req = new Request("http://localhost/api/x", {
        method: method as string,
        headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
        body: method === "GET" ? undefined : "{}",
      });
      const res = await mod[method as string]!(req, { params: Promise.resolve({ id: "x", slug: "x", cycleId: "x", domain: "x", documentId: "x" }) });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("15");
      expect((await res.json()).code).toBe("DEMO_STORAGE_UNAVAILABLE");
      expect(dbCalls).toEqual([]);
    },
  );

  it("/api/health answers 503 degraded, with Retry-After, and no database call", async () => {
    const mod = (await modules["/app/api/health/route.ts"]!()) as { GET: () => Promise<Response> };
    const res = await mod.GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("15");
    await expect(res.json()).resolves.toEqual({ status: "degraded", database: "unreachable" });
    expect(dbCalls).toEqual([]);
  });

  it("/api/health/live stays 200 with the gate closed: liveness never depends on the database", async () => {
    const mod = (await modules["/app/api/health/live/route.ts"]!()) as { GET: () => Promise<Response> };
    const res = await mod.GET();
    expect(res.status).toBe(200);
    expect(dbCalls).toEqual([]);
  });

  it("the installation-check handle is named only by the client, the boot checks and tests", () => {
    const files = ["app", "lib", "components", "scripts"].flatMap((d) => walk(join(REPO, d), (n) => /\.(ts|tsx)$/.test(n)));
    const users = files
      .filter((f) => !/\.test\.tsx?$/.test(f) && readFileSync(f, "utf8").includes("getDbForInstallationCheck"))
      .map((f) => f.slice(REPO.length + 1))
      .sort();
    expect(users).toEqual(["lib/config/boot-checks.ts", "lib/db/client.ts"]);
  });
});
