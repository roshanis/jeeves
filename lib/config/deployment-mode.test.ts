// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProductionConfigError,
  assertProductionConfig,
  deploymentMode,
  isDemoMode,
  isProductionMode,
} from "./deployment-mode";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deploymentMode", () => {
  it("is demo only when JEEVES_MODE is exactly 'demo'", () => {
    expect(deploymentMode({ JEEVES_MODE: "demo" })).toBe("demo");
  });

  // The default is the safe direction: a missing or mistyped flag must never
  // open the demo doors (passwordless personas, public sessions, synthetic
  // data) on an install that meant to be production.
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["differently cased", "Demo"],
    ["upper cased", "DEMO"],
    ["padded", " demo "],
    ["an abbreviation", "prod"],
    ["production", "production"],
    ["a typo", "demmo"],
  ])("is production when JEEVES_MODE is %s", (_label, value) => {
    expect(deploymentMode({ JEEVES_MODE: value })).toBe("production");
  });

  it("is production for an empty environment", () => {
    expect(deploymentMode({})).toBe("production");
  });

  // JEEVES_DEMO_ENABLED is the build constant next.config.ts inlines. A
  // production image is built with it set to "0" so that a stray
  // `-e JEEVES_MODE=demo` at run time cannot turn the demo back on.
  it("is production when the build constant disables demo, even with JEEVES_MODE=demo", () => {
    expect(deploymentMode({ JEEVES_MODE: "demo", JEEVES_DEMO_ENABLED: "0" })).toBe("production");
  });

  it("stays demo when the build constant is '1' or absent", () => {
    expect(deploymentMode({ JEEVES_MODE: "demo", JEEVES_DEMO_ENABLED: "1" })).toBe("demo");
    expect(deploymentMode({ JEEVES_MODE: "demo" })).toBe("demo");
  });

  it("reads process.env by default", () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    vi.stubEnv("JEEVES_DEMO_ENABLED", "");
    expect(deploymentMode()).toBe("demo");
    expect(isDemoMode()).toBe(true);
    expect(isProductionMode()).toBe(false);

    vi.stubEnv("JEEVES_DEMO_ENABLED", "0");
    expect(deploymentMode()).toBe("production");
    expect(isDemoMode()).toBe(false);
    expect(isProductionMode()).toBe(true);
  });

  it("reads the live environment on every call, not a value cached at import", () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    expect(isDemoMode()).toBe(true);
    vi.stubEnv("JEEVES_MODE", "production");
    expect(isDemoMode()).toBe(false);
  });
});

const SECRET = "0123456789abcdef0123456789abcdef"; // 32 chars

function completeConfig(): Record<string, string> {
  return {
    JEEVES_MODE: "production",
    DATABASE_URL: "postgres://jeeves_app:s3cr3t-db-pw@db.internal:5432/jeeves",
    JEEVES_COOKIE_SECRET: SECRET,
    APP_BASE_URL: "https://jeeves.example.com",
    JEEVES_TENANT_ID: "tenant-acme",
  };
}

function problemsFor(env: Record<string, string | undefined>): readonly string[] {
  try {
    assertProductionConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ProductionConfigError);
    return (err as ProductionConfigError).problems;
  }
  return [];
}

