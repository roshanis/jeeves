"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RoleSwitcher } from "./role-switcher";
import { DemoModeChip } from "./demo-mode-chip";
import { ThemeToggle } from "./theme-toggle";
import { NAV_ITEMS, isNavItemActive } from "./nav-items";
import { DEMO_BANNER_TEXT } from "@/lib/demo-banner";
import { CommandPalette, type PaletteInitiative } from "./command-palette";

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
export function AppTopBar({ initiatives }: { initiatives: PaletteInitiative[] }) {
  const pathname = usePathname();
  const breadcrumb = deriveBreadcrumb(pathname ?? "");

  return (
    <div className="pad-safe-x sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
      <div className="bg-status-warning-bg px-4 py-1 text-center text-[11px] font-medium text-status-warning-fg">
        {DEMO_BANNER_TEXT}
      </div>
      <header className="flex h-14 items-center justify-between gap-2 px-4 sm:gap-4">
        {/* overflow-x-clip: backstop for the pathological width where even a
            fully-ellipsized breadcrumb cannot absorb the squeeze — clip the
            left group at its own edge instead of letting the search input
            paint over (and steal pointer events from) the status cluster. */}
        <div className="flex min-w-0 flex-1 items-center gap-4 overflow-x-clip">
          {/* Compact brand lockup, phones only. The sidebar carries the
              Jeeves identity on desktop but is `hidden` below `md`, which
              left small screens with no app name anywhere on the page — and
              an empty left half of the top bar. This fills both gaps and,
              like the sidebar's lockup, links home to /inbox. */}
          <Link
            href="/inbox"
            className="touch-min flex shrink-0 items-center gap-2 md:hidden"
            data-slot="mobile-brand"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="size-4" aria-hidden />
            </span>
            {/* Mark-only on phones, wordmark from `sm`. In live mode the
                status cluster grows (LED label + Reset control) and the two
                together overflowed a 375px bar by 16px; the shield alone
                still reads as identity and as the way home. sr-only keeps
                "Jeeves" as the link's accessible name. */}
            <span className="text-sm font-semibold sr-only sm:not-sr-only">Jeeves</span>
          </Link>
          {/* min-w-0 (not shrink-0): with shrink-0 the `truncate` here could
              never engage, so a long detail-page breadcrumb ("Portfolio /
              Prior Auth Clinical Summarizer") pushed straight through its
              slot — measured overlapping the status chip by 9px on an iPad in
              portrait, and on a deep route in live mode forcing the search
              label over the status cluster, where its input swallowed the
              Reset control's clicks. Letting it ellipsize fixes both; the
              container's overflow-x-clip above is the backstop for the
              pathological width where even a full ellipsis cannot absorb it. */}
          <p
            className="label-mono hidden min-w-0 truncate text-foreground/80 sm:block"
            data-slot="breadcrumb"
          >
            {breadcrumb}
          </p>
          {/* The global search used to be a non-functional <input> with a
              ⌘K badge that did nothing. It is now the command palette
              (components/jeeves/command-palette.tsx), which renders its own
              two affordances: a field-shaped button at `xl` and up, and a
              compact icon button below that — the field is hidden on small
              screens, so without the second one the palette would exist only
              for people with a keyboard.

              Still no min-width on the wide trigger. An earlier cut added
              one as a "cannot collapse again" guard and it backfired: in
              live mode at 1280 the status cluster leaves this slot ~158px,
              so a 160px floor stopped the field shrinking and it spilled
              OVER the cluster, swallowing clicks meant for Reset. */}
          <CommandPalette initiatives={initiatives} />
        </div>
        {/* Status cluster: one grouped instrument reading (theme / demo state /
            persona) separated by hairlines rather than three floating pills.
            Hairline gutters tighten on phones so the three readouts still fit
            a 375px viewport without the cluster forcing a horizontal scroll. */}
        {/* `shrink-0` is load-bearing: these readouts are all
            `whitespace-nowrap`, so letting the cluster shrink squeezes its
            BOX without shrinking its CONTENT — in live mode (wider chip plus
            a Reset control) the search field then overlapped the cluster and
            swallowed clicks meant for it. The search yields instead: it is
            capped at max-w-sm, has no min-width, and sits in a `min-w-0
            flex-1` slot, so it gives ground before anything overlaps. */}
        <div className="flex shrink-0 items-center divide-x divide-border">
          <div className="pr-1.5 sm:pr-2.5">
            <ThemeToggle />
          </div>
          <div className="min-w-0 px-1.5 sm:px-2.5">
            <DemoModeChip />
          </div>
          <div className="min-w-0 pl-1.5 sm:pl-2.5">
            <RoleSwitcher />
          </div>
        </div>
      </header>
    </div>
  );
}
