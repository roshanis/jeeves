"use client";

import { Search } from "lucide-react";
import { RoleSwitcher } from "./role-switcher";
import { DemoModeChip } from "./demo-mode-chip";

// Exact required banner string (ui-spec §7/§8.1) — tests match on this text.
export const DEMO_BANNER_TEXT =
  "Fictional demo — synthetic data. Meridian Health is a fictional payer; not affiliated with any real organization.";

/**
 * Operations-console top bar: a slim demo-disclaimer strip above a working
 * header with global search, workspace status (demo-mode chip), and the
 * persona switcher. Restrained charcoal-on-white; no gradients.
 */
export function AppTopBar() {
  return (
    <div className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
      <div className="bg-amber-100 px-4 py-1 text-center text-[11px] font-medium text-amber-900 dark:bg-amber-950/70 dark:text-amber-200">
        {DEMO_BANNER_TEXT}
      </div>
      <header className="flex items-center justify-between gap-4 px-4 py-2.5">
        <label className="relative flex w-full max-w-md items-center">
          <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            type="search"
            placeholder="Search initiatives, controls, decisions…"
            aria-label="Global search"
            className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </label>
        <div className="flex shrink-0 items-center gap-2">
          <DemoModeChip />
          <RoleSwitcher />
        </div>
      </header>
    </div>
  );
}
