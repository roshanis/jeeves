// Integrity tripwire for lib/marketing/framework-mappings.ts: the marketing
// crosswalk pages (/frameworks/*) advertise the demo's real control catalog,
// so this test asserts CONTROL_FRAMEWORK_MAPPINGS can never drift from
// scripts/seed.ts CONTROL_SEEDS — no missing control, no invented one, no
// stale name, and every framework reference/evidence string is non-empty
// (see lib/marketing/framework-mappings.ts's own header comment).
import { describe, expect, it } from "vitest";
import { CONTROL_SEEDS } from "@/scripts/seed";
import { CONTROL_FRAMEWORK_MAPPINGS, FRAMEWORK_PAGES } from "@/lib/marketing/framework-mappings";

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

  // L-02 (marketing-claims review) had only an Art. 50 mapping, which was
  // wrong (Art. 50 is about telling people they interact with AI and labelling
  // synthetic content), and no other article is evidenced by it.
  const NO_EU_MAPPING = new Set(["L-02"]);

  it("every mapping has at least one NIST AI RMF ref and one EU AI Act ref, each with non-empty ref+label", () => {
    for (const mapping of CONTROL_FRAMEWORK_MAPPINGS) {
      expect(
        mapping.nistAiRmf.length,
        `${mapping.controlId} has no nistAiRmf refs`,
      ).toBeGreaterThan(0);
      if (!NO_EU_MAPPING.has(mapping.controlId)) {
        expect(
          mapping.euAiAct.length,
          `${mapping.controlId} has no euAiAct refs`,
        ).toBeGreaterThan(0);
      }

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

describe("what the crosswalk pages claim (ui-public-F7)", () => {
  const eu = FRAMEWORK_PAGES.find((p) => p.slug === "eu-ai-act")!;
  const euRefs = new Set(CONTROL_FRAMEWORK_MAPPINGS.flatMap((m) => m.euAiAct.map((r) => r.ref)));

  /** Article numbers named in the intro; "Arts. 72–73" names both ends. */
  function articlesIn(text: string): string[] {
    const out: string[] = [];
    for (const m of text.matchAll(/Arts?\. (\d+)(?:[–-](\d+))?/g)) {
      out.push(`Art. ${m[1]}`);
      if (m[2]) out.push(`Art. ${m[2]}`);
    }
    return out;
  }

  it("every article the EU intro names appears in the crosswalk table", () => {
    const named = articlesIn(eu.intro);
    expect(named.length).toBeGreaterThan(0);
    const missing = named.filter((a) => !euRefs.has(a));
    expect(missing).toEqual([]);
  });

  it("does not claim Art. 9 or Art. 12, which no control evidences", () => {
    expect(eu.intro).not.toMatch(/Art\. (9|12)\b/);
    expect(eu.intro).not.toMatch(/risk management system|record-keeping/i);
    expect(eu.summary).not.toMatch(/risk management system|record-keeping/i);
    expect(euRefs.has("Art. 9")).toBe(false);
    expect(euRefs.has("Art. 12")).toBe(false);
  });

  it("cites GOVERN 3.2 for C-01, not the GOVERN 3 workforce-diversity category", () => {
    const c01 = CONTROL_FRAMEWORK_MAPPINGS.find((m) => m.controlId === "C-01")!;
    expect(c01.nistAiRmf.map((r) => r.ref)).toContain("GOVERN 3.2");
    expect(c01.nistAiRmf.map((r) => r.ref)).not.toContain("GOVERN 3");
  });

  it("does not map the marketing-claims review (L-02) to Art. 50", () => {
    const l02 = CONTROL_FRAMEWORK_MAPPINGS.find((m) => m.controlId === "L-02")!;
    expect(l02.euAiAct.map((r) => r.ref)).not.toContain("Art. 50");
    expect(euRefs.has("Art. 50")).toBe(false);
  });
});
