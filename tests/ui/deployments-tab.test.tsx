import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { DeploymentsTab } from "@/components/jeeves/deployments-tab";
import { getProvider } from "@/lib/data";
import { renderWithProviders } from "./helpers";

describe("DeploymentsTab — member-chat-copilot", () => {
  it("renders at least one version row", async () => {
    const detail = await getProvider().getInitiativeDetail("member-chat-copilot");
    expect(detail).not.toBeNull();

    renderWithProviders(<DeploymentsTab deployments={detail!.deployments} />);

    expect(detail!.deployments.length).toBeGreaterThan(0);
    for (const d of detail!.deployments) {
      expect(screen.getByText(d.version)).toBeDefined();
    }
  });
});

describe("DeploymentsTab — empty state", () => {
  it('renders "No deployments recorded" when there are no deployments', () => {
    renderWithProviders(<DeploymentsTab deployments={[]} />);

    expect(
      screen.getByText(
        "No deployments recorded — this initiative has no active release.",
      ),
    ).toBeDefined();
  });
});
