// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("historical documents (docs-F36, L37)", () => {
  it("GOAL.md and MORNING-REPORT.md live in docs/archive/, not where agents look for instructions", () => {
    expect(existsSync("GOAL.md")).toBe(false);
    expect(existsSync("docs/MORNING-REPORT.md")).toBe(false);
    expect(existsSync("docs/archive/GOAL.md")).toBe(true);
    expect(existsSync("docs/archive/MORNING-REPORT.md")).toBe(true);
  });

  it("each archived document opens with a historical banner", () => {
    for (const f of ["docs/archive/GOAL.md", "docs/archive/MORNING-REPORT.md"]) {
      expect(read(f).split("\n").slice(0, 4).join("\n"), f).toMatch(/Historical document, kept for the record; not current guidance/);
    }
  });

  it("ui-spec.md is marked as the M1 design record", () => {
    expect(read("docs/ui-spec.md").split("\n").slice(0, 6).join("\n")).toMatch(/M1 design record/);
  });

  it("no tracked file still points at the old locations", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
    const offenders: string[] = [];
    for (const f of files) {
      // The build log is an append-only record of what was true when each entry was written.
      if (f === "agents-build-log.md" || f.startsWith("docs/archive/") || f === "tests/docs/archived-docs.test.ts") continue;
      if (!existsSync(f) || /\.(png|jpg|ico|woff2?)$/.test(f)) continue;
      const text = read(f);
      if (/(^|[^/\w])GOAL\.md/.test(text) || /docs\/MORNING-REPORT\.md|(^|[^/\w])MORNING-REPORT\.md/.test(text)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
