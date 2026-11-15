import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";

const mocks = vi.hoisted(() => ({ promotions: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/client/session-context", () => ({
  useLiveSession: () => ({ session: { role: "admin", token: "test-token", workspaceId: "visitor-workspace" } }),
  useLiveSessionOptional: () => ({ session: { role: "admin", token: "test-token", workspaceId: "visitor-workspace" } }),
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

  it("shows a shared sample checkpoint read-only instead of a Promote button that always 404s", async () => {
    mocks.promotions.mockResolvedValue([{ ...(await mocks.promotions()) [0], isShared: true }]);
    renderWithProviders(<PromotionsPageClient historyByInitiativeId={{}} />);
    await screen.findByText("Case one", { selector: "a" });
    expect(screen.queryByRole("button", { name: "Promote" })).toBeNull();
    expect(screen.getByText(/sample data/i)).toBeTruthy();
  });

  it("points to the offline Evals-tab comparison only on the card proposing the pair it compares", async () => {
    const base = (await mocks.promotions())[0];
    const ctx = (value: number) => ({ evalSeries: { kind: "eval_hallucination" as const, points: [{ ts: "2026-06-01T00:00:00.000Z", value }], threshold: 0.08 }, history: [] });
    mocks.promotions.mockResolvedValue([
      { ...base, deploymentVersionId: "seeded", initiativeId: "seeded", initiativeSlug: "pa-correspondence-model", initiativeTitle: "PA model", supersedesVersion: "v2.0", version: "v2.1" },
      { ...base, deploymentVersionId: "seeded-next", initiativeId: "seeded-next", initiativeSlug: "pa-correspondence-model", initiativeTitle: "PA model next", supersedesVersion: "v2.1", version: "v2.2" },
      { ...base, deploymentVersionId: "other", initiativeId: "other", initiativeSlug: "case-one", initiativeTitle: "Case one", supersedesVersion: "v2.0", version: "v2.1" },
    ]);
    renderWithProviders(<PromotionsPageClient historyByInitiativeId={{ seeded: ctx(0.01), "seeded-next": ctx(0.02), other: ctx(0.03) }} />);
    await screen.findByText("Case one", { selector: "a" });
    const pointers = screen.getAllByText(/offline .* comparison is on the initiative's Evals tab/);
    expect(pointers).toHaveLength(1);
    expect(pointers[0].textContent).toMatch(/offline v2\.0 vs v2\.1 comparison/);
    const card = pointers[0].closest('[data-slot="eval-comparison"]')!;
    expect(card.querySelector('[data-slot="eval-comparison-latest"]')!.textContent).toBe("0.0100");
  });
});
