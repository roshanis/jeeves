// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * docs/environment-reference.md is the one table of every variable the code
 * reads. This fails when source starts reading a variable the table does not
 * list, so the document cannot drift quietly.
 */
const ROOT = path.resolve(__dirname, "../..");

const SOURCE_ROOTS = ["app", "lib", "agents", "scripts", "instrumentation.ts", "proxy.ts", "next.config.ts", "drizzle.config.ts"];

/** Read by the code but not configuration an operator sets for Jeeves. */
const NOT_CONFIGURATION = new Set([
  "HOME", "PATH", "TMPDIR", // ambient process environment
  "NEXT_PHASE", "NEXT_RUNTIME", // set by Next.js itself
  "SMOKE_DATABASE_URL", "SMOKE_DEMO_LOCKED", "SMOKE_PORT", "SMOKE_SERVER", // scripts/smoke-production.ts only
]);

const isSource = (file: string) => /\.(ts|tsx|cjs|mjs)$/.test(file) && !/\.test\.|__tests__/.test(file);

function sourceFiles(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) return statSync(abs, { throwIfNoEntry: false }) && isSource(rel) ? [abs] : [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(path.join(rel, e.name)) : isSource(e.name) ? [path.join(abs, e.name)] : [],
  );
}

function variablesRead(): string[] {
  const names = new Set<string>();
  for (const file of SOURCE_ROOTS.flatMap(sourceFiles)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\benv(?:\.|\[["'])([A-Z][A-Z0-9_]+)/g)) names.add(m[1]!);
  }
  return [...names].filter((n) => !NOT_CONFIGURATION.has(n)).sort();
}

describe("docs/environment-reference.md", () => {
  const doc = readFileSync(path.join(ROOT, "docs/environment-reference.md"), "utf8");

  it("finds the variables (guards the scanner itself)", () => {
    const names = variablesRead();
    expect(names).toEqual(expect.arrayContaining(["JEEVES_MODE", "DATABASE_URL", "OPERATOR_TOKEN", "JEEVES_TRUSTED_PROXY_HOPS"]));
    expect(names.length).toBeGreaterThanOrEqual(25);
  });

  it("lists every variable the source reads", () => {
    const missing = variablesRead().filter((n) => !doc.includes(`\`${n}\``));
    expect(missing).toEqual([]);
  });

  it("is linked from the README and the deploy guides", () => {
    for (const rel of ["README.md", "docs/deploy.md", "docs/deploy-podman.md"]) {
      expect(readFileSync(path.join(ROOT, rel), "utf8"), rel).toContain("environment-reference.md");
    }
  });
});
