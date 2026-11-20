import { describe, expect, it } from "vitest";
import { isClosedUnsigned, sortReviewQueue } from "./queue-order";

type Status = "pending" | "drafted" | "signed" | "returned" | "abstained";
const row = (slug: string, status: Status, cycleOpen?: boolean) => ({ slug, review: { status, cycleOpen } });

describe("review queue order (L30)", () => {
  it("a drafted, pending or returned review of a closed cycle is closed-unsigned; signed and abstained are not", () => {
    expect(isClosedUnsigned({ status: "drafted", cycleOpen: false })).toBe(true);
    expect(isClosedUnsigned({ status: "pending", cycleOpen: false })).toBe(true);
    expect(isClosedUnsigned({ status: "returned", cycleOpen: false })).toBe(true);
    expect(isClosedUnsigned({ status: "signed", cycleOpen: false })).toBe(false);
    expect(isClosedUnsigned({ status: "abstained", cycleOpen: false })).toBe(false);
    expect(isClosedUnsigned({ status: "drafted", cycleOpen: true })).toBe(false);
    expect(isClosedUnsigned({ status: "drafted" })).toBe(false);
  });

  it("lists closed-cycle drafts after every actionable and completed row", () => {
    const sorted = sortReviewQueue([
      row("a-closed-drafted", "drafted", false),
      row("b-open-signed", "signed", true),
      row("c-open-drafted", "drafted", true),
      row("d-open-returned", "returned", true),
      row("e-closed-signed", "signed", false),
    ]);
    expect(sorted.map((r) => r.slug)).toEqual(["d-open-returned", "c-open-drafted", "b-open-signed", "e-closed-signed", "a-closed-drafted"]);
  });

  it("keeps the status then slug order among open rows", () => {
    const sorted = sortReviewQueue([row("z", "drafted"), row("a", "drafted"), row("m", "pending")]);
    expect(sorted.map((r) => r.slug)).toEqual(["a", "z", "m"]);
  });
});
