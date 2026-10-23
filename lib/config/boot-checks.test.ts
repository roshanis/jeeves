// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootFailure, resetBootStateForTests } from "./boot-state";
import { runBootChecks } from "./boot-checks";

const SECRET = "0123456789abcdef0123456789abcdef";

const COMPLETE_PRODUCTION: Record<string, string> = {
  JEEVES_MODE: "production",
  DATABASE_URL: "postgres://jeeves_app:s3cr3t-db-pw@db.internal:5432/jeeves",
  JEEVES_COOKIE_SECRET: SECRET,
  APP_BASE_URL: "https://jeeves.example.com",
  JEEVES_TENANT_ID: "tenant-acme",
};

function deps(env: Record<string, string | undefined>) {
  return { env, exit: vi.fn(), log: vi.fn() };
}

afterEach(() => {
  resetBootStateForTests();
});

describe("runBootChecks", () => {
  describe("in production mode", () => {
    it("lets a complete configuration boot", async () => {
      const d = deps(COMPLETE_PRODUCTION);
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
  });

  describe("in demo mode", () => {
    it("does nothing, even with none of the production variables set", async () => {
      const d = deps({ JEEVES_MODE: "demo", DATA_PROVIDER: "mock" });
      await runBootChecks(d);
      expect(d.exit).not.toHaveBeenCalled();
      expect(d.log).not.toHaveBeenCalled();
      expect(bootFailure()).toBeNull();
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
