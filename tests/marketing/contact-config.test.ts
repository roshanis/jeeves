// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPublicDemoContact, contactLink, privacyMailto } from "@/lib/marketing/contact";

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" || name === ".next" ? [] : sourceFiles(full);
    return /\.(ts|tsx|md|mdx|json)$/.test(name) ? [full] : [];
  });
}

describe("no personal contact address in the source", () => {
  it("has no hard-coded gmail address in app/, components/ or lib/", () => {
    const needle = ["@gmail", "com"].join(".");
    const hits = ["app", "components", "lib"]
      .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
      .filter((file) => readFileSync(file, "utf8").toLowerCase().includes(needle));
    expect(hits.map((file) => path.relative(ROOT, file))).toEqual([]);
  });
});

describe("contactLink", () => {
  it.each(["mailto:hello@acme.example", "https://cal.example/intro", "http://cal.example/intro"])("accepts %s", (value) => {
    expect(contactLink(value)).toBe(value);
  });
  it.each([undefined, "", "   ", "hello@acme.example", "javascript:alert(1)", "ftp://x.example", "mailto:", "https://"])(
    "is null for %j",
    (value) => expect(contactLink(value)).toBeNull(),
  );
  it("trims", () => expect(contactLink("  mailto:hello@acme.example ")).toBe("mailto:hello@acme.example"));
});

describe("privacyMailto", () => {
  it("accepts only a mailto address", () => {
    expect(privacyMailto("mailto:privacy@acme.example")).toBe("mailto:privacy@acme.example");
    for (const value of [undefined, "", "https://cal.example/intro", "privacy@acme.example", "mailto:", "mailto:no-at-sign"]) {
      expect(privacyMailto(value), String(value)).toBeNull();
    }
  });
});

describe("demo build contact check", () => {
  const demoOnVercel = { JEEVES_MODE: "demo", VERCEL_ENV: "production" };

  it.each([undefined, "", "https://cal.example/intro", "not-an-address"])(
    "refuses a public demo build whose NEXT_PUBLIC_PRIVACY_CONTACT is %j, naming the variable",
    (value) => {
      expect(() => assertPublicDemoContact({ ...demoOnVercel, NEXT_PUBLIC_PRIVACY_CONTACT: value })).toThrow(
        /NEXT_PUBLIC_PRIVACY_CONTACT.*mailto:/,
      );
    },
  );

  it("accepts a mailto privacy contact", () => {
    expect(() => assertPublicDemoContact({ ...demoOnVercel, NEXT_PUBLIC_PRIVACY_CONTACT: "mailto:privacy@acme.example" })).not.toThrow();
  });

  it("does not apply to a production-mode build, a locked build, or a build that is not the Vercel production deploy", () => {
    expect(() => assertPublicDemoContact({ VERCEL_ENV: "production" })).not.toThrow();
    expect(() => assertPublicDemoContact({ ...demoOnVercel, JEEVES_DEMO_ENABLED: "0" })).not.toThrow();
    expect(() => assertPublicDemoContact({ JEEVES_MODE: "demo" })).not.toThrow();
    expect(() => assertPublicDemoContact({ JEEVES_MODE: "demo", VERCEL_ENV: "preview" })).not.toThrow();
  });
});

describe("next.config runs the check", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("fails the build for a Vercel production demo build without a privacy mailto", async () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_PRIVACY_CONTACT", "");
    vi.resetModules();
    await expect(import("../../next.config")).rejects.toThrow(/NEXT_PUBLIC_PRIVACY_CONTACT/);
  });
});
