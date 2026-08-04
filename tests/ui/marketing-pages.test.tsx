// Monetization M1 marketing surfaces: the framework-crosswalk table, the
// procurement-readiness pilot one-pager, and the repositioned landing-page
// CTAs. Pure server components (no hooks, no data fetching), rendered
// directly like tests/ui/landing-page.test.tsx.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LandingPage } from "@/components/jeeves/landing-page";
import { FrameworkMappingTable } from "@/components/jeeves/framework-mapping-table";
import {
  CONTROL_FRAMEWORK_MAPPINGS,
  FRAMEWORK_DISCLAIMER,
  FRAMEWORK_PAGES,
} from "@/lib/marketing/framework-mappings";
import { CONTACT_URL } from "@/lib/marketing/site-config";
import { DEMO_BANNER_TEXT } from "@/lib/demo-banner";
import PilotPage from "@/app/(marketing)/pilot/page";
import MarketingLayout from "@/app/(marketing)/layout";

// vitest globals are off in this repo — register RTL cleanup explicitly
// (see tests/ui/landing-page.test.tsx's comment for why).
afterEach(cleanup);

describe("MarketingLayout", () => {
  it("shows the exact demo banner string (moved here from LandingPage)", () => {
    const { getByText } = render(
      <MarketingLayout>
        <p>content</p>
      </MarketingLayout>,
    );
    expect(getByText(DEMO_BANNER_TEXT)).toBeDefined();
  });
});

describe("FrameworkMappingTable", () => {
  const nistPage = FRAMEWORK_PAGES.find((p) => p.slug === "nist-ai-rmf")!;

  it("renders one row per distinct requirement in the page's refKey", () => {
    const expectedRefs = new Set(
      CONTROL_FRAMEWORK_MAPPINGS.flatMap((m) => m[nistPage.refKey]).map(
        (ref) => ref.ref,
      ),
    );

    const { container } = render(<FrameworkMappingTable page={nistPage} />);
    const rows = container.querySelectorAll(
      '[data-slot="framework-requirement-row"]',
    );
    expect(rows.length).toBe(expectedRefs.size);
  });

  it("shows a control chip per mapped control, linking to /controls", () => {
    const { getAllByRole } = render(<FrameworkMappingTable page={nistPage} />);
    const chips = getAllByRole("link").filter(
      (link) => link.getAttribute("href") === "/controls",
    );
    expect(chips.length).toBeGreaterThan(0);
    // C-01 (Clinician-in-the-loop protocol) maps to GOVERN 3 on the NIST page.
    expect(chips.some((chip) => chip.textContent?.includes("C-01"))).toBe(
      true,
    );
  });

  it("shows the FRAMEWORK_DISCLAIMER", () => {
    const { getByText } = render(<FrameworkMappingTable page={nistPage} />);
    expect(getByText(FRAMEWORK_DISCLAIMER)).toBeDefined();
  });
});

describe("PilotPage", () => {
  it("shows the pilot heading", () => {
    const { getByRole } = render(<PilotPage />);
    expect(
      getByRole("heading", { level: 1, name: "Procurement-readiness pilot" }),
    ).toBeDefined();
  });

  it("links its primary CTA to CONTACT_URL", () => {
    const { getByRole } = render(<PilotPage />);
    const cta = getByRole("link", {
      name: "Book an intro call",
    }) as HTMLAnchorElement;
    expect(cta.getAttribute("href")).toBe(CONTACT_URL);
  });

  it('shows "Contact for pricing" when no NEXT_PUBLIC_PILOT_PRICE is set', () => {
    const { getByText } = render(<PilotPage />);
    expect(getByText("Contact for pricing")).toBeDefined();
  });

  it("shows the framework disclaimer as small print", () => {
    const { getByText } = render(<PilotPage />);
    expect(getByText(FRAMEWORK_DISCLAIMER)).toBeDefined();
  });
});

describe("LandingPage (repositioned CTAs)", () => {
  it('primary CTA "Book a governance assessment" links to CONTACT_URL', () => {
    const { getByRole } = render(<LandingPage />);
    const cta = getByRole("link", {
      name: "Book a governance assessment",
    }) as HTMLAnchorElement;
    expect(cta.getAttribute("href")).toBe(CONTACT_URL);
  });

  it('secondary CTA "Explore the live demo" links to /inbox', () => {
    const { getAllByRole } = render(<LandingPage />);
    const ctas = getAllByRole("link", {
      name: "Explore the live demo",
    }) as HTMLAnchorElement[];
    expect(ctas.length).toBeGreaterThan(0);
    for (const cta of ctas) {
      expect(cta.getAttribute("href")).toBe("/inbox");
    }
  });

  it("has no console sidebar bleed-through", () => {
    const { container } = render(<LandingPage />);
    expect(container.querySelector("aside")).toBeNull();
  });
});
