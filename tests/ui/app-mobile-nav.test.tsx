// AppMobileNav (components/jeeves/app-mobile-nav.tsx) — the md:hidden nav
// strip that replaces the (md-only) sidebar on small screens. Reuses
// app-sidebar's NAV_ITEMS so the two never drift. Mocks next/navigation's
// usePathname (no test in this repo mocks next/navigation yet, so this
// establishes the pattern locally rather than reaching for a shared helper).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// This suite renders plain (no RoleProvider/TooltipProvider needed), so it
// doesn't pull in tests/ui/helpers.tsx — but RTL still needs its cleanup
// registered explicitly (vitest globals are off in this repo, see
// helpers.tsx), otherwise renders from earlier `it` blocks accumulate in the
// shared jsdom document and getByRole/getByText see duplicates.
afterEach(cleanup);

vi.mock("next/navigation", () => ({
  usePathname: () => "/controls",
}));

import { AppMobileNav } from "@/components/jeeves/app-mobile-nav";

const EXPECTED_HREFS = [
  "/inbox",
  "/portfolio",
  "/reviews",
  "/agents",
  "/monitoring",
  "/controls",
  "/audit",
  "/promotions",
  "/admin",
];

describe("AppMobileNav", () => {
  it("renders one link per nav item with the correct hrefs", () => {
    const { getAllByRole } = render(<AppMobileNav />);
    const links = getAllByRole("link") as HTMLAnchorElement[];
    const hrefs = links.map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(EXPECTED_HREFS);
  });

  it("marks only the active route's link with aria-current", () => {
    const { getByRole } = render(<AppMobileNav />);

    const controlsLink = getByRole("link", { name: /controls/i });
    expect(controlsLink.getAttribute("aria-current")).toBe("page");

    const inboxLink = getByRole("link", { name: /inbox/i });
    expect(inboxLink.getAttribute("aria-current")).toBeNull();
  });
});
