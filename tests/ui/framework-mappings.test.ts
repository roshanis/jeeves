// Integrity tripwire for lib/marketing/framework-mappings.ts: the marketing
// crosswalk pages (/frameworks/*) advertise the demo's real control catalog,
// so this test asserts CONTROL_FRAMEWORK_MAPPINGS can never drift from
// scripts/seed.ts CONTROL_SEEDS — no missing control, no invented one, no
// stale name, and every framework reference/evidence string is non-empty
// (see lib/marketing/framework-mappings.ts's own header comment).
import { describe, expect, it } from "vitest";
import { CONTROL_SEEDS } from "@/scripts/seed";
import { CONTROL_FRAMEWORK_MAPPINGS } from "@/lib/marketing/framework-mappings";

describe("CONTROL_FRAMEWORK_MAPPINGS integrity", () => {
  const seedIds = new Set(CONTROL_SEEDS.map((c) => c.id));
  const mappingIds = new Set(CONTROL_FRAMEWORK_MAPPINGS.map((m) => m.controlId));

  it("covers exactly the CONTROL_SEEDS ids — no missing control", () => {
    const missing = [...seedIds].filter((id) => !mappingIds.has(id));
    expect(missing).toEqual([]);
  });

  it("covers exactly the CONTROL_SEEDS ids — no extra/invented control", () => {
    const extra = [...mappingIds].filter((id) => !seedIds.has(id));
    expect(extra).toEqual([]);
  });

  it("has no duplicate controlId entries", () => {
    expect(mappingIds.size).toBe(CONTROL_FRAMEWORK_MAPPINGS.length);
  });

  it("each mapping's controlName matches the seed catalog's name", () => {
    const seedById = new Map(CONTROL_SEEDS.map((c) => [c.id, c]));
    for (const mapping of CONTROL_FRAMEWORK_MAPPINGS) {
      const seed = seedById.get(mapping.controlId);
      expect(seed, `no seed found for ${mapping.controlId}`).toBeDefined();
      expect(mapping.controlName).toBe(seed!.name);
    }
  });

  it("every mapping has at least one NIST AI RMF ref and one EU AI Act ref, each with non-empty ref+label", () => {
    for (const mapping of CONTROL_FRAMEWORK_MAPPINGS) {
      expect(
        mapping.nistAiRmf.length,
        `${mapping.controlId} has no nistAiRmf refs`,
      ).toBeGreaterThan(0);
      expect(
        mapping.euAiAct.length,
        `${mapping.controlId} has no euAiAct refs`,
      ).toBeGreaterThan(0);

      for (const ref of [...mapping.nistAiRmf, ...mapping.euAiAct]) {
        expect(ref.ref.trim().length, `${mapping.controlId} has an empty ref`).toBeGreaterThan(0);
        expect(ref.label.trim().length, `${mapping.controlId} has an empty label`).toBeGreaterThan(0);
      }
    }
  });

  it("every mapping has a non-empty evidence string", () => {
    for (const mapping of CONTROL_FRAMEWORK_MAPPINGS) {
      expect(
        mapping.evidence.trim().length,
        `${mapping.controlId} has empty evidence`,
      ).toBeGreaterThan(0);
    }
  });
});
