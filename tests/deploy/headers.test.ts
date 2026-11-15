import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

describe("next.config headers", () => {
  it("marks viewer-scoped JSON as private, no-store and varying on the credential", async () => {
    const rules = await nextConfig.headers!();
    for (const source of ["/api/:path*", "/initiatives/:slug/detail-data"]) {
      const rule = rules.find((r) => r.source === source);
      expect(rule, source).toBeDefined();
      const get = (key: string) => rule!.headers.find((h) => h.key === key)?.value;
      expect(get("Cache-Control")).toBe("private, no-store");
      expect(get("Vary")).toBe("Authorization, Cookie");
    }
  });
});
