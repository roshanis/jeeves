/**
 * Inventory of the mutation gate. AGENTS.md: `runMutationGuard` denies the
 * `public` role by default and exactly three routes opt in with
 * `allowPublic: true` (create initiative, edit intake draft, submit intake).
 * Nothing else may open a mutating route to the real-request door, and every
 * mutating handler must go through the guard (or be a documented door).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : name === "route.ts" ? [full] : [];
  });
}

const routes = walk(join(ROOT, "api")).map((file) => ({
  path: relative(join(ROOT, ".."), file).split("\\").join("/"),
  source: readFileSync(file, "utf8"),
}));

const MUTATING = /export\s+(?:async\s+function|const)\s+(POST|PUT|PATCH|DELETE)\b/g;

/** Source of one exported handler: from its declaration to the next top-level export. */
function handlerBodies(source: string): { method: string; body: string }[] {
  const starts = [...source.matchAll(MUTATING)];
  return starts.map((m) => {
    const from = m.index!;
    const next = source.slice(from + 1).search(/\nexport\s/);
    return { method: m[1]!, body: next === -1 ? source.slice(from) : source.slice(from, from + 1 + next) };
  });
}

/** Doors that mint or switch sessions: they cannot sit behind a session by definition. */
const NOT_GUARDED: Record<string, string> = {
  "POST app/api/session/route.ts": "persona door: issues the playground session, rate-limited per client",
  "POST app/api/public-session/route.ts": "real-request door: issues the public-role session, rate-limited per client",
};

describe("mutation gate inventory", () => {
  it("finds the mutating routes (guards the walker itself)", () => {
    const mutating = routes.filter((r) => handlerBodies(r.source).length > 0);
    expect(mutating.length).toBeGreaterThan(20);
  });

  it("every exported POST/PUT/PATCH/DELETE calls runMutationGuard unless it is a documented door", () => {
    const unguarded: string[] = [];
    for (const route of routes) {
      for (const { method, body } of handlerBodies(route.source)) {
        if (/\brunMutationGuard\(/.test(body)) continue;
        if (NOT_GUARDED[`${method} ${route.path}`]) continue;
        unguarded.push(`${method} ${route.path}`);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it("only the three intake routes pass allowPublic: true", () => {
    const opted = routes.filter((r) => /allowPublic:\s*true/.test(r.source)).map((r) => r.path).sort();
    expect(opted).toEqual([
      "app/api/initiatives/[id]/intake/route.ts",
      "app/api/initiatives/[id]/submit/route.ts",
      "app/api/initiatives/route.ts",
    ]);
  });

  it("allowPublic appears once in each of those routes, on the guard call", () => {
    for (const path of [
      "app/api/initiatives/route.ts",
      "app/api/initiatives/[id]/submit/route.ts",
      "app/api/initiatives/[id]/intake/route.ts",
    ]) {
      const source = routes.find((r) => r.path === path)!.source;
      expect(source.match(/allowPublic/g)).toHaveLength(1);
      expect(source).toMatch(/runMutationGuard\([^)]*,\s*\{\s*allowPublic:\s*true\s*\}\)/);
    }
  });
});
