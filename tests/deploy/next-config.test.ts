import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

describe("next.config output tracing", () => {
  it("keeps sharp and the libvips binaries out of the traced runtime (images are unoptimized)", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
    expect(nextConfig.outputFileTracingExcludes?.["*"]).toEqual(
      expect.arrayContaining(["node_modules/sharp/**", "node_modules/@img/**"]),
    );
  });
});
