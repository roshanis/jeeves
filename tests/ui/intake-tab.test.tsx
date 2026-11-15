import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { IntakeTab } from "@/components/jeeves/intake-tab";
import { MockDataProvider } from "@/lib/data/mock-provider";
import { renderWithProviders } from "./helpers";

describe("IntakeTab — champion initiative (#1 prior-auth-summarizer)", () => {
  it('shows the "Draft — not yet submitted" state', async () => {
    const detail = await new MockDataProvider().getInitiativeDetail(
      "prior-auth-summarizer",
    );
    expect(detail).not.toBeNull();

    renderWithProviders(<IntakeTab intake={detail!.intake} />);

    expect(screen.getByText("Draft — not yet submitted")).toBeDefined();
  });

  it("flags the missing data-retention answer (completeness gap)", async () => {
    const detail = await new MockDataProvider().getInitiativeDetail(
      "prior-auth-summarizer",
    );
    renderWithProviders(<IntakeTab intake={detail!.intake} />);

    expect(detail!.intake?.missing).toContain("data.retentionIntent");
    expect(screen.getByText(/data\.retentionIntent/)).toBeDefined();
    expect(screen.getByText("Missing")).toBeDefined();
  });

  it("shows why a QC-returned intake came back instead of the generic draft text", async () => {
    const detail = await new MockDataProvider().getInitiativeDetail("prior-auth-summarizer");
    const events = [
      { ts: "2026-09-07T12:00:00Z", actor: "maya-ortiz", actorRole: "program", action: "return_to_requester", detail: "Returned from QC to the requester: Data sources list is empty" },
    ];
    renderWithProviders(<IntakeTab intake={detail!.intake} events={events} />);
    expect(screen.getByText(/Returned from QC/)).toBeDefined();
    expect(screen.getByText(/Data sources list is empty/)).toBeDefined();
    expect(screen.getByText(/maya-ortiz/)).toBeDefined();
  });
});
