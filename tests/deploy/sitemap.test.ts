import { describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";

describe("sitemap lastModified", () => {
  it("is stable across calls instead of the request time", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
      const a = sitemap().map((r) => r.lastModified);
      vi.setSystemTime(new Date("2030-06-01T00:00:00Z"));
      const b = sitemap().map((r) => r.lastModified);
      expect(b).toEqual(a);
    } finally {
      vi.useRealTimers();
    }
  });
});
