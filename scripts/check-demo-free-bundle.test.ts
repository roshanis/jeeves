// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require_ = createRequire(import.meta.url);
const { forbiddenStrings, findLeaks } = require_("./check-demo-free-bundle.cjs") as {
  forbiddenStrings: (personasSource: string) => string[];
  findLeaks: (files: Record<string, string>, forbidden: string[]) => { file: string; found: string[] }[];
};

const PERSONAS_SOURCE = `export const DEMO_PERSONAS = [
  { id: "priya-raman", name: "Priya Raman", role: "requester", reviewDomain: null },
  { id: "elena-vasquez", name: "Dr. Elena Vasquez", role: "reviewer", reviewDomain: "clinical-safety" },
] as const;`;

describe("forbiddenStrings", () => {
  it("is the company name plus every persona id and name read from the roster source", () => {
    expect(forbiddenStrings(PERSONAS_SOURCE).sort()).toEqual(
      ["Dr. Elena Vasquez", "Meridian", "elena-vasquez", "priya-raman", "Priya Raman"].sort(),
    );
  });

  it("refuses a roster source it cannot read, so the check cannot pass vacuously", () => {
    expect(() => forbiddenStrings("export const X = 1;")).toThrow(/no persona/i);
  });
});

describe("findLeaks", () => {
  it("names each file and each forbidden string found in it", () => {
    const leaks = findLeaks({ "a.js": "x Priya Raman y Meridian", "b.js": "clean" }, ["Meridian", "Priya Raman", "Ray Chen"]);
    expect(leaks).toEqual([{ file: "a.js", found: ["Meridian", "Priya Raman"] }]);
  });
});

describe("command line", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  function staticDir(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "demo-free-"));
    dirs.push(root);
    for (const [rel, text] of Object.entries(files)) {
      const abs = join(root, "static", rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    }
    return join(root, "static");
  }
  const run = (dir: string) => spawnSync(process.execPath, [join(__dirname, "check-demo-free-bundle.cjs"), dir], { encoding: "utf8" });

  it("passes a clean static directory", () => {
    const result = run(staticDir({ "chunks/a.js": "console.log('hello')" }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OK");
  });

  it("fails and names the leaking chunk", () => {
    const result = run(staticDir({ "chunks/a.js": "label:'Meridian Health'", "chunks/b.js": "ok" }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("chunks/a.js");
    expect(result.stderr).toContain("Meridian");
  });

  it("fails when the directory is missing", () => {
    expect(run(join(tmpdir(), "no-such-static-dir")).status).toBe(1);
  });
});
