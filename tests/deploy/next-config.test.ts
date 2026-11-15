// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";

describe("next.config.ts", () => {
  // Next sends `X-Powered-By: Next.js` by default. It tells a scanner (and a
  // payer's security questionnaire) the framework for free and buys nothing.
  it("does not advertise the framework in an X-Powered-By header", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("still emits the baseline security headers on every route", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    const keys = all!.headers.map((h) => h.key);
    for (const key of ["Content-Security-Policy", "X-Frame-Options", "Strict-Transport-Security", "X-Content-Type-Options"]) {
      expect(keys).toContain(key);
    }
  });

  // Next applies every matching rule and a later one replaces an earlier value
  // for the same key, so a specific rule listed after the catch-all wins.
  async function effectiveHeader(path: string, key: string): Promise<string | undefined> {
    const { match } = await import("next/dist/compiled/path-to-regexp");
    let value: string | undefined;
    for (const rule of await nextConfig.headers!()) {
      if (!match(rule.source)(path)) continue;
      for (const h of rule.headers) if (h.key === key) value = h.value;
    }
    return value;
  }

  it("marks every /api response private and uncacheable, varying on credentials", async () => {
    expect(await effectiveHeader("/api/exceptions", "Cache-Control")).toBe("private, no-store");
    expect(await effectiveHeader("/api/initiatives/init-1/intake", "Vary")).toBe("Authorization, Cookie");
    expect(await effectiveHeader("/dashboard", "Cache-Control")).toBeUndefined();
  });

  // lib/config/deployment-mode.ts reads process.env.JEEVES_DEMO_ENABLED, which
  // is only a build-time constant if next.config.ts inlines it through `env`.
  // The default must be "1": a plain build (Vercel, the e2e build, a local
  // build) stays demo-capable, and only the production image build sets "0".
  describe("JEEVES_DEMO_ENABLED build constant", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    async function loadConfig() {
      vi.resetModules();
      return (await import("../../next.config")).default;
    }

    it("is inlined and defaults to '1'", async () => {
      vi.stubEnv("JEEVES_DEMO_ENABLED", undefined);
      expect((await loadConfig()).env).toEqual({ JEEVES_DEMO_ENABLED: "1" });
    });

    it("carries an explicit '0' through, so a production build can lock demo out", async () => {
      vi.stubEnv("JEEVES_DEMO_ENABLED", "0");
      expect((await loadConfig()).env).toEqual({ JEEVES_DEMO_ENABLED: "0" });
    });

    it.each(["false", "no", "off", ""])("refuses to build with the unrecognised value %j", async (value) => {
      vi.stubEnv("JEEVES_DEMO_ENABLED", value);
      await expect(loadConfig()).rejects.toThrow(/JEEVES_DEMO_ENABLED/);
    });

    it("never exposes the deployment mode itself to the browser bundle", async () => {
      const env = (await loadConfig()).env ?? {};
      expect(Object.keys(env).filter((key) => key.startsWith("NEXT_PUBLIC_"))).toEqual([]);
      expect(env).not.toHaveProperty("JEEVES_MODE");
    });
  });
});
