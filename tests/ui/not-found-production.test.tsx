/**
 * The root 404 page's buttons are mode-aware: a production install has no
 * public home page ("/" is only a redirect to the console), so its primary
 * button opens the console instead.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import NotFound from "@/app/not-found";

afterEach(() => vi.unstubAllEnvs());

describe("404 page buttons", () => {
  it("keeps 'Back to home' in demo", () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    const { container } = render(<NotFound />);
    expect(container.textContent).toContain("Back to home");
    expect(container.querySelector('a[href="/"]')).not.toBeNull();
  });

  it("offers the console, not a home page, in production", () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    const { container } = render(<NotFound />);
    expect(container.textContent).not.toContain("Back to home");
    expect(container.querySelector('a[href="/"]')).toBeNull();
    expect(container.querySelector('a[href="/inbox"]')).not.toBeNull();
  });
});
