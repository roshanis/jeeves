import { describe, expect, it, vi } from "vitest";
import type { DataProvider } from "@/lib/data/provider";
import { loadPortfolioDetails } from "./portfolio-data";

describe("loadPortfolioDetails", () => {
  it("reads every initiative detail in the caller's workspace scope", async () => {
    const listInitiativeDetails = vi.fn().mockResolvedValue([{ slug: "a" }]);
    const provider = { listInitiativeDetails } as unknown as DataProvider;
    await expect(loadPortfolioDetails(provider, "ws-1")).resolves.toEqual([{ slug: "a" }]);
    expect(listInitiativeDetails).toHaveBeenCalledWith({ viewerWorkspaceId: "ws-1" });
  });

  it("passes a null scope through for a visitor with no workspace", async () => {
    const listInitiativeDetails = vi.fn().mockResolvedValue([]);
    await loadPortfolioDetails({ listInitiativeDetails } as unknown as DataProvider, null);
    expect(listInitiativeDetails).toHaveBeenCalledWith({ viewerWorkspaceId: null });
  });
});
