import type { DeploymentMode } from "./config/deployment-mode";

// Exact required banner string (ui-spec §7/§8.1) — tests match on this text.
// Lives here (not in components/jeeves/app-topbar.tsx) so the public landing
// page (components/jeeves/landing-page.tsx) can render the identical
// disclaimer strip without importing a "use client" console component.
export const DEMO_BANNER_TEXT =
  "Fictional demo — synthetic data. Meridian Health is a fictional payer; not affiliated with any real organization.";

/**
 * The banner a surface should show in the given mode: the exact required
 * string in demo, nothing in production, where there is no fictional payer to
 * disclaim. Surfaces call this instead of rendering DEMO_BANNER_TEXT directly,
 * so a new one cannot forget the production case.
 */
export function demoBannerFor(mode: DeploymentMode): string | null {
  return mode === "demo" ? DEMO_BANNER_TEXT : null;
}