describe("assertProductionConfig", () => {
  it("accepts a complete configuration", () => {
    expect(() => assertProductionConfig(completeConfig())).not.toThrow();
  });

  it("accepts the Vercel-style POSTGRES_URL alias in place of DATABASE_URL", () => {
    const env: Record<string, string | undefined> = completeConfig();
    env.POSTGRES_URL = env.DATABASE_URL;
    delete env.DATABASE_URL;
    expect(() => assertProductionConfig(env)).not.toThrow();
  });

  it("does not require OPENAI_API_KEY: production without it means LLM features are not configured", () => {
    const env = completeConfig();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(() => assertProductionConfig(env)).not.toThrow();
  });

  it("collects every problem and throws one ProductionConfigError", () => {
    let thrown: unknown;
    try {
      assertProductionConfig({ JEEVES_MODE: "production" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ProductionConfigError);
    const error = thrown as ProductionConfigError;
    expect(error.name).toBe("ProductionConfigError");
    expect(error.problems).toHaveLength(4);
    for (const name of ["DATABASE_URL", "JEEVES_COOKIE_SECRET", "APP_BASE_URL", "JEEVES_TENANT_ID"]) {
      expect(error.message).toContain(name);
    }
  });

  describe("database", () => {
    it("is required", () => {
      const env: Record<string, string | undefined> = completeConfig();
      delete env.DATABASE_URL;
      expect(problemsFor(env).join("\n")).toMatch(/DATABASE_URL/);
    });

    it("treats a blank URL as missing", () => {
      const env = { ...completeConfig(), DATABASE_URL: "   ", POSTGRES_URL: "" };
      expect(problemsFor(env).join("\n")).toMatch(/DATABASE_URL/);
    });

    // lib/db/client.ts falls back to the local PGlite store whenever
    // runtimeDatabaseUrl() is empty. That store is a file under ./.pglite: it
    // is not a production database, and it would silently hold customer data
    // on a container's ephemeral disk.
    it("refuses a configuration that would select PGlite", () => {
      const env: Record<string, string | undefined> = completeConfig();
      delete env.DATABASE_URL;
      expect(problemsFor(env).join("\n")).toMatch(/PGlite/);
    });

    it("refuses discrete PG* settings alone, because lib/db does not read them and would fall to PGlite", () => {
      const env: Record<string, string | undefined> = completeConfig();
      delete env.DATABASE_URL;
      Object.assign(env, { PGHOST: "db.internal", PGDATABASE: "jeeves", PGUSER: "jeeves_app" });
      expect(problemsFor(env).join("\n")).toMatch(/PGlite/);
    });
  });

  describe("DATA_PROVIDER", () => {
    it("refuses the mock read provider", () => {
      const problems = problemsFor({ ...completeConfig(), DATA_PROVIDER: "mock" });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/DATA_PROVIDER/);
    });

    it("refuses mock regardless of case or padding", () => {
      expect(problemsFor({ ...completeConfig(), DATA_PROVIDER: " Mock " })).toHaveLength(1);
    });

    it("accepts 'db' and unset", () => {
      expect(problemsFor({ ...completeConfig(), DATA_PROVIDER: "db" })).toEqual([]);
      expect(problemsFor(completeConfig())).toEqual([]);
    });
  });

  describe("JEEVES_COOKIE_SECRET", () => {
    it("is required", () => {
      const env: Record<string, string | undefined> = completeConfig();
      delete env.JEEVES_COOKIE_SECRET;
      expect(problemsFor(env).join("\n")).toMatch(/JEEVES_COOKIE_SECRET/);
    });

    it("must be at least 32 characters", () => {
      expect(problemsFor({ ...completeConfig(), JEEVES_COOKIE_SECRET: SECRET.slice(0, 31) })).toHaveLength(1);
      expect(problemsFor({ ...completeConfig(), JEEVES_COOKIE_SECRET: SECRET })).toEqual([]);
    });

    it("does not count padding towards the length", () => {
      const padded = `${" ".repeat(10)}${SECRET.slice(0, 20)}${" ".repeat(10)}`;
      expect(padded.length).toBeGreaterThanOrEqual(32);
      expect(problemsFor({ ...completeConfig(), JEEVES_COOKIE_SECRET: padded })).toHaveLength(1);
    });

    // resolveWorkspaceCookieSecret() derives a signing key from DEMO_PASSCODE
    // when no cookie secret is set. That fallback exists for the legacy demo
    // only; a production install must not sign sessions with a passcode.
    it("is not satisfied by DEMO_PASSCODE", () => {
      const env: Record<string, string | undefined> = completeConfig();
      delete env.JEEVES_COOKIE_SECRET;
      env.DEMO_PASSCODE = "a-very-long-demo-passcode-of-more-than-32-characters";
      expect(problemsFor(env).join("\n")).toMatch(/JEEVES_COOKIE_SECRET/);
    });
  });

  describe("APP_BASE_URL", () => {
    it("is required", () => {
      const env: Record<string, string | undefined> = completeConfig();
      delete env.APP_BASE_URL;
      expect(problemsFor(env).join("\n")).toMatch(/APP_BASE_URL/);
    });

    it.each([
      ["plain http", "http://jeeves.example.com"],
      ["a bare host", "jeeves.example.com"],
      ["a relative path", "/jeeves"],
      ["not a URL", "not a url"],
      ["another scheme", "ftp://jeeves.example.com"],
    ])("rejects %s", (_label, value) => {
      const problems = problemsFor({ ...completeConfig(), APP_BASE_URL: value });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/APP_BASE_URL/);
    });

    it("accepts an absolute https URL, with a port or a path", () => {
      expect(problemsFor({ ...completeConfig(), APP_BASE_URL: "https://jeeves.example.com:8443" })).toEqual([]);
      expect(problemsFor({ ...completeConfig(), APP_BASE_URL: "https://example.com/jeeves" })).toEqual([]);
    });
  });

  describe("JEEVES_TENANT_ID", () => {
    it("is required and must be non-blank", () => {
      const env: Record<string, string | undefined> = completeConfig();
      delete env.JEEVES_TENANT_ID;
      expect(problemsFor(env).join("\n")).toMatch(/JEEVES_TENANT_ID/);
      expect(problemsFor({ ...completeConfig(), JEEVES_TENANT_ID: "   " })).toHaveLength(1);
    });
  });

  // The error is logged at boot and may land in a log aggregator. It names
  // variables, never values.
  it("never echoes a configured value", () => {
    const env = {
      ...completeConfig(),
      JEEVES_COOKIE_SECRET: "short-but-secret",
      APP_BASE_URL: "http://user:hunter2@jeeves.example.com",
      DATA_PROVIDER: "mock",
    };
    let message = "";
    try {
      assertProductionConfig(env);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toBe("");
    for (const secret of ["short-but-secret", "hunter2", "s3cr3t-db-pw", "jeeves.example.com"]) {
      expect(message).not.toContain(secret);
    }
  });

  it("reads process.env by default", () => {
    for (const [key, value] of Object.entries(completeConfig())) vi.stubEnv(key, value);
    expect(() => assertProductionConfig()).not.toThrow();
    vi.stubEnv("JEEVES_TENANT_ID", "");
    expect(() => assertProductionConfig()).toThrow(ProductionConfigError);
  });
});
