import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : routeFiles(p);
    return name === "route.ts" ? [p] : [];
  });
}

describe("guard failure responses", () => {
  it("no route builds a guard failure response by hand (it would drop Retry-After, retryAfterSeconds and gaps)", () => {
    const offenders = routeFiles(join(process.cwd(), "app/api")).filter((f) => /failure\.message/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
