import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";

const mocks = vi.hoisted(() => ({ promotions: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/client/session-context", () => ({
  useLiveSession: () => ({ session: { role: "admin", token: "test-token" } }),
  useLiveSessionOptional: () => ({ session: { role: "admin", token: "test-token" } }),
}));
vi.mock("@/lib/client/api", async (original) => ({
  ...await original<typeof import("@/lib/client/api")>(),
  listPromotions: mocks.promotions,
}));
import { PromotionsPageClient } from "@/app/(console)/promotions/promotions-page-client";

beforeEach(() => {
  mocks.promotions.mockResolvedValue([{
    deploymentVersionId: "candidate", initiativeId: "case", initiativeSlug: "case-one", initiativeTitle: "Case one",
    tier: "high", version: "v2.1", modelVersion: "model-2.1", deployedAt: "2026-09-19T00:00:00Z", supersedesVersion: "v2.0",
  }]);
});

describe("promotion recovery navigation", () => {
  it("links to permanent initiative recovery instead of owning another rollback command", async () => {
    renderWithProviders(<PromotionsPageClient historyByInitiativeId={{ case: {
      evalSeries: null,
      history: [
        { id: "current", version: "v2.0", status: "deployed", deployedAt: "2026-09-01T00:00:00Z", modelVersion: null, pausedAt: null, retiredAt: null, isCurrent: true },
        { id: "prior", version: "v1.9", status: "retired", deployedAt: "2026-08-01T00:00:00Z", modelVersion: null, pausedAt: null, retiredAt: "2026-09-01T00:00:00Z", isCurrent: false },
      ],
    } }} />);
    const link = await screen.findByRole("link", { name: "Deployment history and rollback" });
    expect(link.getAttribute("href")).toBe("/initiatives/case-one?tab=deployments");
    expect(screen.queryByRole("button", { name: "Roll back" })).toBeNull();
    expect(screen.getByRole("button", { name: "Promote" })).toBeTruthy();
  });
});
