import { expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { MockDataProvider } from "@/lib/data/mock-provider";
import { OverviewTab } from "@/components/jeeves/overview-tab";
import { InitiativeTable } from "@/components/jeeves/initiative-table";
import { RiskHeatmap } from "@/components/jeeves/risk-heatmap";
import { QueueAgeCell, oldestUnsignedAgeMs } from "@/components/jeeves/queue-age";
import { renderWithProviders } from "./helpers";

it("shows abstentions separately from signatures in the case overview and portfolio", async () => {
  const detail = (await new MockDataProvider().getInitiativeDetail("member-chat-copilot"))!;
  detail.summary = { ...detail.summary, state: "in_review", domainsRequired: 8, domainsSigned: 7, domainsAbstained: 1 };
  renderWithProviders(<><OverviewTab detail={detail} /><InitiativeTable initiatives={[detail.summary]} /></>);
  expect(screen.getByText("7/8 signed · 1 abstained")).toBeTruthy();
  expect(screen.getByText("1 abstained")).toBeTruthy();
  expect(screen.queryByText("8/8 signed")).toBeNull();
});

it("stops the waiting clock for an abstained reviewer without aging the remaining reviewers by that date", () => {
  const now = Date.parse("2026-09-21T12:00:00Z");
  const reviews = [{ status: "abstained" as const, createdAt: "2020-01-01T00:00:00Z" }, { status: "pending" as const, createdAt: "2026-09-20T12:00:00Z" }];
  expect(oldestUnsignedAgeMs(reviews, now)).toBe(86_400_000);
  expect(oldestUnsignedAgeMs([reviews[0]], now)).toBeNull();
  renderWithProviders(<QueueAgeCell {...reviews[0]} nowMs={now} />);
  expect(screen.getByText("—")).toBeTruthy();
});

it("classifies signed plus abstained as resolved without calling it all signed", async () => {
  const detail = (await new MockDataProvider().getInitiativeDetail("member-chat-copilot"))!;
  renderWithProviders(<RiskHeatmap initiatives={[{ ...detail.summary, tier: "high", state: "in_review", overdue: false, domainsRequired: 8, domainsSigned: 0, domainsAbstained: 8 }]} />);
  expect(screen.getByRole("columnheader", { name: "Reviews resolved" })).toBeTruthy();
  expect(screen.queryByText("All signed")).toBeNull();
  const row = screen.getAllByRole("row").find(row => within(row).queryByText("High"))!;
  expect(within(row).getAllByRole("cell").map(cell => cell.textContent)).toEqual(["High", "1", "0", "0", "0"]);
});
