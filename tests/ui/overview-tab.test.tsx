import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { MockDataProvider } from "@/lib/data/mock-provider";
import { OverviewTab } from "@/components/jeeves/overview-tab";
import { renderWithProviders } from "./helpers";

async function detailWith(deployments: { version: string; status: "deployed" | "paused" | "retired" | "awaiting_promotion_signoff" }[]) {
  const detail = (await new MockDataProvider().getInitiativeDetail("member-chat-copilot"))!;
  return { ...detail, deployments: deployments.map((d, i) => ({ ...d, at: `2026-09-0${i + 1}T00:00:00Z` })) };
}

describe("OverviewTab current deployment", () => {
  it("names the latest deployment when none is deployed, with a readable status", async () => {
    renderWithProviders(<OverviewTab detail={await detailWith([{ version: "v1.0", status: "retired" }, { version: "v2.0", status: "paused" }])} />);
    const line = screen.getByText(/Current deployment/);
    expect(line.textContent).toContain("v2.0");
    expect(line.textContent).toContain("Paused");
    expect(line.textContent).not.toContain("v1.0");
    expect(line.textContent).not.toMatch(/awaiting_|paused \(/);
  });

  it("renders a multi-word status as its label, not the snake_case code", async () => {
    renderWithProviders(<OverviewTab detail={await detailWith([{ version: "v1.0", status: "awaiting_promotion_signoff" }])} />);
    const line = screen.getByText(/Current deployment/);
    expect(line.textContent).toContain("Awaiting promotion sign-off");
    expect(line.textContent).not.toContain("awaiting_promotion_signoff");
  });
});

describe("OverviewTab quick links", () => {
  it("labels the evals link Evals and targets tab=evals", async () => {
    renderWithProviders(<OverviewTab detail={await detailWith([])} />);
    const link = screen.getByRole("link", { name: /^Evals$/ });
    expect(link.getAttribute("href")).toContain("tab=evals");
    expect(screen.queryByRole("link", { name: /Operate/ })).toBeNull();
  });
});
