// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require_ = createRequire(import.meta.url);
const { findUnexpectedEntries } = require_("./check-standalone-output.cjs") as {
  findUnexpectedEntries: (paths: string[]) => string[];
};

describe("findUnexpectedEntries", () => {
  it("accepts the clean standalone listing", () => {
    expect(
      findUnexpectedEntries([
        "server.js",
        "package.json",
        ".next",
        ".next/server/x.js",
        "node_modules",
        "node_modules/next/package.json",
        "agents",
        "agents/reviewer/schema.md",
        "docs",
        "docs/policies",
        "docs/policies/INDEX.md",
      ]),
    ).toEqual([]);
  });

  it.each([
    "tests/x.test.ts",
    "scripts/seed.ts",
    "plan.md",
    "agents-build-log.md",
    "docs/deploy.md",
    "docs/policies/notes.txt",
    "agents/reviewer/notes.txt",
    "lib/x.ts",
    ".env",
  ])("rejects %s", (p) => {
    expect(findUnexpectedEntries([p])).toEqual([p]);
  });
});
