import { describe, expect, it } from "vitest";
import { generateMetadata as indexMeta } from "@/app/(marketing)/frameworks/page";
import { generateMetadata as pilotMeta } from "@/app/(marketing)/pilot/page";
import { generateMetadata as nistMeta } from "@/app/(marketing)/frameworks/nist-ai-rmf/page";
import { generateMetadata as euMeta } from "@/app/(marketing)/frameworks/eu-ai-act/page";

// The suite runs in demo mode, where a demo-only page hands out its metadata.
describe("marketing page metadata", () => {
  it("page titles do not carry the brand the root template appends", () => {
    for (const metadata of [indexMeta, pilotMeta, nistMeta, euMeta]) {
      const title = String(metadata().title);
      expect(title).not.toBe("undefined");
      expect(title).not.toMatch(/Jeeves$/);
    }
  });
});
