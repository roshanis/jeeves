// Skip-to-content link (WCAG 2.4.1 fix, 2026-08-02): app/layout.tsx renders
// a visually-hidden-until-focused `<a href="#main-content">` as the first
// focusable child of <body>, and app/(console)/layout.tsx's <main> carries
// the matching id="main-content" the link targets — together they let
// keyboard users skip the sidebar's 5+ nav-link tab stops on every console
// page.
//
// RootLayout can't be rendered through the normal renderWithProviders
// helper: it does its own font loading (next/font/local, which needs a
// Next.js build-time loader and errors under plain Vitest) and mounts
// sonner's <Toaster/>, which reads window.matchMedia — absent in jsdom by
// default. Both are stubbed locally in this file only (no shared
// vitest.config.ts / setup-file changes, so this doesn't affect any other
// suite).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { RoleProvider } from "@/components/jeeves/role-context";
import { LiveSessionProvider } from "@/lib/client/session-context";
import { TooltipProvider } from "@/components/ui/tooltip";

afterEach(cleanup);

vi.mock("next/font/local", () => ({
  default: () => ({ variable: "--font-mock", className: "" }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
}));

if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import RootLayout from "@/app/layout";
import ConsoleLayout from "@/app/(console)/layout";

describe("Skip-to-content link", () => {
  it("renders as the first focusable element and targets #main-content", () => {
    const { container } = render(
      <RootLayout>
        <div>page body</div>
      </RootLayout>,
    );

    const body = container.querySelector("body") ?? container;
    const firstFocusable = body.querySelector("a, button, input, [tabindex]");
    expect(firstFocusable?.tagName.toLowerCase()).toBe("a");
    expect(firstFocusable?.getAttribute("href")).toBe("#main-content");
    expect(firstFocusable?.textContent).toBe("Skip to content");
  });

  it("is visually hidden by default and un-hides on focus (sr-only / focus:not-sr-only)", () => {
    const { container } = render(
      <RootLayout>
        <div>page body</div>
      </RootLayout>,
    );
    const link = container.querySelector("a[href='#main-content']");
    expect(link?.className).toContain("sr-only");
    expect(link?.className).toContain("focus:not-sr-only");
  });
});

describe("Console main landmark", () => {
  it("carries id=\"main-content\", the skip link's target", () => {
    const { container } = render(
      <RoleProvider>
        <LiveSessionProvider>
          <TooltipProvider>
            <ConsoleLayout>
              <div>console page</div>
            </ConsoleLayout>
          </TooltipProvider>
        </LiveSessionProvider>
      </RoleProvider>,
    );
    const main = container.querySelector("main");
    expect(main?.id).toBe("main-content");
    expect(main?.textContent).toContain("console page");
  });
});
