import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

// Next applies every matching rule, and a later rule replaces an earlier value
// for the same key, so a specific rule listed after the catch-all wins.
async function effectiveHeader(path: string, key: string): Promise<string | undefined> {
  // @ts-expect-error Next ships this compiled module without types.
  const { match } = await import("next/dist/compiled/path-to-regexp");
  let value: string | undefined;
  for (const rule of await nextConfig.headers!()) {
    if (!match(rule.source)(path)) continue;
    for (const h of rule.headers) if (h.key === key) value = h.value;
  }
  return value;
}

describe("next.config headers", () => {
  it("keeps the sandbox CSP on the evidence download instead of the app-wide policy", async () => {
    // An uploaded file is untrusted bytes: a PDF whose body is HTML must not run script.
    expect(await effectiveHeader("/api/initiatives/init-1/evidence/doc-1", "Content-Security-Policy")).toBe("sandbox; default-src 'none'");
    expect(await effectiveHeader("/api/initiatives/init-1/evidence", "Content-Security-Policy")).toContain("script-src");
    expect(await effectiveHeader("/inbox", "Content-Security-Policy")).toContain("script-src");
  });

  it("gives every /api response private, no-store and Vary on the credentials, and a page neither", async () => {
    expect(await effectiveHeader("/api/exceptions", "Cache-Control")).toBe("private, no-store");
    expect(await effectiveHeader("/api/initiatives/init-1/intake", "Vary")).toBe("Authorization, Cookie");
    expect(await effectiveHeader("/dashboard", "Cache-Control")).toBeUndefined();
  });

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
