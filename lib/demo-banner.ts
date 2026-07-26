// Exact required banner string (ui-spec §7/§8.1) — tests match on this text.
// Lives here (not in components/jeeves/app-topbar.tsx) so the public landing
// page (components/jeeves/landing-page.tsx) can render the identical
// disclaimer strip without importing a "use client" console component.
export const DEMO_BANNER_TEXT =
  "Fictional demo — synthetic data. Meridian Health is a fictional payer; not affiliated with any real organization.";
