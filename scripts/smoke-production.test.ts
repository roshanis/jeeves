// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertDisposableDatabaseUrl,
  bootRefusalCases,
  buildServerEnv,
  buildSmokeChecks,
  evaluateCheck,
  redact,
  type Observed,
  type SmokeCheck,
} from "./smoke-production";
import {
  CONSOLE_HOME,
  CONSOLE_PATH_PREFIXES,
  MARKETING_PATH_PREFIXES,
  SIGN_IN_PATH,
} from "../lib/config/production-routes";

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
    expect(checks.some((c) => /garbage cookie leaks no data/.test(c.name))).toBe(true);
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
