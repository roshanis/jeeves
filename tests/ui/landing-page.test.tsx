// LandingPage (components/jeeves/landing-page.tsx) — the static, public
// marketing hero at "/". It is a pure server component (no hooks, no data
// fetching), so it can be rendered directly without RoleProvider/session
// wrappers. Covers: the hero headline, the two primary CTAs routing into the
// real console, the exact demo-disclaimer string, no sidebar bleed-through,
// and the "Synthetic data — demo" label on the stats strip.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LandingPage } from "@/components/jeeves/landing-page";
import { DEMO_BANNER_TEXT } from "@/lib/demo-banner";

// LandingPage needs no providers (pure server component), so this doesn't
// use tests/ui/helpers.tsx's renderWithProviders — but RTL cleanup still
// needs registering explicitly (vitest globals are off in this repo),
// otherwise renders from earlier `it` blocks accumulate in the shared jsdom
// document and getByRole/getByText see duplicates.
afterEach(cleanup);

describe("LandingPage", () => {
  it("renders the hero headline", () => {
    const { getByRole } = render(<LandingPage />);
    const heading = getByRole("heading", {
      level: 1,
      name: "Every AI initiative. Governed end to end.",
    });
    expect(heading).toBeDefined();
  });

  it("links the primary CTAs into the real console routes", () => {
    const { getByRole } = render(<LandingPage />);

    const openConsole = getByRole("link", {
      name: "Open the console",
    }) as HTMLAnchorElement;
    expect(openConsole.getAttribute("href")).toBe("/inbox");

    const browsePortfolio = getByRole("link", {
      name: "Browse the portfolio",
    }) as HTMLAnchorElement;
    expect(browsePortfolio.getAttribute("href")).toBe("/portfolio");
  });

  it("shows the exact demo banner string", () => {
    const { getByText } = render(<LandingPage />);
    expect(getByText(DEMO_BANNER_TEXT)).toBeDefined();
  });

  it("has no console sidebar bleed-through", () => {
    const { container } = render(<LandingPage />);
    expect(container.querySelector("aside")).toBeNull();
  });

  it("labels the stats strip as synthetic demo data", () => {
    const { getByText } = render(<LandingPage />);
    expect(getByText("Synthetic data — demo")).toBeDefined();
  });
});
