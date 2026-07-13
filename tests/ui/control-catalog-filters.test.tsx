import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { ControlCatalog } from "@/components/jeeves/control-catalog";
import { getProvider } from "@/lib/data";
import { renderWithProviders } from "./helpers";

// Chip labels repeat elsewhere in the tree (e.g. a "Legal" group title, a
// "Met" status chip on a row) — scope lookups to the filter bars themselves
// (data-slot="control-domain-filter" / "control-status-filter") rather than
// using getByText against the whole container.
function clickChip(container: HTMLElement, slot: string, label: string) {
  const bar = container.querySelector(`[data-slot="${slot}"]`);
  if (!bar) throw new Error(`filter bar ${slot} not found`);
  const buttons = Array.from(bar.querySelectorAll("button"));
  const button = buttons.find((b) => b.textContent?.trim() === label);
  if (!button) throw new Error(`chip "${label}" not found in ${slot}`);
  fireEvent.click(button);
}

describe("ControlCatalog filters", () => {
  it("narrows to a single domain when a domain filter chip is clicked", async () => {
    const controls = await getProvider().controlCatalog();
    const { container } = renderWithProviders(<ControlCatalog controls={controls} />);

    // Sanity: all 9 groups present before filtering.
    expect(
      container.querySelectorAll('[data-slot="control-catalog-group"]'),
    ).toHaveLength(9);

    const legalCount = controls.filter((c) => c.domain === "legal").length;
    clickChip(container, "control-domain-filter", "Legal");

    const groupsAfter = container.querySelectorAll(
      '[data-slot="control-catalog-group"]',
    );
    expect(groupsAfter).toHaveLength(1);
    expect(groupsAfter[0].textContent).toContain("Legal");

    const rowsAfter = container.querySelectorAll('[data-slot="control-catalog-row"]');
    expect(rowsAfter).toHaveLength(legalCount);
  });

  it("resets to all domains when 'All domains' is clicked again", async () => {
    const controls = await getProvider().controlCatalog();
    const { container } = renderWithProviders(<ControlCatalog controls={controls} />);

    clickChip(container, "control-domain-filter", "Legal");
    expect(
      container.querySelectorAll('[data-slot="control-catalog-group"]'),
    ).toHaveLength(1);

    clickChip(container, "control-domain-filter", "All domains");
    expect(
      container.querySelectorAll('[data-slot="control-catalog-group"]'),
    ).toHaveLength(9);
  });

  it("narrows by status filter chip", async () => {
    const controls = await getProvider().controlCatalog();
    const { container } = renderWithProviders(<ControlCatalog controls={controls} />);

    const metCount = controls.filter((c) => c.status === "met").length;
    clickChip(container, "control-status-filter", "Met");

    const rowsAfter = container.querySelectorAll('[data-slot="control-catalog-row"]');
    expect(rowsAfter).toHaveLength(metCount);
  });

  it("combines domain and status filters", async () => {
    const controls = await getProvider().controlCatalog();
    const { container } = renderWithProviders(<ControlCatalog controls={controls} />);

    clickChip(container, "control-domain-filter", "Legal");
    clickChip(container, "control-status-filter", "Met");

    const expected = controls.filter(
      (c) => c.domain === "legal" && c.status === "met",
    ).length;
    const rowsAfter = container.querySelectorAll('[data-slot="control-catalog-row"]');
    expect(rowsAfter).toHaveLength(expected);
  });
});
