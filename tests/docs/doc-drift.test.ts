// @vitest-environment node
import { readFileSync } from "node:fs";
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
