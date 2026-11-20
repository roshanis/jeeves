// The console shell while the demo's database has not been verified in this
// process (it was unreachable at boot): the chrome still renders, the page
// body is replaced by an honest notice, and nothing below it is mounted (a
// page would call the database). Mocks follow tests/ui/skip-link.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { closeInstallationGate, resetBootStateForTests } from "@/lib/config/boot-state";

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
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

import ConsoleLayout from "@/app/(console)/layout";

afterEach(() => {
  cleanup();
  resetBootStateForTests();
});

describe("console layout with the installation gate closed", () => {
  it("shows the notice inside main#main-content and not the page", () => {
    closeInstallationGate();
    const { container } = render(
      <ConsoleLayout>
        <div>page body</div>
      </ConsoleLayout>,
    );
    const main = container.querySelector("main#main-content");
    expect(main).not.toBeNull();
    expect(screen.queryByText("page body")).toBeNull();
    expect(screen.getByRole("heading", { name: /temporarily unavailable/i })).toBeTruthy();
    expect(main!.textContent).toMatch(/database/i);
    expect(screen.getByRole("link", { name: /back to the home page/i }).getAttribute("href")).toBe("/");
  });

  it("offers a Try again control that reloads the document", () => {
    closeInstallationGate();
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, reload } });
    try {
      render(
        <ConsoleLayout>
          <div>page body</div>
        </ConsoleLayout>,
      );
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });

  it("renders the page and no notice while the gate is open", () => {
    render(
      <ConsoleLayout>
        <div>page body</div>
      </ConsoleLayout>,
    );
    expect(screen.getByText("page body")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /temporarily unavailable/i })).toBeNull();
  });
});
