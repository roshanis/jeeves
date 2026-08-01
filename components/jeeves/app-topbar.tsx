"use client";

import { Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { RoleSwitcher } from "./role-switcher";
import { DemoModeChip } from "./demo-mode-chip";
import { NAV_ITEMS, isNavItemActive } from "./app-sidebar";
import { DEMO_BANNER_TEXT } from "@/lib/demo-banner";

// Re-exported so existing importers of DEMO_BANNER_TEXT from this module
// keep working — the canonical constant now lives in lib/demo-banner.ts so
// the public landing page (a server component) can render the identical
// disclaimer strip without importing a "use client" console component.
export { DEMO_BANNER_TEXT };

function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Derives a lightweight page-context breadcrumb from the current pathname.
 * Prefix-matches against NAV_ITEMS (same rule the sidebar/mobile nav use for
 * their active state) to find the owning section, then — if the path goes
 * deeper than the section route itself (e.g. a detail page) — appends the
 * first extra segment, title-cased (e.g. "Portfolio / Prior Auth Clinical
 * Summarizer"). Routes with no NAV_ITEMS entry at all (e.g.
 * /initiatives/[slug], reached from Portfolio but not itself a nav item)
 * fall back to title-casing the raw path segments. Exported for tests; kept
 * intentionally simple (design pass 2026-08-01 explicitly allows "just the
 * section name" when a nicer label isn't trivially available).
 */
export function deriveBreadcrumb(pathname: string): string {
  const path = pathname || "/";
  const item = NAV_ITEMS.find((i) => isNavItemActive(i, path));
  if (item) {
    const rest = path.slice(item.href.length).replace(/^\/+/, "");
    if (!rest) return item.label;
    return `${item.label} / ${titleCaseSlug(rest.split("/")[0]!)}`;
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return "Console";
  const [first, second] = segments;
  const section = titleCaseSlug(first!);
  return second ? `${section} / ${titleCaseSlug(second)}` : section;
}

/**
 * Operations-console top bar: a slim demo-disclaimer strip above a tight
 * 56px working header with page-context breadcrumb, global search, workspace
 * status (demo-mode chip), and the persona switcher. Restrained
 * charcoal-on-white; no gradients.
 */
export function AppTopBar() {
  const pathname = usePathname();
  const breadcrumb = deriveBreadcrumb(pathname ?? "");

  return (
    <div className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
      <div className="bg-amber-100 px-4 py-1 text-center text-[11px] font-medium text-amber-900 dark:bg-amber-950/70 dark:text-amber-200">
        {DEMO_BANNER_TEXT}
      </div>
      <header className="flex h-14 items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-center gap-4">
          <p
            className="hidden shrink-0 truncate text-sm font-medium text-foreground/80 sm:block"
            data-slot="breadcrumb"
          >
            {breadcrumb}
          </p>
          <label className="relative flex w-full max-w-sm items-center">
            <Search
              className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              placeholder="Search initiatives, controls, decisions…"
              aria-label="Global search"
              className="h-8 w-full rounded-md border bg-background pl-8 pr-14 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <kbd className="pointer-events-none absolute right-2 hidden items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
              &#8984;K
            </kbd>
          </label>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <DemoModeChip />
          <RoleSwitcher />
        </div>
      </header>
    </div>
  );
}
