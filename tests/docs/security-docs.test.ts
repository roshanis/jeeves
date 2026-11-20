// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("SECURITY.md (docs-F39, L25)", () => {
  it("exists and says how to report privately", () => {
    expect(existsSync("SECURITY.md")).toBe(true);
    const doc = read("SECURITY.md");
    expect(doc).toMatch(/Report a vulnerability/);
    expect(doc).toMatch(/private/i);
  });
  it("names main as the only supported branch", () => {
    expect(read("SECURITY.md")).toMatch(/`main`[^.]*only supported/i);
  });
  it("does not claim the demo holds synthetic data only: real requests are stored", () => {
    const doc = read("SECURITY.md");
    expect(doc).not.toMatch(/synthetic data only/i);
    expect(doc).toMatch(/fictional/i);
    expect(doc).toMatch(/real request/i);
    expect(doc).toMatch(/e-?mail address/i);
  });
  it("points to the security model", () => {
    expect(read("SECURITY.md")).toContain("docs/security-model.md");
  });
});

describe("docs/security-model.md (docs-F39, L25)", () => {
  const doc = existsSync("docs/security-model.md") ? read("docs/security-model.md") : "";
  const guard = read("lib/services/route-guard.ts");

  it("exists and is linked from the README docs list", () => {
    expect(doc.length).toBeGreaterThan(0);
    expect(read("README.md")).toContain("docs/security-model.md");
  });

  it("covers each trust boundary", () => {
    for (const heading of [/public pages/i, /playground/i, /real-request door/i, /\/operator/, /CRON_SECRET/, /production mode/i]) {
      expect(doc).toMatch(heading);
    }
  });

  it("points to the data inventory in deploy.md instead of repeating it", () => {
    expect(doc).toContain("docs/deploy.md");
    expect(doc).toMatch(/Personal data/);
  });

  it("describes the audit log as trigger-enforced with the owner-role caveat", () => {
    expect(doc).toMatch(/trigger/i);
    expect(doc).toMatch(/owner/i);
    expect(doc).toMatch(/non-owner role/i);
    expect(doc).not.toMatch(/revoked privileges/i);
  });

  it("states the limits the code enforces", () => {
    // Token bucket sizes in lib/services/route-guard.ts, in source order:
    // mutation, session entry, public session, persona switch, operator attempts.
    const caps = [...guard.matchAll(/capacity: (\d+), refillPerSecond: ([^}\s]+)/g)].map((m) => ({ capacity: m[1]!, refill: m[2]! }));
    expect(caps.length).toBe(5);
    for (const { capacity } of caps) expect(doc).toContain(`capacity ${capacity}`);
    const cap = read("lib/security/budget.ts").match(/DAILY_TOKEN_CAP = ([\d_]+)/)![1]!.replace(/_/g, "");
    expect(doc).toContain(Number(cap).toLocaleString("en-US"));
    const min = guard.match(/OPERATOR_TOKEN_MIN_LENGTH = (\d+)/)![1]!;
    expect(doc).toContain(`OPERATOR_TOKEN`);
    expect(doc).toMatch(new RegExp(`${min}\\+? characters`));
    expect(doc).toMatch(/1 hour/);
    expect(doc).toMatch(/30 minutes/);
  });

  it("says what is out of scope", () => {
    expect(doc).toMatch(/out of scope/i);
  });
});
