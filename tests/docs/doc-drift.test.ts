// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("README claims about .env.example (docs-F13)", () => {
  it("does not call .env.example the full variable list", () => {
    expect(read("README.md")).not.toMatch(/full variable list/i);
  });
});

describe("docs/production-readiness.md (docs-F16)", () => {
  const doc = read("docs/production-readiness.md");
  it("mentions the passcode only to say it is gone", () => {
    const stale = doc.split("\n").filter((l) => /passcode/i.test(l) && !/no passcode|former|retired|removed/i.test(l));
    expect(stale).toEqual([]);
  });
  it("hard-codes no test or migration counts", () => {
    expect(doc).not.toMatch(/\b\d+ (unit tests|migrations)\b/);
  });
  it("does not point at a public/ directory that does not exist", () => {
    expect(doc).not.toMatch(/`public\/` still holds/);
  });
});

describe("docs/ARCHITECTURE.md (docs-F17)", () => {
  const doc = read("docs/ARCHITECTURE.md");
  it("cites only lib/ and app/ paths that exist", () => {
    const paths = [...doc.matchAll(/`((?:lib|app)\/[A-Za-z0-9_./\[\]()@-]+?)`/g)].map((m) => m[1]).filter((p) => !p.includes("*"));
    const missing = [...new Set(paths)].filter((p) => !existsSync(p.replace(/\/$/, "")));
    expect(missing).toEqual([]);
  });
  it("does not say rate limiting is in-memory or per-instance", () => {
    expect(doc).not.toMatch(/rate limiting (remains|is) in-memory/i);
  });
  it("does not name symbols that no longer exist", () => {
    expect(doc).not.toMatch(/runWithConcurrencyLimit|draftWithRetry|DEMO_PASSCODE/);
  });
  it("counts thirteen lifecycle states, not twelve", () => {
    expect(doc).not.toMatch(/twelve[- ]state/i);
  });
});

describe("the QC gate is documented (docs-F18)", () => {
  it("demo-script.md has a QC step run by the Program Office persona", () => {
    const doc = read("docs/demo-script.md");
    expect(doc).toMatch(/QC/);
    expect(doc).toMatch(/Nia Okafor/);
  });
  it("README.md describes QC between intake and triage", () => {
    expect(read("README.md")).toMatch(/\bQC\b/);
  });
  it("deploy.md champion loop includes QC and drafts 8 reviews", () => {
    const doc = read("docs/deploy.md");
    expect(doc).toMatch(/\bQC\b/);
    expect(doc).not.toMatch(/4 drafted reviews/);
  });
  it("ARCHITECTURE.md describes the QC gate", () => {
    expect(read("docs/ARCHITECTURE.md")).toMatch(/QC gate/);
  });
});

describe("audit-log protection claims match the migrations (docs-F21)", () => {
  const migrations = readdirSync("drizzle").filter((f) => f.endsWith(".sql")).map((f) => read(`drizzle/${f}`)).join("\n");
  it("README does not claim revoked privileges unless a migration revokes them", () => {
    if (!/^\s*REVOKE\s/im.test(migrations)) expect(read("README.md")).not.toMatch(/revoked privileges/i);
  });
  it("production-readiness lists the owner/runtime role split as a prerequisite", () => {
    const doc = read("docs/production-readiness.md");
    expect(doc).toMatch(/runtime role/i);
    expect(doc).not.toMatch(/regardless of which role issues the\s+statement/);
  });
});

describe("data disclaimers cover the real-request door (docs-F23)", () => {
  it("README does not claim no real PII anywhere", () => {
    expect(read("README.md")).not.toMatch(/No real PHI, PII, or production data is used/);
  });
  it("deploy.md does not claim all data is synthetic and names the contact data", () => {
    const doc = read("docs/deploy.md");
    expect(doc).not.toMatch(/all data is synthetic/);
    expect(doc).not.toMatch(/everything is synthetic, so it is\s+moot/);
    expect(doc).toMatch(/real-request door/i);
  });
  it("ARCHITECTURE.md qualifies the no-real-data claim", () => {
    expect(read("docs/ARCHITECTURE.md")).not.toMatch(/no real PHI,\s+PII, or production data exists anywhere/);
  });
});
