// Command palette (⌘K / Ctrl+K) — replaces a search input and a ⌘K badge
// that were both inert. Measured before the change: Meta+K left focus on
// <body> and opened no dialog; typing a query and pressing Enter navigated
// nowhere.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  CommandPalette,
  buildPaletteItems,
  filterPaletteItems,
  scorePaletteItem,
} from "@/components/jeeves/command-palette";
import { NAV_ITEMS } from "@/components/jeeves/app-sidebar";
import { renderWithProviders } from "./helpers";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => push(...args), refresh: vi.fn(), replace: vi.fn() }),
}));

const INITIATIVES = [
  { slug: "prior-auth-summarizer", title: "Prior-Auth Clinical Summarizer" },
  { slug: "formulary-qa-bot", title: "Member Formulary Q&A Bot" },
  { slug: "fwa-anomaly-detector", title: "Fraud, Waste & Abuse Anomaly Detector" },
];

function open() {
  renderWithProviders(<CommandPalette initiatives={INITIATIVES} />);
  fireEvent.keyDown(window, { key: "k", metaKey: true });
}

function items() {
  return screen.queryAllByRole("option");
}

describe("palette ranking (pure)", () => {
  const built = buildPaletteItems(INITIATIVES);

  it("includes every initiative and every console route", () => {
    expect(built).toHaveLength(INITIATIVES.length + NAV_ITEMS.length);
  });

  it("ranks a label prefix above a mid-label match above a slug-only match", () => {
    const item = built.find((i) => i.label === "Prior-Auth Clinical Summarizer")!;
    expect(scorePaletteItem(item, "prior")).toBe(3);
    expect(scorePaletteItem(item, "clinical")).toBe(2);
    expect(scorePaletteItem(item, "summarizer")).toBe(2);
    expect(scorePaletteItem(item, "zzz")).toBeNull();
  });

  it("matches on slug as well as title", () => {
    const results = filterPaletteItems(built, "fwa-anomaly");
    expect(results[0]!.href).toBe("/initiatives/fwa-anomaly-detector");
  });

  it("returns everything for an empty query", () => {
    expect(filterPaletteItems(built, "")).toHaveLength(built.length);
  });
});

describe("CommandPalette — the shortcut actually works", () => {
  it("opens on Meta+K", () => {
    open();
    expect(screen.getByRole("listbox")).toBeDefined();
  });

  it("opens on Ctrl+K for non-Apple keyboards", () => {
    renderWithProviders(<CommandPalette initiatives={INITIATIVES} />);
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("listbox")).toBeDefined();
  });

  it("filters as the user types", () => {
    open();
    const before = items().length;

    fireEvent.change(screen.getByLabelText("Search initiatives and pages"), {
      target: { value: "formulary" },
    });

    expect(items().length).toBeLessThan(before);
    expect(items()[0]!.textContent).toContain("Member Formulary Q&A Bot");
  });

  it("navigates to the highlighted result on Enter", () => {
    push.mockClear();
    open();
    const input = screen.getByLabelText("Search initiatives and pages");

    fireEvent.change(input, { target: { value: "formulary" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(push).toHaveBeenCalledWith("/initiatives/formulary-qa-bot");
  });

  it("moves the highlight with the arrow keys", () => {
    push.mockClear();
    open();
    const input = screen.getByLabelText("Search initiatives and pages");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    // Second item in the unfiltered list — the second initiative.
    expect(push).toHaveBeenCalledWith("/initiatives/formulary-qa-bot");
  });

  it("navigates on click", () => {
    push.mockClear();
    open();

    fireEvent.click(items()[0]!);
    expect(push).toHaveBeenCalledWith("/initiatives/prior-auth-summarizer");
  });

  it("reports an honest empty state rather than silently showing nothing", () => {
    open();
    fireEvent.change(screen.getByLabelText("Search initiatives and pages"), {
      target: { value: "nothingmatchesthis" },
    });

    expect(items()).toHaveLength(0);
    expect(screen.getByText(/no initiative or page matches/i)).toBeDefined();
  });

  it("exposes the active option to assistive tech", () => {
    open();
    const input = screen.getByLabelText("Search initiatives and pages");
    const activeId = input.getAttribute("aria-activedescendant");

    expect(activeId).toBeTruthy();
    expect(document.getElementById(activeId!)?.getAttribute("aria-selected")).toBe("true");
  });

  it("offers a non-keyboard affordance for small screens, where the field is hidden", () => {
    renderWithProviders(<CommandPalette initiatives={INITIATIVES} />);

    const compact = document.querySelector('[data-slot="command-palette-trigger-compact"]');
    expect(compact).not.toBeNull();
    expect(compact?.className).toContain("xl:hidden");
    // The wide trigger is the one hidden on small screens.
    const wide = document.querySelector('[data-slot="command-palette-trigger"]');
    expect(wide?.className).toContain("xl:flex");
  });
});
