// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require_ = createRequire(import.meta.url);
const { findUnexpectedEntries, findMissingRequired, deriveRequired, assertRequiredDerivable } = require_("./check-standalone-output.cjs") as {
  assertRequiredDerivable: (required: string[]) => string[];
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
    "node_modules/sharp/package.json",
    "node_modules/@img/sharp-libvips-linux-x64/lib.so",
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

describe("assertRequiredDerivable", () => {
  it("names agents when the derived list has no agent file", () => {
    const problems = assertRequiredDerivable(["docs/policies/INDEX.md"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("agents/");
  });

  it("names the policies when the derived list has no policy file", () => {
    const problems = assertRequiredDerivable(["agents/reviewer/schema.md"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("docs/policies/");
  });

  it("reports nothing for the real repository", () => {
    expect(assertRequiredDerivable(deriveRequired(process.cwd()))).toEqual([]);
  });
});

describe("check-standalone-output CLI", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  function standaloneTree(extra: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), "jeeves-standalone-"));
    dirs.push(dir);
    for (const rel of ["server.js", "package.json", "node_modules/next/package.json", ...deriveRequired(process.cwd()), ...extra]) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), "x");
    }
    return dir;
  }
  const run = (dir: string) => spawnSync("node", ["scripts/check-standalone-output.cjs", dir], { encoding: "utf8" });

  it("passes a clean tree", () => {
    expect(run(standaloneTree([])).status).toBe(0);
  });

  it("fails and names node_modules/sharp when sharp ships", () => {
    const result = run(standaloneTree(["node_modules/sharp/package.json"]));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("node_modules/sharp");
  });

  it("fails and names node_modules/@img when libvips ships", () => {
    const result = run(standaloneTree(["node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so"]));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("node_modules/@img");
  });
});
