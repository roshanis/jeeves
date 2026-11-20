// @vitest-environment node
// Guards workspace isolation on reads (db-F25): every DataProvider read in app
// code must pass the viewer's scope, because the provider returns EVERY
// workspace's rows when the argument is omitted. The compiler cannot enforce
// that yet (the parameter is optional; making it required is the first change
// after the two lines merge), so this scans the sources instead.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
/** Method name -> how many arguments a scoped call has (the scope is the last). */
const READ_METHODS: Record<string, number> = {
  listInitiatives: 1,
  listInitiativeIndex: 1,
  listInitiativeDetails: 1,
  getInitiativeDetail: 2,
  outcomeMetrics: 1,
  controlCatalog: 1,
  auditQuery: 2,
};

/** The provider implementations and their contract define the methods; they are not callers. */
const SKIP_FILES = new Set(["lib/data/provider.ts", "lib/data/db-provider.ts", "lib/data/mock-provider.ts"]);
/**
 * Explicit allow-list of legitimate unscoped internal callers (file -> reason).
 * Empty today: all current call sites pass `{ viewerWorkspaceId }`. Add an entry
 * here, with a reason, rather than weakening the scan.
 */
const UNSCOPED_ALLOW_LIST: Record<string, string> = {};

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

/** Top-level argument count and text of a call whose "(" is at `open`. */
function callArguments(src: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = open; i < src.length; i++) {
    const ch = src[i]!;
    if ("([{".includes(ch)) {
      depth += 1;
      if (depth === 1) continue;
    } else if (")]}".includes(ch)) {
      depth -= 1;
      if (depth === 0) {
        if (current.trim()) args.push(current.trim());
        return args;
      }
    } else if (ch === "," && depth === 1) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  return args;
}

function unscopedCalls(src: string): { method: string; line: number }[] {
  const found: { method: string; line: number }[] = [];
  const pattern = new RegExp(`\\.(${Object.keys(READ_METHODS).join("|")})\\s*\\(`, "g");
  for (const match of src.matchAll(pattern)) {
    const method = match[1]!;
    const args = callArguments(src, match.index! + match[0].length - 1);
    const scope = args[READ_METHODS[method]! - 1];
    const missing = scope === undefined || scope === "undefined" || /^\{\s*\}$/.test(scope);
    if (missing) found.push({ method, line: src.slice(0, match.index).split("\n").length });
  }
  return found;
}

describe("DataProvider reads always pass a workspace scope", () => {
  const files = ["app", "components", "lib"].flatMap((d) => sourceFiles(join(ROOT, d)));

  it("scans the source tree (guards against matching nothing)", () => {
    expect(files.length).toBeGreaterThan(50);
    const scoped = files.filter((f) => /\.(listInitiatives|auditQuery|controlCatalog)\s*\(/.test(readFileSync(f, "utf8")));
    expect(scoped.length).toBeGreaterThan(3);
  });

  it("finds an unscoped call and accepts a scoped one (the scan itself works)", () => {
    expect(unscopedCalls("await provider.listInitiatives();")).toHaveLength(1);
    expect(unscopedCalls("await provider.auditQuery(id);")).toHaveLength(1);
    expect(unscopedCalls("await provider.getInitiativeDetail(slug);")).toHaveLength(1);
    expect(unscopedCalls("await provider.listInitiatives({});")).toHaveLength(1);
    expect(unscopedCalls("await provider.listInitiatives({ viewerWorkspaceId });")).toHaveLength(0);
    expect(unscopedCalls("await provider.auditQuery(id, { viewerWorkspaceId })")).toHaveLength(0);
    expect(unscopedCalls("await p.getInitiativeDetail(slug,\n  { viewerWorkspaceId: null })")).toHaveLength(0);
    expect(unscopedCalls("provider.listInitiativeDetails(scope)")).toHaveLength(0);
  });

  it("has no unscoped call in app/, components/ or lib/", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.slice(ROOT.length + 1);
      if (SKIP_FILES.has(rel) || rel in UNSCOPED_ALLOW_LIST) continue;
      for (const hit of unscopedCalls(readFileSync(file, "utf8"))) offenders.push(`${rel}:${hit.line} ${hit.method}`);
    }
    expect(offenders, "pass { viewerWorkspaceId } (see lib/data/provider.ts), or allow-list with a reason").toEqual([]);
  });
});
