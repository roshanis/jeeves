// AppSidebar section kickers + workspace caption (WCAG 1.4.3 fix,
// 2026-08-02): text-sidebar-foreground/40 and /45 measured 2.9-3.4:1
// against --sidebar (11px text needs 4.5:1). Both now use the dedicated
// --sidebar-foreground-muted token (app/globals.css), which measures
// 5.52:1 light / 5.94:1 dark. This locks in the class change.
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
}));

import { AppSidebar } from "@/components/jeeves/app-sidebar";

describe("AppSidebar contrast tokens", () => {
  it("section kickers use the muted-foreground token, not a low-contrast alpha", () => {
    renderWithProviders(<AppSidebar />);
    const kicker = screen.getByText("Oversee");
    expect(kicker.className).toContain("text-sidebar-foreground-muted");
    expect(kicker.className).not.toContain("text-sidebar-foreground/40");
  });

  it("the workspace caption uses the muted-foreground token, not a low-contrast alpha", () => {
    renderWithProviders(<AppSidebar />);
    const caption = screen.getByText("Synthetic demo workspace");
    expect(caption.className).toContain("text-sidebar-foreground-muted");
    expect(caption.className).not.toContain("text-sidebar-foreground/45");
  });
});
