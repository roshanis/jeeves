// @vitest-environment node
import { describe, expect, it } from "vitest";
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
});
