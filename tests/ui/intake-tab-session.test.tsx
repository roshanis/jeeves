// Disabled "Continue intake" for a signed-in non-owner (ui-intake-F37).
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { IntakeTab } from "@/components/jeeves/intake-tab";
import { renderWithProviders } from "./helpers";

vi.mock("@/lib/client/session-context", () => ({
  useLiveSessionOptional: () => ({
    session: { token: "t", workspaceId: "w", expiresAt: Date.now() + 60_000, personaKey: "other", personaLabel: "Other Person", role: "requester" },
    logout: vi.fn(),
  }),
}));

describe("IntakeTab Continue intake for a signed-in non-owner", () => {
  it("explains the real reason instead of telling a signed-in user to start the demo", () => {
    const intake = { version: 1, submitted: false, missing: [], fields: { basics: { title: "T" } } } as never;
    const summary = { requester: "Priya Raman", slug: "s", isSeeded: false } as never;
    renderWithProviders(<IntakeTab intake={intake} summary={summary} />);
    const button = screen.getByRole("button", { name: "Continue intake" });
    const reason = document.getElementById((button.getAttribute("aria-describedby") ?? "").split(" ")[0]!)!.textContent;
    expect(reason).not.toContain("Start the demo");
    expect(reason).toContain("Only the requester who owns this draft");
  });
});
