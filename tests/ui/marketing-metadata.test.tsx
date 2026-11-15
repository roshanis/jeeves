import { describe, expect, it } from "vitest";
import { metadata as indexMeta } from "@/app/(marketing)/frameworks/page";
import { metadata as pilotMeta } from "@/app/(marketing)/pilot/page";
import { metadata as nistMeta } from "@/app/(marketing)/frameworks/nist-ai-rmf/page";
import { metadata as euMeta } from "@/app/(marketing)/frameworks/eu-ai-act/page";

describe("marketing page metadata", () => {
  it("page titles do not carry the brand the root template appends", () => {
    for (const m of [indexMeta, pilotMeta, nistMeta, euMeta]) {
      expect(String(m.title)).not.toMatch(/Jeeves$/);
    }
  });
});
