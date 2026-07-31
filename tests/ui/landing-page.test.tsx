// LandingPage (components/jeeves/landing-page.tsx) — the static, public
// marketing hero at "/". It is a pure server component (no hooks, no data
// fetching), so it can be rendered directly without RoleProvider/session
// wrappers. Covers: the hero headline, the primary CTAs routing into
// CONTACT_URL/the real console, no sidebar bleed-through, and the
// "Synthetic data — demo" label on the stats strip.
//
// The demo-disclaimer strip moved to app/(marketing)/layout.tsx (shared
// across every marketing route, not just "/") — its exact-banner-string
// assertion now lives in tests/ui/marketing-pages.test.tsx's
// "MarketingLayout" describe block, which renders that layout directly.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LandingPage } from "@/components/jeeves/landing-page";
import { CONTACT_URL } from "@/lib/marketing/site-config";

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

  it("links the primary CTAs into CONTACT_URL and the real console", () => {
    const { getByRole, getAllByRole } = render(<LandingPage />);

    const bookAssessment = getByRole("link", {
      name: "Book a governance assessment",
    }) as HTMLAnchorElement;
    expect(bookAssessment.getAttribute("href")).toBe(CONTACT_URL);

    // "Explore the live demo" appears twice (hero secondary CTA + final CTA
    // band) — both must point at /inbox.
    const exploreDemoLinks = getAllByRole("link", {
      name: "Explore the live demo",
    }) as HTMLAnchorElement[];
    expect(exploreDemoLinks.length).toBeGreaterThan(0);
    for (const link of exploreDemoLinks) {
      expect(link.getAttribute("href")).toBe("/inbox");
    }
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
