import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { InitiativeBlockersRail } from "@/components/jeeves/initiative-blockers-rail";
import { getProvider } from "@/lib/data";
import { renderWithProviders } from "./helpers";

describe("InitiativeBlockersRail — breach initiative (#4 member-chat-copilot)", () => {
  it("renders the rail and surfaces the breached Q-01 control as a blocker", async () => {
    const detail = await getProvider().getInitiativeDetail("member-chat-copilot");
    expect(detail).not.toBeNull();

    const { container } = renderWithProviders(
      <InitiativeBlockersRail detail={detail!} />,
    );

    expect(container.querySelector('[data-slot="blockers-rail"]')).not.toBeNull();
    expect(screen.getByText("Control Q-01: breached")).toBeDefined();
  });
});
