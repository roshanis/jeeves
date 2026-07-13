import { describe, expect, it } from "vitest";
import { ControlCatalog } from "@/components/jeeves/control-catalog";
import { getProvider } from "@/lib/data";
import { renderWithProviders } from "./helpers";

describe("ControlCatalog", () => {
  it("renders all 17 controls (16 domain controls + Q-01)", async () => {
    const controls = await getProvider().controlCatalog();
    expect(controls).toHaveLength(17);

    const { container } = renderWithProviders(
      <ControlCatalog controls={controls} />,
    );

    const rows = container.querySelectorAll('[data-slot="control-catalog-row"]');
    expect(rows).toHaveLength(17);
    for (const control of controls) {
      expect(container.textContent).toContain(control.id);
    }
  });

  it("groups controls by domain, 2 per domain across all 8 domains", async () => {
    const controls = await getProvider().controlCatalog();
    const { container } = renderWithProviders(
      <ControlCatalog controls={controls} />,
    );

    const groups = container.querySelectorAll('[data-slot="control-catalog-group"]');
    // 8 governance domains + 1 Runtime group.
    expect(groups).toHaveLength(9);

    const domainGroupLabels = [
      "Legal",
      "Procurement",
      "Tech Architecture",
      "Responsible AI",
      "Security",
      "Privacy/HIPAA",
      "Clinical Safety",
      "Data Governance",
    ];
    for (const label of domainGroupLabels) {
      const group = Array.from(groups).find((g) => g.textContent?.includes(label));
      expect(group, `expected a group for ${label}`).toBeDefined();
      const rowsInGroup = group!.querySelectorAll(
        '[data-slot="control-catalog-row"]',
      );
      expect(rowsInGroup).toHaveLength(2);
    }
  });

  it("renders Q-01 under Runtime with its threshold shown", async () => {
    const controls = await getProvider().controlCatalog();
    const { container } = renderWithProviders(
      <ControlCatalog controls={controls} />,
    );

    const groups = container.querySelectorAll('[data-slot="control-catalog-group"]');
    const runtimeGroup = Array.from(groups).find((g) =>
      g.textContent?.includes("Runtime"),
    );
    expect(runtimeGroup).toBeDefined();
    expect(runtimeGroup!.textContent).toContain("Q-01");

    const q01 = controls.find((c) => c.id === "Q-01");
    expect(q01?.threshold).not.toBeNull();
    expect(runtimeGroup!.textContent).toContain(String(q01!.threshold));
  });

  it("renders the full catalog fields — owner and enforcement-mode badge", async () => {
    const controls = await getProvider().controlCatalog();
    const { container } = renderWithProviders(
      <ControlCatalog controls={controls} />,
    );

    const control = controls[0];
    expect(control.owner).toBeDefined();
    expect(container.textContent).toContain(control.owner);

    const enforcementBadges = container.querySelectorAll(
      '[data-slot="enforcement-mode"]',
    );
    expect(enforcementBadges.length).toBeGreaterThan(0);

    const modesPresent = new Set(
      controls.map((c) => c.enforcementMode).filter(Boolean),
    );
    expect(modesPresent.size).toBeGreaterThan(0);
  });

  it("renders an evidence-freshness indicator per control", async () => {
    const controls = await getProvider().controlCatalog();
    const { container } = renderWithProviders(
      <ControlCatalog controls={controls} />,
    );

    const freshnessBadges = container.querySelectorAll(
      '[data-slot="evidence-freshness"]',
    );
    expect(freshnessBadges.length).toBeGreaterThan(0);
  });
});
