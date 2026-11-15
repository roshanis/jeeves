// generateMetadata must say "not found" only for a missing initiative; a thrown
// data error (pool timeout) is logged and gets a neutral title.
import { afterEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({ impl: async (): Promise<unknown> => null }));
vi.mock("@/app/_lib/data-provider", () => ({
  getInitiativeDetailCoherent: () => data.impl(),
}));

import { generateMetadata } from "@/app/(console)/initiatives/[slug]/page";

const params = Promise.resolve({ slug: "x" });

describe("initiative generateMetadata", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps 'Initiative not found' for a null result", async () => {
    data.impl = async () => null;
    expect((await generateMetadata({ params })).title).toBe("Initiative not found");
  });

  it("logs a thrown error and does not claim the initiative is missing", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    data.impl = async () => {
      throw new Error("pool timeout");
    };
    const md = await generateMetadata({ params });
    expect(md.title).not.toBe("Initiative not found");
    expect(err).toHaveBeenCalled();
  });
});
