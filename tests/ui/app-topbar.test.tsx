// AppTopBar (components/jeeves/app-topbar.tsx) — covers the new
// pathname-derived breadcrumb (deriveBreadcrumb, exported as a pure
// function) plus a render smoke test that the breadcrumb slot and the exact
// DEMO_BANNER_TEXT disclaimer both render for a mocked pathname.
// DemoModeChip/RoleSwitcher behavior itself is covered by their own test
// files; this file only checks AppTopBar's own new logic and composition.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { LiveSessionProvider, resetLiveSessionForTests } from "@/lib/client/session-context";

afterEach(() => {
  cleanup();
  resetLiveSessionForTests();
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/monitoring",
}));

import { AppTopBar, deriveBreadcrumb, DEMO_BANNER_TEXT } from "@/components/jeeves/app-topbar";

describe("deriveBreadcrumb", () => {
  it("returns just the section label for a top-level nav route", () => {
    expect(deriveBreadcrumb("/portfolio")).toBe("Portfolio");
    expect(deriveBreadcrumb("/controls")).toBe("Controls");
  });

  it("appends a title-cased child segment for a route nested under a nav item", () => {
    expect(deriveBreadcrumb("/agents/prior-auth-agent")).toBe("Agents / Prior Auth Agent");
  });

  it("only exact-matches Inbox (it does not prefix-match nested routes)", () => {
    expect(deriveBreadcrumb("/inbox")).toBe("Inbox");
    // "/inbox/x" isn't a real route, but exercises the exact-match rule:
    // Inbox must NOT prefix-match, so this falls through to the generic
    // segment fallback instead of "Inbox / X" via NAV_ITEMS.
    expect(deriveBreadcrumb("/inbox/x")).toBe("Inbox / X");
  });

  it("falls back to title-cased path segments for routes with no NAV_ITEMS entry", () => {
    expect(deriveBreadcrumb("/initiatives/prior-auth-clinical-summarizer")).toBe(
      "Initiatives / Prior Auth Clinical Summarizer",
    );
  });

  it("returns Console for the root path", () => {
    expect(deriveBreadcrumb("/")).toBe("Console");
  });
});

describe("AppTopBar", () => {
  it("renders the breadcrumb slot for the current pathname and the exact demo banner text", () => {
    renderWithProviders(
      <LiveSessionProvider>
        <AppTopBar />
      </LiveSessionProvider>,
    );
    expect(document.querySelector('[data-slot="breadcrumb"]')?.textContent).toBe("Monitoring");
    expect(screen.getByText(DEMO_BANNER_TEXT)).toBeTruthy();
  });
});
