import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { InitiativeBlockersRail } from "@/components/jeeves/initiative-blockers-rail";
import { MockDataProvider } from "@/lib/data/mock-provider";
import { renderWithProviders } from "./helpers";

describe("InitiativeBlockersRail — breach initiative (#4 member-chat-copilot)", () => {
  it("renders the rail and surfaces the breached Q-01 control as a blocker", async () => {
    const detail = await new MockDataProvider().getInitiativeDetail("member-chat-copilot");
    expect(detail).not.toBeNull();

    const { container } = renderWithProviders(
      <InitiativeBlockersRail detail={detail!} />,
    );

    expect(container.querySelector('[data-slot="blockers-rail"]')).not.toBeNull();
    expect(screen.getByText("Control Q-01: breached")).toBeDefined();
  });
});


describe("InitiativeBlockersRail — incomplete governance", () => {
  it("does not claim reviews or evidence are complete before they exist", async () => {
    const detail = await new MockDataProvider().getInitiativeDetail("member-chat-copilot");
    renderWithProviders(<InitiativeBlockersRail detail={{ ...detail!, summary: { ...detail!.summary, state: "intake_draft" }, reviews: [], controls: [] }} />);
    expect(screen.queryAllByText(/all required reviews signed|All required evidence on file/i)).toHaveLength(0);
  });

  it("includes drafted reviews still awaiting a signature among blockers", async () => {
    const detail = await new MockDataProvider().getInitiativeDetail("member-chat-copilot");
    renderWithProviders(<InitiativeBlockersRail detail={{ ...detail!, summary: { ...detail!.summary, state: "in_review" }, reviews: [{ ...detail!.reviews[0]!, domain: "legal", status: "drafted" }], controls: [] }} />);
    expect(screen.getByText("Review awaiting signature: Legal")).toBeTruthy();
  });
});

it("records abstention without blocking progress while preserving independent control blockers", async () => {
  const detail = (await new MockDataProvider().getInitiativeDetail("member-chat-copilot"))!;
  renderWithProviders(<InitiativeBlockersRail detail={{ ...detail, summary: { ...detail.summary, state: "in_review" }, reviews: [{ ...detail.reviews[0]!, domain: "legal", status: "abstained", abstention: { reason: "Conflict of interest", reviewer: "reviewer", at: "2026-09-21T12:00:00Z" } }] }} />);
  expect(screen.queryByText(/required review incomplete/)).toBeNull();
  expect(screen.getByText(/Conflict of interest/)).toBeTruthy();
  expect(screen.getByText("Control Q-01: breached")).toBeTruthy();
});
