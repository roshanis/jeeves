// CardTitle heading semantics (WCAG SHOULD-FIX #1): every data-dense page
// (/monitoring, /controls, /initiatives/[slug]) renders many CardTitles —
// screen-reader users navigate by heading, so CardTitle must render a real
// heading element (not a div), defaulting to h3 with an escape hatch to h2
// where a caller's page hierarchy calls for it. This is a semantics-only
// change: className/visual output must stay byte-identical.
import { describe, expect, it } from "vitest";
import { CardTitle } from "@/components/ui/card";
import { renderWithProviders } from "./helpers";

describe("CardTitle", () => {
  it("renders an h3 by default", () => {
    const { container } = renderWithProviders(<CardTitle>Section title</CardTitle>);
    const heading = container.querySelector("h3");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("Section title");
    expect(heading?.getAttribute("data-slot")).toBe("card-title");
  });

  it("honors an `as` override to render a different heading level", () => {
    const { container } = renderWithProviders(<CardTitle as="h2">Page section</CardTitle>);
    expect(container.querySelector("h2")).not.toBeNull();
    expect(container.querySelector("h3")).toBeNull();
  });

  it("keeps the exact same className regardless of heading level", () => {
    const { container: h3Container } = renderWithProviders(<CardTitle>Default</CardTitle>);
    const { container: h2Container } = renderWithProviders(<CardTitle as="h2">Override</CardTitle>);
    expect(h3Container.querySelector("h3")?.className).toBe(
      h2Container.querySelector("h2")?.className,
    );
  });
});
