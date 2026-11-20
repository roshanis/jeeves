// @vitest-environment node
/**
 * AGENTS.md is the single source for project facts; the project section of
 * .claude/CLAUDE.md only mirrors the commands and the hard rules. This fails
 * when either file names a command package.json does not have, or when
 * CLAUDE.md grows its own copy of facts that can drift (docs-F22, d16).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const scripts = new Set(Object.keys(JSON.parse(read("package.json")).scripts as Record<string, string>));
const claude = read(".claude/CLAUDE.md");
const agents = read("AGENTS.md");

/** Script names a file tells the reader to run with npm. */
function npmCommands(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/\bnpm run ([A-Za-z0-9:_-]+)/g)) names.add(m[1]!);
  for (const m of text.matchAll(/\bnpm (test|start)\b/g)) names.add(m[1]!);
  return [...names];
}

describe(".claude/CLAUDE.md and AGENTS.md commands", () => {
  it("never mention pnpm, which this repository does not use", () => {
    expect(claude).not.toMatch(/pnpm/i);
    expect(agents).not.toMatch(/pnpm/i);
  });

  for (const [name, text] of [[".claude/CLAUDE.md", claude], ["AGENTS.md", agents]] as const) {
    it(`${name} names only scripts that exist in package.json`, () => {
      const named = npmCommands(text);
      expect(named.length).toBeGreaterThan(0);
      expect(named.filter((c) => !scripts.has(c))).toEqual([]);
    });
  }

  it("CLAUDE.md mirrors the commands AGENTS.md lists", () => {
    const inAgents = npmCommands(agents).filter((c) => ["test", "test:e2e", "lint", "typecheck", "db:migrate", "test:postgres"].includes(c));
    expect(inAgents.length).toBeGreaterThanOrEqual(4);
    for (const c of inAgents) expect(npmCommands(claude), c).toContain(c);
  });
});

describe(".claude/CLAUDE.md project section", () => {
  const project = claude.slice(claude.indexOf("## Project Overrides"));

  it("points to AGENTS.md as the source", () => {
    expect(project).toMatch(/AGENTS\.md/);
    expect(project).toMatch(/single source|source of truth/i);
  });

  it("does not repeat statements that were false", () => {
    expect(project).not.toMatch(/Workflow SDK/);
    expect(project).not.toMatch(/eve agents-as-directories/);
    expect(project).not.toMatch(/no Docker/i);
    expect(project).not.toMatch(/Neon Postgres \+ Drizzle/);
  });

  it("stays under 200 lines in total", () => {
    expect(claude.split("\n").length).toBeLessThan(200);
  });
});

describe("AGENTS.md project facts", () => {
  it("states the two deployment modes and the production rules", () => {
    expect(agents).toMatch(/JEEVES_MODE/);
    expect(agents).toMatch(/defaults? to production/i);
    expect(agents).toMatch(/demoDoorClosed/);
    expect(agents).toMatch(/boot check/i);
    expect(agents).toMatch(/installation stamp/i);
  });

  it("flags db:seed and reset:demo as destructive and demo-only", () => {
    const line = agents.split("\n").find((l) => /db:seed/.test(l) && /reset:demo/.test(l)) ?? "";
    expect(line).toMatch(/destructive/i);
    expect(line).toMatch(/demo/i);
  });

  it("does not describe the stack as it was before the code moved on", () => {
    expect(agents).not.toMatch(/Neon Postgres \+ Drizzle ORM \(one dev branch/);
    expect(agents).not.toMatch(/no Docker/i);
  });
});
