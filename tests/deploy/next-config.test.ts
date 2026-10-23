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

    it("never exposes the deployment mode itself to the browser bundle", async () => {
      const env = (await loadConfig()).env ?? {};
      expect(Object.keys(env).filter((key) => key.startsWith("NEXT_PUBLIC_"))).toEqual([]);
      expect(env).not.toHaveProperty("JEEVES_MODE");
    });
  });
});
