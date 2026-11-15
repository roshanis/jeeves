// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require_ = createRequire(import.meta.url);
const { findUnexpectedEntries, findMissingRequired, deriveRequired } = require_("./check-standalone-output.cjs") as {
  findUnexpectedEntries: (paths: string[]) => string[];
  findMissingRequired: (paths: string[], required: string[]) => string[];
  deriveRequired: (repoRoot: string) => string[];
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

describe("findMissingRequired", () => {
  const required = deriveRequired(process.cwd());

  it("derives the agent prompts, reviewer tracks and policy documents from the source tree", () => {
    expect(required).toEqual(
      expect.arrayContaining([
        "agents/reviewer/instructions.md",
        "agents/reviewer/schema.md",
        "agents/reviewer/tracks/legal.md",
        "agents/auditor/instructions.md",
        "docs/policies/INDEX.md",
        "docs/policies/legal.md",
        "docs/policies/fast-lane-policy.md",
      ]),
    );
    expect(required).not.toContain("agents/README.md");
  });

  it("reports a missing prompt and accepts a complete listing", () => {
    expect(findMissingRequired(required, required)).toEqual([]);
    const without = required.filter((p) => p !== "agents/reviewer/instructions.md");
    expect(findMissingRequired(without, required)).toEqual(["agents/reviewer/instructions.md"]);
    expect(findMissingRequired(["server.js"], required)).toEqual(required);
  });
});
