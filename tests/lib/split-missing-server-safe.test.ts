import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { splitMissing } from "@/lib/intake/split-missing";

describe("splitMissing (shared by a server and a client component)", () => {
  it("keeps every gap blocking for a flat seeded intake", () => {
    const intake = { fields: { a: 1 }, missing: ["dataRetention"] } as never;
    expect(splitMissing(intake)).toEqual({ blocking: ["dataRetention"], requiredForTier: [], optional: [] });
  });

  it("lives in a module without 'use client' and the server rail does not import the client tab", () => {
    expect(readFileSync("lib/intake/split-missing.ts", "utf8")).not.toMatch(/^["']use client["']/m);
    const rail = readFileSync("components/jeeves/initiative-blockers-rail.tsx", "utf8");
    expect(rail).not.toMatch(/from "\.\/intake-tab"/);
  });
});
