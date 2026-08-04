import { describe, expect, it } from "vitest";
import { renderWithProviders } from "./helpers";
import { TierBadge } from "@/components/jeeves/tier-badge";
import type { Tier } from "@/lib/domain/types";

const TIERS: { tier: Tier; label: string; bgClass: string; fgClass: string }[] = [
  { tier: "low", label: "Low", bgClass: "bg-tier-low-bg", fgClass: "text-tier-low-fg" },
  { tier: "medium", label: "Medium", bgClass: "bg-tier-medium-bg", fgClass: "text-tier-medium-fg" },
  { tier: "high", label: "High", bgClass: "bg-tier-high-bg", fgClass: "text-tier-high-fg" },
  {
    tier: "critical",
    label: "Critical",
    bgClass: "bg-tier-critical-bg",
    fgClass: "text-tier-critical-fg",
  },
];

describe("TierBadge token mapping", () => {
  it.each(TIERS)(
    "renders $tier onto its tier token family with the exact visible text",
    ({ tier, label, bgClass, fgClass }) => {
      const { container } = renderWithProviders(<TierBadge tier={tier} />);
      const badge = container.querySelector('[data-slot="tier-badge"]');
      expect(badge).not.toBeNull();
      expect(badge?.getAttribute("data-tier")).toBe(tier);
      expect(badge?.textContent).toBe(label);
      expect(badge?.className).toContain(bgClass);
      expect(badge?.className).toContain(fgClass);
    },
  );
});
