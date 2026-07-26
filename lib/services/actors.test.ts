import { describe, expect, it } from "vitest";
import { actorMatches, actorName, displayNameFor, isPersonaKey } from "./actors";

/**
 * Review finding 8: `initiative-service.ts`'s `decide()` writes the stable
 * persona id ("angela-torres") into `initiative_decisions.approver`, while
 * the fast-lane path and scripts/seed.ts write the display name ("Angela
 * Torres"). actorMatches()/displayNameFor() bridge both forms so canned
 * audit queries (lib/data/db-provider.ts, lib/data/mock-provider.ts) don't
 * silently drop or mis-render live decisions. See lib/data/db-provider.test.ts
 * for the end-to-end DB-backed regression test.
 */
describe("lib/services/actors — actorMatches", () => {
  it("matches the stable persona id", () => {
    expect(actorMatches("angela-torres", "angela-torres")).toBe(true);
  });

  it("matches the display name", () => {
    expect(actorMatches("Angela Torres", "angela-torres")).toBe(true);
  });

  it("does not match a different persona's id or name", () => {
    expect(actorMatches("priya-raman", "angela-torres")).toBe(false);
    expect(actorMatches("Priya Raman", "angela-torres")).toBe(false);
  });

  it("returns false for null/undefined/empty stored values", () => {
    expect(actorMatches(null, "angela-torres")).toBe(false);
    expect(actorMatches(undefined, "angela-torres")).toBe(false);
    expect(actorMatches("", "angela-torres")).toBe(false);
  });
});

describe("lib/services/actors — displayNameFor", () => {
  it("resolves a persona id to its display name", () => {
    expect(displayNameFor("angela-torres")).toBe("Angela Torres");
  });

  it("leaves an already-resolved display name unchanged", () => {
    expect(displayNameFor("Angela Torres")).toBe("Angela Torres");
  });

  it("leaves unknown values (e.g. the system pseudo-actor) unchanged", () => {
    expect(displayNameFor("system")).toBe("system");
  });
});

// Sanity check that actorName/isPersonaKey (pre-existing exports) still
// agree with the new helpers on the same directory entries.
describe("lib/services/actors — actorName/isPersonaKey (pre-existing)", () => {
  it("isPersonaKey + actorName agree with displayNameFor for a known persona", () => {
    expect(isPersonaKey("angela-torres")).toBe(true);
    expect(actorName("angela-torres")).toBe(displayNameFor("angela-torres"));
  });
});
