// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { bootFailure, resetBootStateForTests } from "@/lib/config/boot-state";
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

beforeEach(() => {
  exit = vi.fn<(code: number) => void>();
  log = vi.fn<(...args: unknown[]) => void>();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-server");
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetBootStateForTests();
});

describe("instrumentation register()", () => {
  it("marks the boot failed and exits when the production configuration is invalid", async () => {
    stubProductionBootEnv();
    await register({ exit, log });

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(bootFailure()).toMatch(/DATABASE_URL/);
    expect(log).toHaveBeenCalled();
  });

  it("lets a valid production configuration start", async () => {
    stubProductionBootEnv();
    vi.stubEnv("DATABASE_URL", "postgres://jeeves_app:pw@db.internal:5432/jeeves");
    vi.stubEnv("JEEVES_COOKIE_SECRET", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("APP_BASE_URL", "https://jeeves.example.com");
    vi.stubEnv("JEEVES_TENANT_ID", "tenant-acme");
    vi.stubEnv("DATA_PROVIDER", "db");
    await register({ exit, log });

    expect(exit).not.toHaveBeenCalled();
    expect(bootFailure()).toBeNull();
  });

  it("does nothing during `next build`", async () => {
    stubProductionBootEnv();
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await register({ exit, log });

    expect(exit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(bootFailure()).toBeNull();
  });

  it("does nothing outside the Node.js runtime", async () => {
    stubProductionBootEnv();
    for (const runtime of ["edge", ""]) {
      vi.stubEnv("NEXT_RUNTIME", runtime);
      await register({ exit, log });
    }

    expect(exit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(bootFailure()).toBeNull();
  });

  it("is a no-op in demo mode", async () => {
    stubProductionBootEnv();
    vi.stubEnv("JEEVES_MODE", "demo");
    await register({ exit, log });

    expect(exit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(bootFailure()).toBeNull();
  });

  it("can be called the way Next.js calls it, with no arguments", async () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    await expect(register()).resolves.toBeUndefined();
  });
});
