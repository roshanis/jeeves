// The Toaster must follow the console theme (the `dark` class on <html>, owned
// by ThemeToggle), not the OS preference that next-themes would report.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const seen: Array<string | undefined> = [];
vi.mock("sonner", () => ({
  Toaster: (props: { theme?: string }) => {
    seen.push(props.theme);
    return null;
  },
}));

import { Toaster } from "@/components/ui/sonner";

describe("Toaster theme", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("dark");
    seen.length = 0;
  });

  it("is dark when the console is dark, whatever the OS prefers", async () => {
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    document.documentElement.classList.add("dark");
    render(<Toaster />);
    expect(seen.at(-1)).toBe("dark");
    await act(async () => {
      document.documentElement.classList.remove("dark");
      await Promise.resolve();
    });
    expect(seen.at(-1)).toBe("light");
  });
});
