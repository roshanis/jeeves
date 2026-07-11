import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { IntakeTab } from "@/components/jeeves/intake-tab";
import { getProvider } from "@/lib/data";
import { renderWithProviders } from "./helpers";

describe("IntakeTab — champion initiative (#1 prior-auth-summarizer)", () => {
  it('shows the "Draft — not yet submitted" state', async () => {
    const detail = await getProvider().getInitiativeDetail(
      "prior-auth-summarizer",
    );
    expect(detail).not.toBeNull();

    renderWithProviders(<IntakeTab intake={detail!.intake} />);

    expect(screen.getByText("Draft — not yet submitted")).toBeDefined();
  });

  it("flags the missing data-retention answer (completeness gap)", async () => {
    const detail = await getProvider().getInitiativeDetail(
      "prior-auth-summarizer",
    );
    renderWithProviders(<IntakeTab intake={detail!.intake} />);

    expect(detail!.intake?.missing).toContain("data.retentionIntent");
    expect(screen.getByText(/data\.retentionIntent/)).toBeDefined();
    expect(screen.getByText("Missing")).toBeDefined();
  });
});
