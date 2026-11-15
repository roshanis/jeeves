import type React from "react";
import { RoleProvider } from "@/components/jeeves/role-context";
import { LiveSessionProvider } from "@/lib/client/session-context";
// Monetization M1 marketing surfaces: the framework-crosswalk table, the
// procurement-readiness pilot one-pager, and the repositioned landing-page
// CTAs. Pure server components (no hooks, no data fetching), rendered
// directly like tests/ui/landing-page.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as rtlRender } from "@testing-library/react";
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
import ThankYouPage from "@/app/(marketing)/thank-you/page";
import OperatorPage from "@/app/operator/page";
import NotFound from "@/app/not-found";
import { LegalPage } from "@/components/jeeves/legal-page";

// The real bar stays hidden until the visitor scrolls, so expose its label.
vi.mock("@/components/jeeves/sticky-mobile-cta", () => ({
  StickyMobileCta: ({ label }: { label: string }) => <p data-testid="sticky-cta">{label}</p>,
}));

// vitest globals are off in this repo — register RTL cleanup explicitly
// (see tests/ui/landing-page.test.tsx's comment for why).
afterEach(cleanup);

vi.mock("@/components/jeeves/public-intake-queue", () => ({ PublicIntakeQueue: () => <p>queue</p> }));

describe("skip-link target (#main-content)", () => {
  function mains(c: HTMLElement) { return Array.from(c.querySelectorAll("main")); }
  it("marketing pages sit in exactly one focusable main#main-content", () => {
    for (const page of [<PilotPage key="p" />, <ThankYouPage key="t" />, <LegalPage key="l" title="Privacy" lastUpdated="now"><p>x</p></LegalPage>]) {
      const { container, unmount } = render(<MarketingLayout>{page}</MarketingLayout>);
      const found = mains(container);
      expect(found).toHaveLength(1);
      expect(found[0].id).toBe("main-content");
      expect(found[0].getAttribute("tabindex")).toBe("-1");
      unmount();
    }
  });
  it("the operator page and the 404 page expose the target themselves", () => {
    for (const page of [<OperatorPage key="o" />, <NotFound key="n" />]) {
      const { container, unmount } = render(page);
      expect(mains(container).map((m) => m.id)).toEqual(["main-content"]);
      unmount();
    }
  });
});

describe("framework disclaimer contrast", () => {
  it("is not shrunk or faded below AA in the footer or on the pilot page", () => {
    for (const ui of [<MarketingLayout key="l"><p>x</p></MarketingLayout>, <PilotPage key="p" />]) {
      const { getAllByText, unmount } = render(ui);
      const el = getAllByText(FRAMEWORK_DISCLAIMER).at(-1)!;
      expect(el.className).not.toMatch(/text-muted-foreground\/\d+/);
      expect(el.className).not.toContain("text-[11px]");
      expect(el.className).toContain("text-muted-foreground");
      unmount();
    }
  });
});

describe("MarketingLayout", () => {
  it("shows the exact demo banner string (moved here from LandingPage)", () => {
    const { getByText } = render(
      <MarketingLayout>
        <p>content</p>
      </MarketingLayout>,
    );
    expect(getByText(DEMO_BANNER_TEXT)).toBeDefined();
  });

  describe("sticky mobile CTA label", () => {
    const original = process.env.OPERATOR_TOKEN;
    afterEach(() => {
      if (original === undefined) delete process.env.OPERATOR_TOKEN;
      else process.env.OPERATOR_TOKEN = original;
    });

    it("offers only the demo when no operator token is configured", () => {
      delete process.env.OPERATOR_TOKEN;
      const { getByTestId } = render(<MarketingLayout><p>content</p></MarketingLayout>);
      expect(getByTestId("sticky-cta").textContent).toBe("Try the demo");
    });

    it("offers the demo or a request when an operator token is configured", () => {
      process.env.OPERATOR_TOKEN = "t".repeat(40);
      const { getByTestId } = render(<MarketingLayout><p>content</p></MarketingLayout>);
      expect(getByTestId("sticky-cta").textContent).toBe("Try the demo or send a request");
    });
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

function render(ui: React.ReactElement) {
  return rtlRender(<RoleProvider><LiveSessionProvider>{ui}</LiveSessionProvider></RoleProvider>);
}

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
