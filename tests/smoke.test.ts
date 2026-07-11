import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/format";

describe("slugify", () => {
  it("lowercases, hyphenates, and trims a realistic initiative title", () => {
    expect(slugify("Prior-Auth Clinical Summarizer")).toBe(
      "prior-auth-clinical-summarizer",
    );
  });

  it("collapses runs of punctuation/whitespace into a single hyphen", () => {
    expect(slugify("  Legal & Privacy / HIPAA  Review!!  ")).toBe(
      "legal-privacy-hipaa-review",
    );
  });

  it("does not produce leading or trailing hyphens", () => {
    expect(slugify("--already-hyphenated--")).toBe("already-hyphenated");
  });
});
