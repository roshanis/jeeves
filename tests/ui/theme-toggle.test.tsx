// TDD for the dark-mode toggle (design pass follow-up): the button flips the
// `dark` class on <html>, persists the choice to localStorage under
// "jeeves-theme", and reflects the current mode in its accessible name.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle, THEME_STORAGE_KEY } from "@/components/jeeves/theme-toggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("dark");
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  });

  it("renders as a labeled switch-to-dark button in light mode", async () => {
    render(<ThemeToggle />);
    expect(
      await screen.findByRole("button", { name: /switch to dark theme/i }),
    ).toBeTruthy();
  });

  it("click adds the dark class and persists the choice", async () => {
    render(<ThemeToggle />);
    fireEvent.click(await screen.findByRole("button", { name: /switch to dark theme/i }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    // The class-attribute MutationObserver notifies in a microtask — use the
    // retrying async query for the post-click label.
    expect(await screen.findByRole("button", { name: /switch to light theme/i })).toBeTruthy();
  });

  it("second click returns to light and persists it", async () => {
    render(<ThemeToggle />);
    fireEvent.click(await screen.findByRole("button", { name: /switch to dark theme/i }));
    fireEvent.click(await screen.findByRole("button", { name: /switch to light theme/i }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("respects a pre-existing dark class on mount", async () => {
    document.documentElement.classList.add("dark");
    render(<ThemeToggle />);
    expect(
      await screen.findByRole("button", { name: /switch to light theme/i }),
    ).toBeTruthy();
  });
});
